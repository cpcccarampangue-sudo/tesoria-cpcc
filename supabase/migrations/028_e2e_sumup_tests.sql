-- 028_e2e_sumup_tests.sql
--
-- TABLA TEMPORAL para diagnostico end-to-end del pipeline SumUp
-- (checkout dinamico -> hosted checkout -> pago real -> webhook ->
-- revalidacion API). Aislada del dominio socios/incorporacion.
--
-- Se eliminara con la migracion 029_drop_e2e_sumup_tests.sql una vez
-- confirmado que el flujo funciona.
--
-- Reglas:
--   - RLS enabled sin policies: solo service_role accede.
--   - El webhook branch "sumup_e2e_test_*" escribe aqui exclusivamente;
--     nunca toca socio_solicitudes, movimientos, apoderados, etc.
--   - last_webhook_payload es un JSON SANITIZADO (solo event_type,
--     checkout_id, checkout_reference, status, amount, currency). NO
--     se guarda nombre, email, personal_details ni ninguna PII.

create table if not exists e2e_sumup_tests (
  id uuid primary key default gen_random_uuid(),
  checkout_reference text not null unique,
  checkout_id text unique,
  monto int not null,
  currency text not null default 'CLP',
  status text not null default 'PENDING',
  transaction_id text,
  transaction_code text,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  last_webhook_at timestamptz,
  last_webhook_payload jsonb,
  verification_errors jsonb,
  constraint e2e_sumup_tests_status_check
    check (status in ('PENDING', 'PAID', 'FAILED', 'EXPIRED', 'CANCELED', 'REJECTED')),
  constraint e2e_sumup_tests_monto_positivo check (monto > 0)
);

create index if not exists e2e_sumup_tests_created_at_idx
  on e2e_sumup_tests (created_at desc);

alter table e2e_sumup_tests enable row level security;

revoke all on e2e_sumup_tests from anon, authenticated;
