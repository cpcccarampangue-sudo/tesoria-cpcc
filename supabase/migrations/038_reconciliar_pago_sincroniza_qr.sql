-- =============================================================================
-- Migración 038: reconciliar_pago_socio_core sincroniza qr_token canónico
--
-- Qué cambia
--   Agrega al núcleo de reconciliación un paso 5b que, una vez asegurado
--   apoderados.qr_token (canónico, generado por el paso 5 si faltaba),
--   actualiza socio_solicitudes.qr_token al canónico — PERO sólo si:
--     a) la solicitud aún no envió correo (email_enviado_en IS NULL), y
--     b) el valor actual difiere del canónico.
--
--   Esto garantiza que:
--     - El QR único por familia (apoderados.qr_token) sea la fuente de
--       verdad desde el primer pago exitoso.
--     - La solicitud recién pagada y el correo que se envíe apunten al
--       canónico, no al UUID generado por el DEFAULT al INSERTar la solicitud.
--     - Los QR legacy ya enviados (email_enviado_en IS NOT NULL) permanecen
--       intactos — el fallback legacy en resolverQrToken los sigue atendiendo.
--     - Es idempotente: si la solicitud ya tiene el canónico, no hace nada.
--     - Webhooks SumUp duplicados no generan nuevos canónicos ni cambian
--       tokens de solicitudes con correo enviado.
--
-- Qué NO cambia
--   - El resto del comportamiento de la RPC (lock, idempotencia, movimientos,
--     socio=true, socio_periodo, generación on-first-pay del canónico).
--   - Permisos (REVOKE/GRANT) ni firma de la función.
--
-- Idempotencia: CREATE OR REPLACE FUNCTION sobre la firma existente.
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
  v_canon_token uuid := NULL;
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

  -- Validaciones de coherencia con el live SumUp.
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

  -- 2) MOVIMIENTO: reusar por unique(socio_solicitud_id) o crear uno nuevo.
  SELECT id INTO v_mov_id
    FROM public.movimientos
    WHERE socio_solicitud_id = p_solicitud_id
    LIMIT 1;

  IF v_mov_id IS NULL THEN
    -- Config: categoria y cuenta por defecto.
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

  -- 3) SOLICITUD: marcar como pagada + guardar refs SumUp + link al movimiento.
  --    Idempotente: no bajamos de 'enviada' ni cambiamos pagada_en si ya está.
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

      -- GENERACION DEL CANONICO: solo si falta. Es el PRIMER punto donde
      -- se materializa el QR permanente de la familia. Un pago repetido
      -- (webhook duplicado) NO reaplica porque v_apoderado.qr_token ya
      -- no sera NULL en la segunda llamada.
      IF v_apoderado.qr_token IS NULL THEN
        UPDATE public.apoderados
          SET qr_token = gen_random_uuid()
          WHERE id = v_sol.apoderado_id
            AND qr_token IS NULL;
        IF FOUND THEN
          v_qr_generado := true;
        END IF;
      END IF;

      -- 5b) SINCRONIZACION canónico -> socio_solicitudes (nuevo en 038):
      -- Releer el canónico después del posible UPDATE y aplicarlo a la
      -- solicitud sólo si aún no envió correo (preserva links legacy
      -- ya enviados) y si difiere del valor actual (idempotente).
      SELECT qr_token INTO v_canon_token
        FROM public.apoderados
        WHERE id = v_sol.apoderado_id;

      IF v_canon_token IS NOT NULL THEN
        UPDATE public.socio_solicitudes
          SET qr_token = v_canon_token
          WHERE id = p_solicitud_id
            AND email_enviado_en IS NULL
            AND qr_token IS DISTINCT FROM v_canon_token;
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

-- Permisos: idénticos a los de la versión anterior.
REVOKE ALL ON FUNCTION public.reconciliar_pago_socio_core(uuid, text, int, text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reconciliar_pago_socio_core(uuid, text, int, text, text, text, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.reconciliar_pago_socio_core(uuid, text, int, text, text, text, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reconciliar_pago_socio_core(uuid, text, int, text, text, text, text, text, text) TO service_role;

COMMIT;
