-- Marca las cuentas creadas por la directiva (vía "Invitar contactos") para
-- forzar el cambio de contraseña temporal en el primer ingreso. Las cuentas
-- que la persona crea por sí misma en la app (pestaña "Crear cuenta") NO
-- tienen este flag activo (default false).

alter table profiles
  add column if not exists first_login boolean not null default false;

-- Nada más: el reset a false ocurre desde la página /cambiar-contrasena después
-- de que el usuario elige su contraseña definitiva.
