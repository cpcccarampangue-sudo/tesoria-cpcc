# Tesorería CPCC

Sistema web para llevar las cuentas del Centro de Padres. Directiva registra movimientos, cuotas, eventos y boletas; los apoderados ven sus cuotas y los balances agregados.

- **Stack**: Next.js 15 + Supabase (Postgres, Auth, Storage) — todo en capa gratuita.
- **Idioma**: español (Chile). Montos en CLP sin decimales.
- **Costo**: $0/mes.

---

## Índice

1. [Requisitos previos](#1-requisitos-previos)
2. [Configurar Supabase](#2-configurar-supabase)
3. [Configurar el proyecto localmente](#3-configurar-el-proyecto-localmente)
4. [Subir a GitHub](#4-subir-a-github)
5. [Desplegar a Netlify](#5-desplegar-a-netlify)
6. [Primer ingreso y promoción de directiva](#6-primer-ingreso-y-promoci%C3%B3n-de-directiva)
7. [Backups automáticos y ping anti-pausa](#7-backups-autom%C3%A1ticos-y-ping-anti-pausa)
8. [Uso del día a día](#8-uso-del-d%C3%ADa-a-d%C3%ADa)
9. [Preguntas frecuentes / problemas comunes](#9-preguntas-frecuentes--problemas-comunes)

---

## 1. Requisitos previos

Vas a necesitar (todo gratis):

- **Cuenta en GitHub** — https://github.com/signup
- **Cuenta en Netlify** — https://app.netlify.com/signup (regístrate con GitHub, más fácil)
- **Cuenta en Supabase** — https://supabase.com/dashboard (regístrate con GitHub)

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
7. En el menú lateral ve a **Settings → API** y copia estos tres valores (los usarás en el paso 3):
   - **Project URL** (ej. `https://xxxxxx.supabase.co`)
   - **anon public** (clave pública)
   - **service_role** (clave secreta — **NO COMPARTIR**)
8. En **Settings → Database** copia el **Connection string** modo `URI` (la necesitarás para el backup).

### Configurar el redirect del magic link

- Menú lateral → **Authentication → URL Configuration**.
- En **Site URL** pon `http://localhost:3000` por ahora. Cuando despliegues en Netlify, edítalo a `https://tu-app.netlify.app`.
- En **Redirect URLs** agrega:
  - `http://localhost:3000/auth/callback`
  - `https://tu-app.netlify.app/auth/callback` (cuando tengas la URL de Netlify)

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

## 5. Desplegar a Netlify

Netlify no pide teléfono, solo email o GitHub. Es gratis: 100 GB de tráfico y 300 minutos de build al mes — más que suficiente para el Centro de Padres.

1. Entra a https://app.netlify.com/signup y regístrate con **GitHub** (lo más simple).
2. Una vez dentro: **Add new site → Import an existing project → Deploy with GitHub**.
3. Autoriza a Netlify a leer tus repos y selecciona `tesoria-cpcc`.
4. Netlify detecta que es Next.js automáticamente. La configuración ya está en el archivo `netlify.toml` del repo (build command, plugin de Next.js). No cambies nada en esta pantalla.
5. Antes de hacer deploy, expande **Add environment variables** y agrega:
   - `NEXT_PUBLIC_SUPABASE_URL` = tu URL de Supabase
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = tu anon key
   - `SUPABASE_SERVICE_ROLE_KEY` = tu service_role
   - `NEXT_PUBLIC_SITE_URL` = deja `http://localhost:3000` por ahora (lo actualizas después del primer deploy)
6. Haz clic en **Deploy site** y espera 2-3 minutos.

**Después del primer deploy:**

1. Netlify te asigna una URL tipo `https://elegant-newton-abc123.netlify.app`. Copia esa URL.
2. (Opcional) Ve a **Site configuration → Change site name** y ponle algo memorable, ej. `tesoria-cpcc`. La URL queda `https://tesoria-cpcc.netlify.app`.
3. Vuelve a Supabase → **Authentication → URL Configuration** y actualiza:
   - **Site URL** → `https://tesoria-cpcc.netlify.app`
   - **Redirect URLs** → añade `https://tesoria-cpcc.netlify.app/auth/callback`
4. En Netlify → **Site configuration → Environment variables**, edita `NEXT_PUBLIC_SITE_URL` con la URL definitiva y luego ve a **Deploys → Trigger deploy → Clear cache and deploy site** para que aplique.

---

## 6. Primer ingreso y promoción de directiva

1. Abre `https://tesoria-cpcc.netlify.app`.
2. Ingresa tu correo (el de la tesorera) y haz clic en **Enviar enlace mágico**.
3. Revisa tu correo (puede llegar a spam la primera vez) y haz clic en el enlace.
4. Vas a entrar como **apoderado** por defecto y verás el mensaje de que tu cuenta no está vinculada.
5. Ve a Supabase → **SQL Editor** → New query y corre:
   ```sql
   update profiles set role = 'directiva' where email = 'tucorreo@ejemplo.cl';
   ```
6. Refresca la página en el navegador. Ahora verás el panel completo de directiva.
7. Repite el paso 5 con los correos de otras personas de la directiva (después de que hayan hecho su primer login).

---

## 7. Backups automáticos y ping anti-pausa

En tu repo de GitHub, ve a **Settings → Secrets and variables → Actions** y agrega:

- **`SUPABASE_DB_URL`**: la connection string de Supabase (paso 2, punto 8). Formato:
  ```
  postgresql://postgres:TU_PASSWORD@db.xxxxxx.supabase.co:5432/postgres
  ```
- **`APP_URL`**: tu URL de Netlify (ej. `https://tesoria-cpcc.netlify.app`).

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

**El magic link no me llega.**
Espera 2 minutos y revisa la carpeta de spam. Si sigue sin llegar, revisa **Supabase → Authentication → Logs** para ver si hubo un error.

**Un apoderado dice que ingresó pero no ve sus cuotas.**
Verifica que el email con el que ingresó coincida (mayúsculas/minúsculas no importan) con el email cargado en **Apoderados**. Si es distinto, edita el registro del apoderado con el email correcto o pide al usuario que ingrese con el email registrado.

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
