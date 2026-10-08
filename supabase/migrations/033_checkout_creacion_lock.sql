-- Lock de creacion de checkout SumUp por socio_solicitud.
--
-- Problema: dos requests paralelas al mismo /incorporacion/pago?token=
-- (doble click o refresh rapido) pueden ambas detectar sumup_checkout_id
-- NULL y disparar POST /v0.1/checkouts al mismo tiempo, generando dos
-- checkouts donde solo necesitabamos uno (uno queda huerfano).
--
-- Solucion: UN lock por solicitud, adquirido via RPC transaccional
-- ANTES del POST a SumUp y liberado en finally.
--
-- Carrera de stale-release cerrada con un lock_token (uuid, uno por intento):
--   - Request A adquiere con token_A.
--   - A tarda > 30s y su lock expira.
--   - Request B adquiere con token_B (sobrescribe lock_at + lock_token).
--   - A ejecuta finally con token_A -> liberar es NO-OP (token no coincide).
--   - B termina y libera con token_B -> lock queda NULL.
--
-- TTL 30s se mantiene SOLO como salvavidas ante crash del worker.
-- Las funciones corren con SECURITY DEFINER y search_path='' (duro). Todas
-- las referencias a objetos no built-in estan calificadas con public.*.
-- Permisos: REVOKE PUBLIC/anon/authenticated; GRANT solo service_role.
--
-- Tipos consistentes con el schema real (ver migracion 017_socios.sql):
--   socio_solicitudes.id                       uuid
--   socio_solicitudes.sumup_checkout_id        text   <-- NO uuid
--   socio_solicitudes.checkout_creacion_lock_at   timestamptz (nuevo)
--   socio_solicitudes.checkout_creacion_lock_token uuid        (nuevo)

BEGIN;

ALTER TABLE public.socio_solicitudes
  ADD COLUMN IF NOT EXISTS checkout_creacion_lock_at timestamptz;

ALTER TABLE public.socio_solicitudes
  ADD COLUMN IF NOT EXISTS checkout_creacion_lock_token uuid;

COMMENT ON COLUMN public.socio_solicitudes.checkout_creacion_lock_at IS
  'Lock de creacion de checkout SumUp: timestamp de adquisicion. Expira a 30s si el worker crashea.';
COMMENT ON COLUMN public.socio_solicitudes.checkout_creacion_lock_token IS
  'Lock de creacion de checkout SumUp: token unico del holder (uuid). liberar() exige que coincida para evitar stale-release.';

-- claim_checkout_creacion_lock
--
-- Firma:
--   p_solicitud_id          uuid   -> socio_solicitudes.id
--   p_expected_checkout_id  text   -> sumup_checkout_id actual esperado por el caller
--                                     (NULL si espera "aun no hay checkout").
--   p_lock_token            uuid   -> token unico generado por el caller (crypto.randomUUID()).
--
-- Toda la logica en una sola RPC transaccional (SELECT FOR UPDATE + compare + UPDATE).
--
-- Retornos (text):
--   'acquired'         -> lock asignado al caller con el token recibido.
--                         El caller DEBE llamar liberar(p_solicitud_id, p_lock_token).
--   'busy'             -> otro proceso tiene el lock vigente (< 30s).
--                         El caller debe pollear/re-leer.
--   'checkout_changed' -> el sumup_checkout_id en DB difiere del esperado,
--                         o la solicitud no existe. El caller debe re-resolver.
CREATE OR REPLACE FUNCTION public.claim_checkout_creacion_lock(
  p_solicitud_id uuid,
  p_expected_checkout_id text,
  p_lock_token uuid
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_current_id text;
  v_lock_at timestamptz;
BEGIN
  SELECT sumup_checkout_id, checkout_creacion_lock_at
    INTO v_current_id, v_lock_at
    FROM public.socio_solicitudes
    WHERE id = p_solicitud_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'checkout_changed';
  END IF;

  -- IS DISTINCT FROM maneja NULLs correctamente:
  --   NULL IS DISTINCT FROM NULL  -> false  (coinciden como "sin id")
  --   NULL IS DISTINCT FROM 'x'   -> true
  --   'x'  IS DISTINCT FROM 'x'   -> false
  IF v_current_id IS DISTINCT FROM p_expected_checkout_id THEN
    RETURN 'checkout_changed';
  END IF;

  IF v_lock_at IS NOT NULL
     AND v_lock_at > NOW() - INTERVAL '30 seconds' THEN
    RETURN 'busy';
  END IF;

  -- Lock libre o expirado: lo tomamos sobrescribiendo at + token.
  UPDATE public.socio_solicitudes
    SET checkout_creacion_lock_at = NOW(),
        checkout_creacion_lock_token = p_lock_token
    WHERE id = p_solicitud_id;

  RETURN 'acquired';
END;
$$;

-- liberar_checkout_creacion_lock
--
-- Firma:
--   p_solicitud_id  uuid   -> socio_solicitudes.id
--   p_lock_token    uuid   -> token que el caller recibio al hacer claim
--
-- Libera (lock_at=NULL, lock_token=NULL) SOLO si el token almacenado coincide.
-- Si no coincide (el lock fue reemplazado por otro proceso tras expirar), es NO-OP.
--
-- Retorno (boolean): true si libero, false si el token no era dueño (stale-release).
CREATE OR REPLACE FUNCTION public.liberar_checkout_creacion_lock(
  p_solicitud_id uuid,
  p_lock_token uuid
) RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH liberados AS (
    UPDATE public.socio_solicitudes
      SET checkout_creacion_lock_at = NULL,
          checkout_creacion_lock_token = NULL
      WHERE id = p_solicitud_id
        AND checkout_creacion_lock_token = p_lock_token
      RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM liberados);
$$;

-- Permisos: solo backend con service_role.
REVOKE ALL ON FUNCTION public.claim_checkout_creacion_lock(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_checkout_creacion_lock(uuid, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.claim_checkout_creacion_lock(uuid, text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_checkout_creacion_lock(uuid, text, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.liberar_checkout_creacion_lock(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.liberar_checkout_creacion_lock(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.liberar_checkout_creacion_lock(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.liberar_checkout_creacion_lock(uuid, uuid) TO service_role;

COMMIT;
