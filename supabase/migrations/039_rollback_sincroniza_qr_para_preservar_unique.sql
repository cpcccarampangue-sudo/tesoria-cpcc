-- =============================================================================
-- Migración 039: revertir la sincronización socio_solicitudes.qr_token
-- introducida en la 038 — rompía UNIQUE en segundas renovaciones.
--
-- Problema detectado tras la 038
--   socio_solicitudes.qr_token tiene constraint UNIQUE
--   (socio_solicitudes_qr_token_key). La RPC de la 038 trataba de
--   SET qr_token = apoderados.qr_token (canónico) sobre la solicitud
--   recién pagada. Pero cuando la familia ya tenía una solicitud previa
--   sincronizada (1a renovación hecha), esa solicitud previa YA ocupaba
--   el canónico. Al intentar escribir el canónico en una segunda
--   solicitud, PostgreSQL devuelve
--   "23505: duplicate key value violates unique constraint
--   socio_solicitudes_qr_token_key".
--   Esto bloquearía webhooks SumUp y pagos manuales a partir de la 2a
--   renovación. Verificado empíricamente en TX revertida contra PROD.
--
-- Por qué la sincronización era innecesaria
--   enviarCorreoQrSocio ya construye la URL del correo-QR a partir de
--   apoderados.qr_token (vía obtenerOGenerarQrFamilia), NO a partir de
--   socio_solicitudes.qr_token. El correo saliente lleva el canónico
--   independientemente de qué guarde la solicitud. La "sincronización"
--   duplicaba información y creaba conflicto.
--
-- Qué hace esta migración
--   CREATE OR REPLACE FUNCTION reconciliar_pago_socio_core, idéntica a
--   la versión 035 (generación on-first-pay del canónico mantenida),
--   SIN el paso 5b introducido por la 038.
--
-- Qué NO toca
--   - socio_solicitudes.qr_token: su DEFAULT, UNIQUE y valores existentes
--     permanecen intactos.
--   - apoderados.qr_token: fuente única y permanente del QR por familia.
--   - resolverQrToken: sigue haciendo canónico-primero / legacy-fallback.
--     Los correos QR ya enviados (con tokens legacy en solicitudes
--     históricas) siguen funcionando.
--   - Permisos (REVOKE/GRANT) y firma de la función.
--
-- Idempotencia: CREATE OR REPLACE sobre la misma firma.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.reconciliar_pago_socio_core(
  p_solicitud_id            uuid,
  p_live_checkout_id        text,
  p_live_amount             int,
  p_live_currency           text,
  p_live_merchant_code      text,
  p_live_checkout_reference text,
  p_live_transaction_id     text,
  p_live_transaction_code   text,
  p_expected_merchant_code  text
) RETURNS TABLE (
  resultado         text,
  detalle           text,
  movimiento_id     uuid,
  estado_final      text,
  movimiento_creado boolean,
  qr_generado       boolean,
  socio_actualizado boolean,
  socio_periodo_actualizado boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_sol RECORD;
  v_cfg RECORD;
  v_apoderado RECORD;
  v_mov_id uuid := NULL;
  v_mov_creado boolean := false;
  v_qr_generado boolean := false;
  v_socio_actualizado boolean := false;
  v_socio_periodo_actualizado boolean := false;
  v_estado_inicial text;
  v_descripcion text;
  v_aviso text := NULL;
  v_target_periodo int;
BEGIN
  -- 1) SELECT FOR UPDATE sobre la solicitud (row-level lock para esta tx).
  SELECT * INTO v_sol
    FROM public.socio_solicitudes
    WHERE id = p_solicitud_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT
      'solicitud_no_encontrada'::text, NULL::text, NULL::uuid, NULL::text,
      false, false, false, false;
    RETURN;
  END IF;

  v_estado_inicial := v_sol.estado;

  IF p_live_currency IS DISTINCT FROM 'CLP' THEN
    RETURN QUERY SELECT
      'mismatch'::text,
      format('moneda inesperada: %s', p_live_currency),
      NULL::uuid, v_estado_inicial, false, false, false, false;
    RETURN;
  END IF;

  IF v_sol.monto_cuota IS DISTINCT FROM p_live_amount THEN
    RETURN QUERY SELECT
      'mismatch'::text,
      format('monto solicitud=%s vs live=%s', v_sol.monto_cuota, p_live_amount),
      NULL::uuid, v_estado_inicial, false, false, false, false;
    RETURN;
  END IF;

  IF v_sol.sumup_checkout_id IS NOT NULL
     AND v_sol.sumup_checkout_id IS DISTINCT FROM p_live_checkout_id THEN
    RETURN QUERY SELECT
      'mismatch'::text,
      format('checkout_id solicitud=%s vs live=%s',
             v_sol.sumup_checkout_id, p_live_checkout_id),
      NULL::uuid, v_estado_inicial, false, false, false, false;
    RETURN;
  END IF;

  IF p_expected_merchant_code IS NOT NULL
     AND p_live_merchant_code IS NOT NULL
     AND p_live_merchant_code IS DISTINCT FROM p_expected_merchant_code THEN
    RETURN QUERY SELECT
      'mismatch'::text,
      format('merchant_code live=%s esperado=%s',
             p_live_merchant_code, p_expected_merchant_code),
      NULL::uuid, v_estado_inicial, false, false, false, false;
    RETURN;
  END IF;

  -- 2) MOVIMIENTO.
  SELECT id INTO v_mov_id
    FROM public.movimientos
    WHERE socio_solicitud_id = p_solicitud_id
    LIMIT 1;

  IF v_mov_id IS NULL THEN
    SELECT categoria_cuota_id, cuenta_default_id INTO v_cfg
      FROM public.socio_config
      WHERE id = 1;

    IF v_cfg.cuenta_default_id IS NULL THEN
      v_aviso := 'sin cuenta configurada';
    END IF;

    v_descripcion := format('Cuota socio CdP %s — %s',
                            v_sol.periodo_anio, v_sol.apoderado_nombre);

    IF v_cfg.cuenta_default_id IS NOT NULL THEN
      INSERT INTO public.movimientos (
        fecha, tipo, monto, descripcion, categoria_id, cuenta_id,
        socio_solicitud_id, created_by
      ) VALUES (
        CURRENT_DATE,
        'ingreso',
        v_sol.monto_cuota,
        v_descripcion,
        v_cfg.categoria_cuota_id,
        v_cfg.cuenta_default_id,
        p_solicitud_id,
        NULL
      )
      RETURNING id INTO v_mov_id;
      v_mov_creado := true;
    END IF;
  END IF;

  -- 3) SOLICITUD: marcar pagada + refs SumUp + link movimiento.
  UPDATE public.socio_solicitudes ss SET
    estado = CASE
      WHEN ss.estado IN ('pagada','enviada') THEN ss.estado
      ELSE 'pagada'
    END,
    pagada_en = COALESCE(ss.pagada_en, now()),
    sumup_checkout_id = COALESCE(ss.sumup_checkout_id, p_live_checkout_id),
    sumup_transaction_id = COALESCE(ss.sumup_transaction_id, p_live_transaction_id),
    sumup_transaction_code = COALESCE(ss.sumup_transaction_code, p_live_transaction_code),
    movimiento_id = COALESCE(ss.movimiento_id, v_mov_id)
  WHERE ss.id = p_solicitud_id;

  -- 5) APODERADO: socio=true + socio_periodo monotonico + qr_token si falta.
  -- (La "sincronización 5b" de la 038 queda ELIMINADA aquí: innecesaria
  -- porque enviarCorreoQrSocio ya usa apoderados.qr_token, y rompía
  -- UNIQUE en segundas renovaciones.)
  IF v_sol.apoderado_id IS NOT NULL THEN
    SELECT socio, socio_periodo, qr_token INTO v_apoderado
      FROM public.apoderados
      WHERE id = v_sol.apoderado_id
      FOR UPDATE;

    IF FOUND THEN
      v_target_periodo := GREATEST(COALESCE(v_apoderado.socio_periodo, 0), v_sol.periodo_anio);

      IF v_apoderado.socio IS DISTINCT FROM true
         OR v_apoderado.socio_periodo IS DISTINCT FROM v_target_periodo THEN
        UPDATE public.apoderados SET
          socio = true,
          socio_periodo = v_target_periodo
        WHERE id = v_sol.apoderado_id;

        IF v_apoderado.socio IS DISTINCT FROM true THEN
          v_socio_actualizado := true;
        END IF;
        IF v_apoderado.socio_periodo IS DISTINCT FROM v_target_periodo THEN
          v_socio_periodo_actualizado := true;
        END IF;
      END IF;

      -- Generación on-first-pay del canónico. Idempotente por UNIQUE
      -- en apoderados.qr_token + guardia qr_token IS NULL.
      IF v_apoderado.qr_token IS NULL THEN
        UPDATE public.apoderados
          SET qr_token = gen_random_uuid()
          WHERE id = v_sol.apoderado_id
            AND qr_token IS NULL;
        IF FOUND THEN
          v_qr_generado := true;
        END IF;
      END IF;
    END IF;
  END IF;

  -- 6) Resultado final.
  IF v_estado_inicial IN ('pagada','enviada')
     AND NOT v_mov_creado
     AND NOT v_qr_generado
     AND NOT v_socio_actualizado
     AND NOT v_socio_periodo_actualizado THEN
    RETURN QUERY SELECT
      'ya_reconciliada'::text,
      v_aviso,
      v_mov_id,
      (SELECT estado FROM public.socio_solicitudes WHERE id = p_solicitud_id)::text,
      false, false, false, false;
  ELSE
    RETURN QUERY SELECT
      'reconciliada'::text,
      v_aviso,
      v_mov_id,
      (SELECT estado FROM public.socio_solicitudes WHERE id = p_solicitud_id)::text,
      v_mov_creado, v_qr_generado, v_socio_actualizado, v_socio_periodo_actualizado;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.reconciliar_pago_socio_core(uuid, text, int, text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reconciliar_pago_socio_core(uuid, text, int, text, text, text, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.reconciliar_pago_socio_core(uuid, text, int, text, text, text, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reconciliar_pago_socio_core(uuid, text, int, text, text, text, text, text, text) TO service_role;

COMMIT;
