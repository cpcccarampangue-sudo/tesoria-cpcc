-- RPC transaccional que ejecuta el nucleo DB de la reconciliacion de un
-- pago SumUp PAID sobre una socio_solicitud.
--
-- Caracteristicas:
-- - SELECT FOR UPDATE sobre socio_solicitudes: serializa webhook + admin
--   que lleguen simultaneamente.
-- - Idempotente POR EFECTO: si cualquier efecto ya se aplico, lo omite.
--   Repara estados parciales (ej. estado=pagada pero movimiento faltante).
-- - El caller DEBE haber validado contra SumUp live ANTES de llamar.
--   La RPC no consulta SumUp; recibe los campos ya validados.
-- - El efecto externo (email SMTP) queda FUERA de esta RPC.
--
-- Pre-requisitos: migracion 034 aplicada (movimientos.socio_solicitud_id UNIQUE).

BEGIN;

-- reconciliar_pago_socio_core
--
-- Parametros:
--   p_solicitud_id              uuid   -> socio_solicitudes.id
--   p_live_checkout_id          text   -> live.id (debe coincidir con socio_solicitudes.sumup_checkout_id)
--   p_live_amount               int    -> live.amount
--   p_live_currency             text   -> live.currency (debe ser 'CLP')
--   p_live_merchant_code        text   -> live.merchant_code (puede ser NULL)
--   p_live_checkout_reference   text   -> live.checkout_reference
--   p_live_transaction_id       text   -> live.transaction_id (puede ser NULL)
--   p_live_transaction_code     text   -> live.transaction_code (puede ser NULL)
--   p_expected_merchant_code    text   -> SUMUP_MERCHANT_CODE desde el server (NULL si no seteado)
--
-- Devuelve TABLE con el resumen de lo que hizo. Siempre 1 fila.
--
-- Columnas del resultado:
--   resultado         text   'reconciliada' | 'ya_reconciliada' |
--                            'mismatch' | 'solicitud_no_encontrada'
--   detalle           text   descripcion legible si no fue OK, NULL si OK.
--                            Tambien se usa como "aviso" (ej. 'sin cuenta configurada').
--   movimiento_id     uuid   FK a movimientos (nueva o existente), NULL si no se creo
--   estado_final      text   estado final de socio_solicitudes
--   movimiento_creado boolean  true si se creo en esta llamada
--   qr_generado       boolean  true si se asigno qr_token en esta llamada
--   socio_actualizado boolean  true si se seteo apoderados.socio=true aqui
--   socio_periodo_actualizado boolean  true si se incremento socio_periodo
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

  -- 2) Validaciones de coherencia contra el live. El caller DEBE haber
  -- verificado status='PAID' antes de invocar.
  IF v_sol.sumup_checkout_id IS NULL
     OR v_sol.sumup_checkout_id IS DISTINCT FROM p_live_checkout_id THEN
    RETURN QUERY SELECT
      'mismatch'::text,
      format('sumup_checkout_id en DB (%s) no coincide con live (%s)',
        COALESCE(v_sol.sumup_checkout_id, 'NULL'), p_live_checkout_id)::text,
      NULL::uuid, v_sol.estado::text, false, false, false, false;
    RETURN;
  END IF;

  -- Reference permitida EXACTAMENTE:
  --   socio_<uuid>
  --   socio_<uuid>_r<digits>
  -- Nada mas. Usamos regex ancla ^...$ con grupo opcional _r[0-9]+.
  IF p_live_checkout_reference IS NULL
     OR NOT (p_live_checkout_reference ~
             ('^socio_' || p_solicitud_id::text || '(_r[0-9]+)?$')) THEN
    RETURN QUERY SELECT
      'mismatch'::text,
      format('checkout_reference live (%s) no corresponde a socio_%s o socio_%s_r<digits>',
        COALESCE(p_live_checkout_reference, 'NULL'),
        p_solicitud_id::text, p_solicitud_id::text)::text,
      NULL::uuid, v_sol.estado::text, false, false, false, false;
    RETURN;
  END IF;

  IF p_live_amount IS DISTINCT FROM v_sol.monto_cuota THEN
    RETURN QUERY SELECT
      'mismatch'::text,
      format('amount live (%s) != monto_cuota solicitud (%s)',
        p_live_amount, v_sol.monto_cuota)::text,
      NULL::uuid, v_sol.estado::text, false, false, false, false;
    RETURN;
  END IF;

  IF p_live_currency IS DISTINCT FROM 'CLP' THEN
    RETURN QUERY SELECT
      'mismatch'::text,
      format('currency live (%s) != CLP', p_live_currency)::text,
      NULL::uuid, v_sol.estado::text, false, false, false, false;
    RETURN;
  END IF;

  -- Si el server tiene SUMUP_MERCHANT_CODE configurado, el live DEBE
  -- traer merchant_code y ser EXACTAMENTE igual. Live NULL = mismatch.
  -- IS DISTINCT FROM maneja NULL correctamente:
  --   'MC1' IS DISTINCT FROM NULL   -> true  (mismatch)
  --   'MC1' IS DISTINCT FROM 'MC1'  -> false (match)
  --   'MC1' IS DISTINCT FROM 'MC2'  -> true  (mismatch)
  IF p_expected_merchant_code IS NOT NULL
     AND p_expected_merchant_code IS DISTINCT FROM p_live_merchant_code THEN
    RETURN QUERY SELECT
      'mismatch'::text,
      format('merchant_code live (%s) != expected (%s)',
        COALESCE(p_live_merchant_code, 'NULL'), p_expected_merchant_code)::text,
      NULL::uuid, v_sol.estado::text, false, false, false, false;
    RETURN;
  END IF;

  -- 3) MOVIMIENTO: idempotente. Si ya existe por link, reutilizar. Si
  -- no, crear SOLO si hay cuenta_sumup_id configurada.
  SELECT m.id INTO v_mov_id
    FROM public.movimientos m
    WHERE m.socio_solicitud_id = p_solicitud_id
    LIMIT 1;

  IF v_mov_id IS NULL AND v_sol.movimiento_id IS NOT NULL THEN
    -- Backfill defensivo: la 034 ya lo hizo, pero por si quedo alguno.
    UPDATE public.movimientos
      SET socio_solicitud_id = p_solicitud_id
      WHERE id = v_sol.movimiento_id
        AND socio_solicitud_id IS NULL;
    v_mov_id := v_sol.movimiento_id;
  END IF;

  IF v_mov_id IS NULL THEN
    SELECT cuenta_sumup_id, categoria_cuota_id INTO v_cfg
      FROM public.socio_config
      WHERE id = 1;

    IF v_cfg IS NULL OR v_cfg.cuenta_sumup_id IS NULL THEN
      v_aviso := 'socio_config.cuenta_sumup_id no configurada; se omite creacion de movimiento';
    ELSE
      v_descripcion := format('Cuota socio CdP %s — %s (SumUp)',
        v_sol.periodo_anio::text, v_sol.apoderado_nombre);

      BEGIN
        INSERT INTO public.movimientos (
          fecha, tipo, monto, descripcion, categoria_id, cuenta_id, socio_solicitud_id
        ) VALUES (
          CURRENT_DATE,
          'ingreso',
          v_sol.monto_cuota,
          v_descripcion,
          v_cfg.categoria_cuota_id,
          v_cfg.cuenta_sumup_id,
          p_solicitud_id
        )
        RETURNING id INTO v_mov_id;
        v_mov_creado := true;
      EXCEPTION WHEN unique_violation THEN
        -- Race: otro proceso lo creo entre nuestro SELECT y INSERT.
        SELECT m.id INTO v_mov_id
          FROM public.movimientos m
          WHERE m.socio_solicitud_id = p_solicitud_id
          LIMIT 1;
      END;
    END IF;
  END IF;

  -- 4) UPDATE socio_solicitudes: estado + pagada_en + transaction_id/code
  -- + movimiento_id. Idempotente: no retrocede desde pagada/enviada.
  -- Alias "ss" en TODAS las columnas para evitar colision con el output
  -- param movimiento_id del RETURNS TABLE (PL/pgSQL expone los output
  -- params como variables y en un UPDATE sin alias Postgres no sabe si
  -- "movimiento_id" refiere a la variable o a la columna -> 42702).
  UPDATE public.socio_solicitudes AS ss SET
    estado = CASE
      WHEN ss.estado IN ('pagada','enviada') THEN ss.estado
      ELSE 'pagada'
    END,
    pagada_en = COALESCE(ss.pagada_en, NOW()),
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

-- Permisos: solo backend con service_role.
REVOKE ALL ON FUNCTION public.reconciliar_pago_socio_core(uuid, text, int, text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reconciliar_pago_socio_core(uuid, text, int, text, text, text, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.reconciliar_pago_socio_core(uuid, text, int, text, text, text, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reconciliar_pago_socio_core(uuid, text, int, text, text, text, text, text, text) TO service_role;

COMMIT;
