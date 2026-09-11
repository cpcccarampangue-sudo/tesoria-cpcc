import Link from "next/link";
import { requireProfile } from "@/lib/auth";

export const metadata = { title: "Ayuda — Tesorería CPCC" };

export default async function AyudaPage() {
  const profile = await requireProfile();
  const esDirectiva = profile.role === "directiva";
  const esDelegado = profile.role === "delegado";

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Ayuda del sistema</h1>
        <p className="text-sm text-slate-600 mt-1">
          Guía rápida para usar Tesorería CPCC. Si algo no aparece aquí o no
          te queda claro, contacta a alguien de la directiva.
        </p>
      </div>

      {/* Índice */}
      <nav className="card text-sm">
        <div className="font-semibold mb-2">En esta página</div>
        <ul className="space-y-1 text-brand-700">
          <li>
            <a href="#ingresar" className="hover:underline">
              Cómo ingresar al sistema
            </a>
          </li>
          <li>
            <a href="#roles" className="hover:underline">
              Roles: qué puede hacer cada usuario
            </a>
          </li>
          <li>
            <a href="#modulos" className="hover:underline">
              Explicación de cada módulo del menú
            </a>
          </li>
          <li>
            <a href="#faq" className="hover:underline">
              Preguntas frecuentes
            </a>
          </li>
        </ul>
      </nav>

      {/* Cómo ingresar */}
      <section id="ingresar" className="card space-y-3">
        <h2 className="text-lg font-semibold">Cómo ingresar al sistema</h2>

        <div>
          <h3 className="font-semibold text-sm mt-2">Primera vez (crear cuenta)</h3>
          <ol className="list-decimal pl-5 text-sm space-y-1 mt-1">
            <li>
              Abre{" "}
              <a
                href="https://tesoria-cpcc.vercel.app/"
                className="text-brand-700 hover:underline"
              >
                tesoria-cpcc.vercel.app
              </a>
              .
            </li>
            <li>En la pantalla de ingreso, pulsa la pestaña <strong>Crear cuenta</strong>.</li>
            <li>
              Ingresa tu correo electrónico y una contraseña (mínimo 8
              caracteres).
            </li>
            <li>
              Vas a entrar como <strong>Apoderado</strong> por defecto. Si
              corresponde, la directiva puede cambiarte el rol después.
            </li>
          </ol>
        </div>

        <div>
          <h3 className="font-semibold text-sm mt-3">Iniciar sesión</h3>
          <ol className="list-decimal pl-5 text-sm space-y-1 mt-1">
            <li>
              Ingresa el correo y la contraseña que registraste y pulsa{" "}
              <strong>Ingresar</strong>.
            </li>
            <li>
              Si es tu primer inicio con una contraseña temporal entregada por
              la directiva, el sistema te obliga a cambiarla antes de continuar.
            </li>
          </ol>
        </div>

        <div>
          <h3 className="font-semibold text-sm mt-3">Olvidé mi contraseña</h3>
          <p className="text-sm mt-1">
            Por seguridad, no hay restablecimiento automático por correo. Pide
            a alguien de la directiva que restablezca tu contraseña desde el
            módulo <strong>Usuarios</strong>.
          </p>
        </div>
      </section>

      {/* Roles */}
      <section id="roles" className="card space-y-3">
        <h2 className="text-lg font-semibold">Roles: qué puede hacer cada usuario</h2>
        <div className="grid grid-cols-1 gap-3 text-sm">
          <div className="rounded border border-slate-200 p-3">
            <div className="font-semibold">Directiva</div>
            <p className="text-slate-600 mt-1">
              Acceso completo: registrar movimientos, gestionar cuentas, subir
              cartolas bancarias, definir cuotas y eventos, administrar
              familias y categorías, generar reportes, editar la directiva
              vigente y administrar usuarios.
            </p>
          </div>
          <div className="rounded border border-slate-200 p-3">
            <div className="font-semibold">Delegado/a de curso</div>
            <p className="text-slate-600 mt-1">
              Ve la información de los apoderados de su curso (para revisar
              cuotas y coordinar). No puede registrar movimientos ni editar
              datos generales del CdP.
            </p>
          </div>
          <div className="rounded border border-slate-200 p-3">
            <div className="font-semibold">Apoderado/a</div>
            <p className="text-slate-600 mt-1">
              Ve el estado de sus cuotas, los eventos del CdP y los balances
              agregados. No puede ver movimientos individuales ni datos de
              otras familias.
            </p>
          </div>
        </div>
      </section>

      {/* Módulos */}
      <section id="modulos" className="card space-y-4">
        <h2 className="text-lg font-semibold">
          Módulos del menú
        </h2>
        <p className="text-sm text-slate-600">
          Solo verás en el menú los módulos que tu rol permite usar.
        </p>

        {esDirectiva && (
          <div className="space-y-3 text-sm">
            <ModuloItem
              titulo="Inicio"
              descripcion="Panel principal con el saldo por cada cuenta, un resumen de ingresos y egresos del mes, y accesos rápidos a las acciones más frecuentes."
            />
            <ModuloItem
              titulo="Movimientos"
              descripcion="Registrar ingresos y egresos, consultar el historial, filtrar por cuenta, categoría, evento o fecha. Desde aquí también se crean las transferencias internas entre cuentas y, en cada egreso, se puede generar el acta de recibo de dineros lista para imprimir y firmar."
            />
            <ModuloItem
              titulo="Cuentas"
              descripcion="Administrar las 'ubicaciones' reales de la plata del CdP: cuenta del Banco Estado (principal), Cuenta FAN del Banco de Chile (operativa) y caja chica. Puedes editar nombres, marcar la cuenta principal y activar/desactivar sin perder el historial."
            />
            <ModuloItem
              titulo="Cartolas"
              descripcion="Subir las cartolas bancarias en Excel (Banco Estado o Banco de Chile). El sistema parsea las líneas y luego permite conciliarlas con los movimientos ya registrados en el sistema para verificar que todo cuadra."
            />
            <ModuloItem
              titulo="Cuotas"
              descripcion="Definir los periodos de cuota (por ejemplo, la cuota anual) y registrar el pago de cada familia. Al marcar una cuota como pagada, se puede crear automáticamente el ingreso correspondiente en el libro de caja."
            />
            <ModuloItem
              titulo="Eventos"
              descripcion="Agrupar ingresos y egresos por evento (kermés, rifa, paseo, etc.) para obtener el balance de cada uno. Los eventos se pueden cerrar cuando ya no van a recibir más movimientos."
            />
            <ModuloItem
              titulo="Familias"
              descripcion="Listado de familias (apoderados) del colegio, con sus contactos y estudiantes. Se pueden importar desde Excel, sincronizar con una hoja externa y vincular con las cuentas de usuario del sistema."
            />
            <ModuloItem
              titulo="Categorías"
              descripcion="Catálogo de categorías de ingreso (cuota apoderado, donación, aporte del colegio, etc.) y de egreso (materiales, premios, transporte, etc.) para organizar los movimientos."
            />
            <ModuloItem
              titulo="Reportes"
              descripcion="Descargar el libro de caja (PDF o CSV) para presentarlo en reuniones de directiva o rendiciones. Incluye totales y filtros por fecha, evento o cuenta."
            />
            <ModuloItem
              titulo="Directiva"
              descripcion="Registrar los miembros vigentes de la directiva del CdP (presidenta, tesorera, secretaria, etc.). Estos datos se usan automáticamente en las actas de recibo de dineros como firmantes."
            />
            <ModuloItem
              titulo="Usuarios"
              descripcion="Administrar los usuarios registrados en el sistema: cambiarles el rol (directiva, delegado, apoderado), vincularlos con la familia correspondiente y asignar el curso a los delegados."
            />
            <ModuloItem
              titulo="Ayuda"
              descripcion="Esta misma página. Puedes volver aquí en cualquier momento."
            />
          </div>
        )}

        {!esDirectiva && (
          <div className="space-y-3 text-sm">
            <ModuloItem
              titulo="Inicio"
              descripcion="Resumen agregado del CdP: saldo total (sin detalles de movimientos individuales) y accesos a las secciones que puedes usar."
            />
            <ModuloItem
              titulo={esDelegado ? "Cuotas del curso" : "Mis cuotas"}
              descripcion={
                esDelegado
                  ? "Estado de las cuotas de todas las familias del curso que se te asignó. Útil para coordinar y hacer seguimiento de pagos."
                  : "Estado actualizado de las cuotas de tu familia por cada periodo definido por el CdP."
              }
            />
            <ModuloItem
              titulo="Eventos"
              descripcion="Listado de eventos del CdP con su balance agregado (ingresos, egresos y neto). No incluye detalle de movimientos individuales."
            />
            <ModuloItem
              titulo="Ayuda"
              descripcion="Esta misma página."
            />
          </div>
        )}
      </section>

      {/* FAQ */}
      <section id="faq" className="card space-y-3">
        <h2 className="text-lg font-semibold">Preguntas frecuentes</h2>
        <div className="space-y-3 text-sm">
          <div>
            <div className="font-semibold">No puedo iniciar sesión.</div>
            <p className="text-slate-600 mt-1">
              Verifica que el correo y la contraseña sean exactamente los que
              registraste (respeta mayúsculas y minúsculas). Si sigue sin
              funcionar, pide a la directiva que restablezca tu contraseña
              desde <Link href="/usuarios" className="text-brand-700 hover:underline">Usuarios</Link>.
            </p>
          </div>

          <div>
            <div className="font-semibold">
              Registré mi cuenta pero no veo mis cuotas.
            </div>
            <p className="text-slate-600 mt-1">
              Es probable que tu cuenta aún no esté vinculada a tu familia. La
              directiva puede hacerlo manualmente desde{" "}
              <Link
                href="/usuarios"
                className="text-brand-700 hover:underline"
              >
                Usuarios
              </Link>{" "}
              seleccionando la familia correspondiente en tu fila.
            </p>
          </div>

          {esDirectiva && (
            <>
              <div>
                <div className="font-semibold">
                  ¿Cómo genero el acta de recibo de dineros de un egreso?
                </div>
                <p className="text-slate-600 mt-1">
                  Abre el detalle del egreso en{" "}
                  <Link
                    href="/movimientos"
                    className="text-brand-700 hover:underline"
                  >
                    Movimientos
                  </Link>{" "}
                  y pulsa el botón{" "}
                  <strong>🧾 Generar acta</strong>. Se abre una vista lista
                  para imprimir con los datos ya rellenados; puedes elegir si
                  firma solo la tesorera o también la presidenta,
                  vicepresidenta o secretaria (siempre que estén activas en{" "}
                  <Link
                    href="/directiva"
                    className="text-brand-700 hover:underline"
                  >
                    Directiva
                  </Link>
                  ).
                </p>
              </div>

              <div>
                <div className="font-semibold">
                  ¿Cómo verifico si un pago del banco ya está registrado?
                </div>
                <p className="text-slate-600 mt-1">
                  Sube la cartola del mes en{" "}
                  <Link
                    href="/cartolas"
                    className="text-brand-700 hover:underline"
                  >
                    Cartolas
                  </Link>{" "}
                  y usa la sección <strong>Reconciliar</strong>. El sistema
                  compara automáticamente las líneas del banco con los
                  movimientos registrados y muestra las coincidencias, las
                  sugerencias por revisar y las líneas sin coincidencia.
                </p>
              </div>

              <div>
                <div className="font-semibold">
                  Cambió la directiva. ¿Qué debo actualizar?
                </div>
                <p className="text-slate-600 mt-1">
                  En{" "}
                  <Link
                    href="/directiva"
                    className="text-brand-700 hover:underline"
                  >
                    Directiva
                  </Link>{" "}
                  agrega a los nuevos miembros con su cargo. Al marcar a
                  alguien nuevo como activo en un cargo, el anterior queda
                  automáticamente inactivo. Los RUT se pueden completar después
                  si no los tienes a mano.
                </p>
              </div>

              <div>
                <div className="font-semibold">
                  Registré un movimiento equivocado. ¿Cómo lo corrijo?
                </div>
                <p className="text-slate-600 mt-1">
                  Abre el movimiento desde{" "}
                  <Link
                    href="/movimientos"
                    className="text-brand-700 hover:underline"
                  >
                    Movimientos
                  </Link>
                  , edita los campos y guarda. Si prefieres eliminarlo, hay un
                  botón <strong>Eliminar</strong> al final del formulario. Las
                  transferencias internas no se editan: se eliminan y se
                  vuelven a crear.
                </p>
              </div>

              <div>
                <div className="font-semibold">
                  El PDF de un acta o reporte se ve raro al imprimir.
                </div>
                <p className="text-slate-600 mt-1">
                  En el navegador, al abrir la vista de impresión pulsa{" "}
                  <strong>Ctrl + P</strong>, deja el tamaño de papel en{" "}
                  <strong>Carta</strong> y los márgenes en{" "}
                  <strong>Predeterminados</strong>. Desactiva la opción de
                  encabezado y pie del navegador para que el documento salga
                  limpio.
                </p>
              </div>
            </>
          )}
        </div>
      </section>

      <div className="text-xs text-slate-500 text-center">
        ¿Falta algo en esta guía? Cuéntale a alguien de la directiva para que
        la ampliemos.
      </div>
    </div>
  );
}

function ModuloItem({
  titulo,
  descripcion,
}: {
  titulo: string;
  descripcion: string;
}) {
  return (
    <div className="border-l-2 border-brand-300 pl-3">
      <div className="font-semibold text-slate-900">{titulo}</div>
      <div className="text-slate-600">{descripcion}</div>
    </div>
  );
}
