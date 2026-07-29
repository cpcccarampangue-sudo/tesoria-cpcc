# Tesorería CPCC

Sistema web para llevar las cuentas del Centro de Padres. Directiva registra movimientos, cuotas, eventos y boletas; los apoderados ven sus cuotas y los balances agregados.

- **Stack**: Next.js 15 + Supabase (Postgres, Auth, Storage) — todo en capa gratuita.
- **Idioma**: español (Chile). Montos en CLP sin decimales.
- **Costo**: $0/mes.
- **URL en producción**: https://tesoria-cpcc-ten.vercel.app/
- **Hosting**: Vercel Hobby, proyecto `tesoria-cpcc` bajo el team institucional `cpcccarampangue-sudo's projects` (correo `cpcc.carampangue@gmail.com`).

---

## Índice

1. [Requisitos previos](#1-requisitos-previos)
2. [Configurar Supabase](#2-configurar-supabase)
3. [Configurar el proyecto localmente](#3-configurar-el-proyecto-localmente)
4. [Subir a GitHub](#4-subir-a-github)
5. [Desplegar a Vercel](#5-desplegar-a-vercel)
6. [Primer ingreso y promoción de directiva](#6-primer-ingreso-y-promoci%C3%B3n-de-directiva)
7. [Backups automáticos y ping anti-pausa](#7-backups-autom%C3%A1ticos-y-ping-anti-pausa)
8. [Uso del día a día](#8-uso-del-d%C3%ADa-a-d%C3%ADa)
9. [Preguntas frecuentes / problemas comunes](#9-preguntas-frecuentes--problemas-comunes)

---

## 1. Requisitos previos

Vas a necesitar (todo gratis):

- **Cuenta en GitHub** — https://github.com/signup (institucional, ej. `cpcccarampangue-sudo`).
- **Cuenta en Vercel** — https://vercel.com/signup (regístrate con la misma cuenta de GitHub). Vercel Hobby pide verificación por SMS: si tu número ya está usado en otra cuenta Vercel, pide prestado el celular de otra persona de la directiva solo para recibir el código.
- **Cuenta en Supabase** — https://supabase.com/dashboard (regístrate con GitHub).

En tu computador (Windows):

- **Node.js 20 o superior** — https://nodejs.org (ya lo tienes instalado, versión 24 OK).
- **Git for Windows** — https://git-scm.com/download/win (ya instalado).
- **GitHub CLI (opcional pero recomendado)**: abre PowerShell y ejecuta:
  ```powershell
  winget install --id GitHub.cli
  ```

---

## 2. Configurar Supabase

1. Entra a https://supabase.com/dashboard y haz clic en **New project**.
2. Elige un nombre (ej. `tesoria-cpcc`), una contraseña segura (guárdala, la necesitarás para backups) y la región más cercana (**South America (São Paulo)** es la mejor para Chile).
3. Espera 1-2 minutos hasta que el proyecto quede listo.
4. En el menú lateral ve a **SQL Editor** → **New query**.
5. Abre el archivo [`supabase/schema.sql`](./supabase/schema.sql) de este repo, copia todo su contenido, pégalo en el editor y haz clic en **Run**. Esto crea todas las tablas, políticas de seguridad, funciones y las categorías iniciales.
6. En el menú lateral ve a **Storage** y verifica que exista el bucket `boletas` (el script SQL lo crea; si no aparece, créalo a mano como **Private**).
7. En el menú lateral ve a **Settings → API** → tab **"Legacy anon, service_role API keys"** y copia estos tres valores (los usarás en el paso 3):
   - **Project URL** (ej. `https://xxxxxx.supabase.co`)
   - **anon public** (clave pública — empieza con `eyJ...`)
   - **service_role** (clave secreta — empieza con `eyJ...` — **NO COMPARTIR**)

   > **Importante**: usa las llaves **legacy** (tab que aparece al lado). Las nuevas `sb_publishable_...` / `sb_secret_...` NO son compatibles con este proyecto y hacen que el login falle con "Failed to fetch".

8. En **Settings → Database** copia el **Connection string** modo `URI` (la necesitarás para el backup).

### Autenticación por correo y contraseña

La app usa **correo + contraseña** (no magic link) para no depender de los límites de envío de correo del plan gratuito de Supabase. Verifica en **Authentication → Providers** que **Email** esté habilitado y que **"Confirm email"** esté **desactivado** (para que el signup sea instantáneo sin correo de verificación).

---

## 3. Configurar el proyecto localmente

Abre PowerShell y navega a la carpeta del proyecto:

```powershell
cd C:\dev\tesoria-cpcc
```

Instala las dependencias:

```powershell
npm install
```

Crea el archivo `.env.local` copiando la plantilla:

```powershell
Copy-Item .env.example .env.local
notepad .env.local
```

Reemplaza los valores con los que copiaste de Supabase:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

Prueba que funciona:

```powershell
npm run dev
```

Abre http://localhost:3000 en el navegador. Deberías ver la pantalla de login.

---

## 4. Subir a GitHub

Inicializa el repositorio y súbelo (el CLI de GitHub simplifica esto):

```powershell
git init
git add .
git commit -m "Inicial: Tesoria CPCC"

# Solo la primera vez:
gh auth login
# Elige: GitHub.com → HTTPS → Login with web browser

gh repo create tesoria-cpcc --private --source=. --push
```

Si no tienes `gh` instalado, crea el repo en la web (https://github.com/new, márcalo **Private**) y luego:

```powershell
git remote add origin https://github.com/TU_USUARIO/tesoria-cpcc.git
git branch -M main
git push -u origin main
```

---

## 5. Desplegar a Vercel

La app corre en Vercel Hobby bajo el team institucional (correo `cpcc.carampangue@gmail.com`, GitHub `cpcccarampangue-sudo`). URL de producción: **https://tesoria-cpcc-ten.vercel.app/**.

### Requisitos importantes antes de empezar

- **El repo GitHub debe estar bajo la misma cuenta que dueña el team Vercel** (`cpcccarampangue-sudo` en nuestro caso). Vercel Hobby **no permite colaboración de otras cuentas** sobre repos privados: si el commit lo firma un correo distinto al del dueño Vercel, el deploy queda "Blocked".
- **Todos los commits deben firmarse con el correo de la cuenta institucional**. Verificalo con `git config user.email` — debe devolver `cpcc.carampangue@gmail.com`. Si no:
  ```powershell
  cd C:\dev\tesoria-cpcc
  git config user.email "cpcc.carampangue@gmail.com"
  git config user.name "Tesoreria CPCC"
  ```
- El archivo `netlify.toml` puede quedar en el repo (Vercel lo ignora), pero conviene borrarlo eventualmente para no confundir.

### Importar el proyecto

1. Entra a https://vercel.com y logueate con la cuenta institucional (GitHub `cpcccarampangue-sudo`, correo `cpcc.carampangue@gmail.com`).
2. Dashboard → **Add New... → Project**.
3. Aparece la lista de repos GitHub. Si `tesoria-cpcc` no está, click **Adjust GitHub App Permissions** y agrega el repo.
4. Click en **Import** al lado de `tesoria-cpcc`.
5. Configuración:
   - **Vercel Team**: `cpcccarampangue-sudo's projects` (Hobby).
   - **Project Name**: `tesoria-cpcc`.
   - **Framework Preset**: Next.js (autodetectado).
   - **Root Directory**: `./`.
6. **Antes de dar Deploy**, expande **Environment Variables** y agrega las 3:

   | Key | Value | Notas |
   |---|---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://xxxxxx.supabase.co` | Sin `/` al final, sin espacios. |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJ...` (llave **legacy** anon) | No la `sb_publishable_...` nueva. |
   | `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` (llave **legacy** service_role) | Muy sensible. |

   Marca las 3 opciones **Production, Preview, Development** para cada variable. **NO marques "Sensitive"** — si no, después no vas a poder verificar los valores.
7. Click **Deploy**. Espera 1-3 min. Al final, debería mostrar **Ready** en el listado de Deployments.

### Después del primer deploy

1. Vercel te asigna una URL tipo `https://tesoria-cpcc-xxxx.vercel.app` (o el alias `tesoria-cpcc.vercel.app` si está libre). Copiala.
2. Verifica en Supabase → **Authentication → URL Configuration**:
   - **Site URL** → poné la URL de Vercel.
   - **Redirect URLs** → agrega la URL de Vercel + `/auth/callback` (aunque hoy la app no use magic link, algunas rutas de reset lo requieren).
3. Probá el login en la URL de Vercel — debería llevarte al dashboard.

### Cambiar env vars después del deploy

Cambiar env vars en Vercel **NO dispara un redeploy automático**. Después de editar, andá a **Deployments** → 3 puntos del último → **Redeploy** → confirmar (dejando el checkbox de build cache marcado).

---

## 6. Primer ingreso y promoción de directiva

1. Abre https://tesoria-cpcc-ten.vercel.app/ (o la URL que te dio Vercel).
2. En la pantalla de login click en el tab **Crear cuenta** e ingresa tu correo + una contraseña (mínimo 8 caracteres).
3. Vas a entrar como **apoderado** por defecto.
4. Ve a Supabase → **SQL Editor** → New query y corre:
   ```sql
   update profiles set role = 'directiva' where email = 'tucorreo@ejemplo.cl';
   ```
5. Refresca la página en el navegador. Ahora verás el panel completo de directiva.
6. Desde `/usuarios` en la app podés cambiar el rol de otras cuentas (a **directiva** o **delegado**) sin tener que volver a tocar SQL, y también vincular manualmente cada cuenta con la familia correspondiente si el trigger automático no lo hizo.

### Vinculación automática de cuentas a familias

Al crear un usuario, un trigger de Supabase intenta vincularlo con la familia cuyo `contactos.email` coincida con el correo de registro. Si el correo se agrega al sheet **después** de que la persona ya se registró, corre una sincronización desde `/apoderados/sincronizar` — al final del sync, se retro-vinculan las cuentas huérfanas. También podés vincular a mano desde `/usuarios` en el dropdown "Familia vinculada".

---

## 7. Backups automáticos y ping anti-pausa

En tu repo de GitHub, ve a **Settings → Secrets and variables → Actions** y agrega:

- **`SUPABASE_DB_URL`**: la connection string de Supabase (paso 2, punto 8). Formato:
  ```
  postgresql://postgres:TU_PASSWORD@db.xxxxxx.supabase.co:5432/postgres
  ```
- **`APP_URL`**: tu URL de Vercel (ej. `https://tesoria-cpcc-ten.vercel.app`).

Los dos workflows ya están configurados:

- `backup.yml` — se ejecuta cada domingo 05:00 UTC (02:00 Chile), hace `pg_dump` y guarda el `.sql.gz` como artifact (retención 90 días).
- `ping.yml` — cada 3 días le pega a `/api/health` para que Supabase no pause el proyecto.

Para probar el backup manualmente: ve a **Actions → Backup semanal Supabase → Run workflow**.

**Consejo**: descarga los artifacts de backup una vez al mes y guárdalos en Google Drive/Dropbox como respaldo extra fuera de GitHub.

---

## 8. Uso del día a día

### Registrar un ingreso o egreso
1. Inicio → **+ Registrar movimiento** (o menú **Movimientos → + Nuevo**).
2. Selecciona fecha, tipo, monto y categoría.
3. Opcionalmente asócialo a un evento.
4. Sube foto de la boleta (la aplicación la comprime sola).
5. Guardar.

### Registrar el pago de una cuota
1. Menú **Cuotas** → haz clic sobre la celda del apoderado × período.
2. Cambia el estado a **Pagada** (o **Parcial**), ingresa monto y fecha.
3. Deja marcado "Registrar como ingreso en el libro de caja" para que se cree el movimiento automáticamente.
4. Guardar.

### Cerrar el balance de un evento
1. Menú **Eventos → clic en el evento**.
2. Verifica el balance (Ingresos, Egresos, Neto).
3. Marca **Cerrar evento** para que no se registren más movimientos.

### Descargar reportes para la reunión de directiva
- Menú **Reportes** → descarga el **Libro de caja** en PDF o CSV.
- El PDF incluye totales automáticos.

---

## 9. Preguntas frecuentes / problemas comunes

**Un apoderado olvidó su contraseña.**
Como directiva, en `/usuarios` puedes eliminar su cuenta y pedirle que vuelva a crearla con el mismo correo (queda vinculada de nuevo automáticamente por email). Alternativa: en Supabase → **Authentication → Users** → busca el correo → menú de 3 puntos → **Send password recovery**.

**Un apoderado dice que ingresó pero no ve sus cuotas.**
Su cuenta quedó sin vincular a la familia. En `/usuarios`, en la fila de esa persona, elige la familia correcta en el dropdown **Familia vinculada** y guarda. Si su correo estaba en el sheet cuando corriste el último sync, la vinculación debería haber sido automática — verifica que su correo en Supabase Auth coincida exactamente con el que está cargado como contacto de la familia (no importan mayúsculas).

**El deploy en Vercel sale "Blocked".**
Ese error significa que el commit fue firmado por un correo distinto al del dueño del team Vercel. En Hobby con repo privado no se permite colaboración. Fix: asegúrate de que `git config user.email` sea el mismo correo institucional del team Vercel antes de commitear. Ver sección 5, "Requisitos importantes".

**El login da "Failed to fetch".**
Casi siempre es que pegaste la llave **nueva** de Supabase (`sb_publishable_...`) en vez de la **legacy** (`eyJ...`). Ve a Vercel → Settings → Environment Variables → borra las 3 y recréalas con los valores del tab "Legacy anon, service_role API keys" de Supabase. **No marques "Sensitive"** para poder revisarlas después. Después del cambio, forzá **Redeploy** en Deployments (cambiar env vars no re-deploya solo).

**Supabase dice que mi proyecto está pausado.**
Entra al dashboard de Supabase y haz clic en **Resume project**. Verifica que el workflow `ping.yml` esté activo en GitHub Actions (Settings → Actions → General).

**Excel abre el CSV con las columnas todas pegadas.**
El CSV usa `;` como separador (estándar es-CL). En Excel: **Datos → Desde texto/CSV**, elige `;` como delimitador.

**La foto de la boleta pesa mucho.**
La app la comprime automáticamente a máximo ~1 MB. Si aun así falla, tómala con menos resolución.

**Necesito volver a correr el `schema.sql` porque cambié algo.**
Es idempotente: puedes copiar-pegar y correr entero de nuevo sin perder datos.

**¿Cómo cambio el logo o el título?**
- Título de la app: edita `app/layout.tsx` (metadata `title`).
- Nombre visible en el header: edita `app/(app)/layout.tsx`.

---

## Créditos

Construido con Next.js, Supabase, Tailwind y ❤️ para las tesoreras de Centros de Padres de Chile.
