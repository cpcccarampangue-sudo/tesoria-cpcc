-- Link duro entre movimientos y socio_solicitudes + claim de envio de correo.
--
-- Objetivos:
-- 1) movimientos.socio_solicitud_id uuid FK -> socio_solicitudes(id)
--    con UNIQUE parcial para impedir que una misma solicitud tenga
--    mas de un movimiento asociado (garantia DB de idempotencia del
--    INSERT movimiento en la reconciliacion).
-- 2) Backfill desde socio_solicitudes.movimiento_id ya existente.
-- 3) Columnas de lock para envio de correo + RPCs claim/liberar con
--    token y TTL (patron espejo al de 033 para checkout). Permiten
--    reintentar envio tras fallo SMTP sin duplicar correos ante
--    ejecuciones concurrentes.
--
-- Las RPCs son SECURITY DEFINER con search_path='' y solo accesibles
-- con service_role.

BEGIN;

-- =====================================================================
-- 1) movimientos.socio_solicitud_id (FK + UNIQUE parcial)
-- =====================================================================

ALTER TABLE public.movimientos
  ADD COLUMN IF NOT EXISTS socio_solicitud_id uuid
    REFERENCES public.socio_solicitudes(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.movimientos.socio_solicitud_id IS
  'Link al socio_solicitudes que genero este ingreso (via webhook SumUp o reconciliacion). UNIQUE parcial impide duplicados.';

-- UNIQUE parcial: solo aplica cuando socio_solicitud_id IS NOT NULL,
-- para no afectar movimientos manuales/transferencias/etc.
CREATE UNIQUE INDEX IF NOT EXISTS ux_movimientos_socio_solicitud
  ON public.movimientos (socio_solicitud_id)
  WHERE socio_solicitud_id IS NOT NULL;

-- Backfill: para cada socio_solicitudes.movimiento_id existente,
-- escribir la referencia inversa en movimientos.socio_solicitud_id.
-- Si por accidente ya hubo duplicados (dos movimientos para la misma
-- solicitud), este UPDATE fallaria con 23505 — pero en ese caso
-- necesitariamos saberlo antes de aplicar la migracion.
UPDATE public.movimientos m
   SET socio_solicitud_id = s.id
  FROM public.socio_solicitudes s
 WHERE s.movimiento_id = m.id
   AND m.socio_solicitud_id IS NULL;

-- =====================================================================
-- 2) Claim de envio de correo (socio_solicitudes)
-- =====================================================================

ALTER TABLE public.socio_solicitudes
  ADD COLUMN IF NOT EXISTS email_envio_lock_at timestamptz;

ALTER TABLE public.socio_solicitudes
  ADD COLUMN IF NOT EXISTS email_envio_lock_token uuid;

COMMENT ON COLUMN public.socio_solicitudes.email_envio_lock_at IS
  'Claim de envio de correo: timestamp de adquisicion. TTL 30s para recuperar tras crash del worker.';
COMMENT ON COLUMN public.socio_solicitudes.email_envio_lock_token IS
  'Claim de envio de correo: token unico del holder (uuid). liberar() exige que coincida para evitar stale-release.';

-- claim_email_envio_lock
--
-- Firma:
--   p_solicitud_id  uuid
--   p_lock_token    uuid   -> token unico generado por el caller
--
-- Logica:
--   - SELECT FOR UPDATE sobre socio_solicitudes.
--   - Si email_enviado_en IS NOT NULL -> 'ya_enviado'. El caller NO envia.
--   - Si lock_at vigente (< 30s) -> 'busy'. El caller NO envia (otro proceso en vuelo).
--   - Si lock libre o expirado -> set at = NOW(), token = p_lock_token, return 'acquired'.
--
-- Retornos: 'acquired' | 'busy' | 'ya_enviado' | 'solicitud_no_encontrada'
CREATE OR REPLACE FUNCTION public.claim_email_envio_lock(
  p_solicitud_id uuid,
  p_lock_token uuid
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email_enviado_en timestamptz;
  v_lock_at timestamptz;
BEGIN
  SELECT email_enviado_en, email_envio_lock_at
    INTO v_email_enviado_en, v_lock_at
    FROM public.socio_solicitudes
    WHERE id = p_solicitud_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'solicitud_no_encontrada';
  END IF;

  IF v_email_enviado_en IS NOT NULL THEN
    RETURN 'ya_enviado';
  END IF;

  IF v_lock_at IS NOT NULL
     AND v_lock_at > NOW() - INTERVAL '30 seconds' THEN
    RETURN 'busy';
  END IF;

  UPDATE public.socio_solicitudes
    SET email_envio_lock_at = NOW(),
        email_envio_lock_token = p_lock_token
    WHERE id = p_solicitud_id;

  RETURN 'acquired';
END;
$$;

-- liberar_email_envio_lock
--
-- Firma:
--   p_solicitud_id  uuid
--   p_lock_token    uuid
--
-- Libera (lock_at = NULL, lock_token = NULL) SOLO si el token coincide.
-- NO toca email_enviado_en (eso lo setea el caller tras enviar exitosamente).
--
-- Retorno (boolean): true si libero, false si no era dueno.
CREATE OR REPLACE FUNCTION public.liberar_email_envio_lock(
  p_solicitud_id uuid,
  p_lock_token uuid
) RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH liberados AS (
    UPDATE public.socio_solicitudes
      SET email_envio_lock_at = NULL,
          email_envio_lock_token = NULL
      WHERE id = p_solicitud_id
        AND email_envio_lock_token = p_lock_token
      RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM liberados);
$$;

-- Permisos: solo backend con service_role.
REVOKE ALL ON FUNCTION public.claim_email_envio_lock(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_email_envio_lock(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.claim_email_envio_lock(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_email_envio_lock(uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.liberar_email_envio_lock(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.liberar_email_envio_lock(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.liberar_email_envio_lock(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.liberar_email_envio_lock(uuid, uuid) TO service_role;

COMMIT;
