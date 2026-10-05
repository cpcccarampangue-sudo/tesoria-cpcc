# Configuración del módulo de Socios

Este documento resume las credenciales y pasos manuales necesarios para que el módulo de socios funcione **completamente integrado** (SumUp API + Resend email).

> **Importante**: la fase 1 (sin integración) funciona sin ninguna configuración externa. El panel admin permite aprobar manualmente y marcar como enviadas las solicitudes. La configuración de abajo es para activar la **fase 2** (confirmación automática del pago vía webhook SumUp y envío automático del QR por correo con Resend).

---

## 1. Resend (envío de correos)

### Crear cuenta y API Key

1. Entra a <https://resend.com/signup> y crea cuenta con `cpcc.carampangue@gmail.com`.
2. Entra al dashboard → **API Keys** → **Create API Key**.
3. Nombre: `tesoria-cpcc-produccion`. Permisos: `Full access` (o solo `Sending access`).
4. Copia la API key (empieza con `re_...`) — **solo se muestra una vez**.

### Verificar dominio remitente (opcional pero recomendado)

Por defecto Resend permite enviar desde `onboarding@resend.dev` para pruebas. Para enviar desde `noreply@centropadrescarampangue.cl` (más profesional):

1. En Resend → **Domains** → **Add Domain** → `centropadrescarampangue.cl`.
2. Resend te mostrará registros DNS (TXT, MX, DKIM) que hay que agregar al dominio.
3. Como el DNS está en Vercel (controlado por tu compañera), pídele que los agregue en el panel DNS del dominio.
4. Resend verifica automáticamente en unos minutos.

### Env vars en Vercel

Agrega en Vercel → Project `tesoria-cpcc` → Settings → Environment Variables:

```
RESEND_API_KEY=re_xxxxxxxxxxxxxx
RESEND_FROM=Tesorería CPCC <noreply@centropadrescarampangue.cl>
RESEND_REPLY_TO=cpcc.carampangue@gmail.com
```

- Si aún no verificaste el dominio, puedes dejar `RESEND_FROM` sin seteo y usará `onboarding@resend.dev` por defecto (funciona pero el correo le llega al apoderado desde ese dominio raro).
- Marca las 3 env vars para los 3 ambientes (Production, Preview, Development).
- **No** marques "Sensitive" (puede traer problemas si necesitas revisar el valor después).

Después de agregar las vars, redeploy el proyecto desde Deployments → Redeploy.

---

## 2. SumUp (checkout dinámico + webhook)

### Generar API Key

1. Entra a <https://me.sumup.com> → **Ajustes** → **Para desarrolladores** → tab **Claves API**.
2. **Crear nueva clave**. Nombre: `tesoria-cpcc-produccion`. Permisos: al menos `payments` (lectura y escritura).
3. Copia la clave — se muestra una sola vez.

### Obtener Merchant Code

Es el código corto que aparece arriba a la izquierda del dashboard SumUp. Para esta cuenta es: **`MCAEMEYF`** (confirmar en el dashboard por si cambia).

### Configurar webhook

1. En el mismo dashboard → **Webhooks** (si no aparece, puede estar bajo "Para desarrolladores" → algún tab de notificaciones).
2. **Crear webhook** con:
   - **URL**: `https://tesoria-cpcc.vercel.app/api/webhooks/sumup`
     (reemplazar por el dominio custom si ya está activo, ej. `https://tesoreria.centropadrescarampangue.cl/api/webhooks/sumup`)
   - **Eventos a escuchar**: `checkout.paid` (o similar — SumUp va cambiando los nombres).
   - **Secret**: genera uno largo (ej. 32 caracteres aleatorios). Lo copias para Vercel.
3. Guardar.

### Env vars en Vercel

```
SUMUP_API_KEY=sup_sk_xxxxxxxxxxxx
SUMUP_MERCHANT_CODE=MCAEMEYF
SUMUP_WEBHOOK_SECRET=<el secreto que generaste>
NEXT_PUBLIC_SITE_URL=https://tesoria-cpcc.vercel.app
```

- `NEXT_PUBLIC_SITE_URL` se usa para construir la URL que codifica el QR y el link que ve el apoderado. Si ya tienes el dominio custom activo, usa ese valor.

Después de agregar las vars, redeploy.

---

## 3. Testing

### Verificar que Resend envía

1. Después de redeploy, entra a la app como directiva.
2. Crea una solicitud de prueba desde `/incorporacion` con tu propio correo.
3. Marca como pagada manualmente desde el admin.
4. Click en "Enviar QR por correo".
5. Revisa tu bandeja de entrada (y spam) — deberías recibir el correo con el QR embebido.

### Verificar que el webhook SumUp funciona

1. Desde el modo sandbox de SumUp (en "Para desarrolladores" → **Sandboxes**) puedes crear transacciones de prueba sin pagar realmente.
2. Alternativamente, en producción, haz un cobro mínimo de prueba ($100 CLP) desde `/incorporacion` con tu propio correo. SumUp cobrará esos $100.
3. Al confirmarse el pago, verifica en el panel admin `/socios` que la solicitud pasó automáticamente a estado "QR enviado".
4. El apoderado (tú en el test) debería haber recibido el correo con el QR al segundo.

### Verificar el validador PWA

1. Abre `/validar` desde el celular.
2. Permite el acceso a la cámara.
3. Escanea el QR del correo de prueba.
4. Debería mostrar tarjeta verde "Socio activo 2026".
5. Opcional: desde el navegador móvil, menú → "Agregar a pantalla de inicio" para instalarlo como app.

---

## 4. Mantenimiento

### Rotar API keys

Si por alguna razón se filtra alguna clave:

- **Resend**: en el dashboard, elimina la key vieja y crea una nueva.
- **SumUp**: lo mismo, en Claves API elimina la vieja y crea otra.

En ambos casos, actualiza la env var en Vercel y redeploy.

### Cambiar el dominio del remitente

Si cambia el dominio del CdP, repite el paso de verificación de dominio en Resend y actualiza `RESEND_FROM` en Vercel.

### Sin webhook (fallback manual)

Si SumUp o el webhook caen por alguna razón, el flujo degrada automáticamente:

- La solicitud queda en estado **"pendiente_pago"**.
- Tú (tesorera) ves el pago en tu cuenta bancaria o en el dashboard SumUp.
- En el panel admin, marcas la solicitud como **"pagada"** manualmente.
- Click en **"Enviar QR por correo"** manda el correo.

Es decir, el sistema sigue funcionando aunque falte alguna integración.
