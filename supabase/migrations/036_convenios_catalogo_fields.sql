-- Campos extendidos para el catalogo de convenios 2026-2027.
--
-- La planilla fuente (Google Forms "Formulario de inscripcion y
-- renovacion de convenios CPCC 2026") trae mas datos de los que la
-- tabla convenios actual soporta. Esta migracion agrega las columnas
-- opcionales necesarias para preservar toda la informacion util y
-- habilitar idempotencia por nombre normalizado.
--
-- Columnas nuevas:
--   nombre_normalizado  text NOT NULL UNIQUE (lower + trim + colapsar espacios)
--   rubro               text
--   rubro_otro          text   (texto libre cuando rubro = "Otro")
--   tipo_convenio       text   ('nuevo' | 'renovacion' | NULL)
--   condiciones         text
--   direccion           text
--   comuna              text
--   telefono            text
--   instagram           text   (formato @handle o URL)
--   sitio_web           text   (https://... validado por app)
--   flyer_url           text   (fase 2: por ahora NULL)
--   contacto_nombre     text
--   contacto_cargo      text
--
-- NO toca: convenio_operadores, validaciones_log, RLS, policies, grants.
--
-- Seguridad anti-colision: antes de crear el UNIQUE sobre
-- nombre_normalizado, se verifica que no haya duplicados existentes;
-- si existen, la migracion falla con RAISE EXCEPTION listando los
-- nombres en conflicto.

BEGIN;

-- 1) Agregar columnas nuevas (todas nullable, no rompen datos existentes).
ALTER TABLE public.convenios
  ADD COLUMN IF NOT EXISTS nombre_normalizado text,
  ADD COLUMN IF NOT EXISTS rubro              text,
  ADD COLUMN IF NOT EXISTS rubro_otro         text,
  ADD COLUMN IF NOT EXISTS tipo_convenio      text,
  ADD COLUMN IF NOT EXISTS condiciones        text,
  ADD COLUMN IF NOT EXISTS direccion          text,
  ADD COLUMN IF NOT EXISTS comuna             text,
  ADD COLUMN IF NOT EXISTS telefono           text,
  ADD COLUMN IF NOT EXISTS instagram          text,
  ADD COLUMN IF NOT EXISTS sitio_web          text,
  ADD COLUMN IF NOT EXISTS flyer_url          text,
  ADD COLUMN IF NOT EXISTS contacto_nombre    text,
  ADD COLUMN IF NOT EXISTS contacto_cargo     text;

COMMENT ON COLUMN public.convenios.nombre_normalizado IS
  'Nombre canonicalizado (lower + trim + colapsar whitespace). Clave de idempotencia para imports repetidos.';
COMMENT ON COLUMN public.convenios.tipo_convenio IS
  'Normalizado desde el formulario a: nuevo | renovacion. NULL si el formulario no indicaba.';
COMMENT ON COLUMN public.convenios.flyer_url IS
  'Fase 2 (post-import inicial): se poblara cuando los flyers esten subidos al storage.';

-- 2) Backfill nombre_normalizado para registros existentes.
UPDATE public.convenios
  SET nombre_normalizado =
    lower(regexp_replace(trim(coalesce(nombre, '')), '\s+', ' ', 'g'))
  WHERE nombre_normalizado IS NULL;

-- 3) CHECK anti-colision: si al normalizar los nombres existentes
--    aparece algun duplicado, abortar la migracion con detalle legible.
--    Esto garantiza que el UNIQUE INDEX siguiente no fallara, y si
--    falla el DO, nos quedamos sin tocar nada mas (BEGIN/COMMIT envuelve).
DO $$
DECLARE
  v_dups text;
BEGIN
  SELECT string_agg(dupe, ' | ') INTO v_dups
  FROM (
    SELECT nombre_normalizado || ' (x' || count(*)::text || ')' AS dupe
    FROM public.convenios
    WHERE nombre_normalizado IS NOT NULL
    GROUP BY nombre_normalizado
    HAVING count(*) > 1
  ) d;

  IF v_dups IS NOT NULL THEN
    RAISE EXCEPTION
      'Colisiones de nombre_normalizado detectadas; resolver manualmente antes de aplicar 036: %',
      v_dups
      USING ERRCODE = 'unique_violation';
  END IF;
END $$;

-- 4) Hacer nombre_normalizado NOT NULL + UNIQUE una vez saneado.
ALTER TABLE public.convenios
  ALTER COLUMN nombre_normalizado SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS convenios_nombre_normalizado_unico
  ON public.convenios (nombre_normalizado);

-- 5) CHECK constraints light sobre tipo_convenio (si viene, acepta solo
--    valores conocidos; permite NULL para formularios sin la pregunta).
ALTER TABLE public.convenios
  DROP CONSTRAINT IF EXISTS convenios_tipo_convenio_check;
ALTER TABLE public.convenios
  ADD CONSTRAINT convenios_tipo_convenio_check
  CHECK (tipo_convenio IS NULL OR tipo_convenio IN ('nuevo', 'renovacion'));

COMMIT;
