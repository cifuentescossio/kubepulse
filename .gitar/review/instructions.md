# KubePulse · Instrucciones de revisión para Gitar

KubePulse es un copiloto de conferencia (KubeCon NA 2026, Salt Lake City): recomienda charlas con
búsqueda híbrida en Elasticsearch y muestra la ocupación de salas con una métrica OpenTelemetry
simulada que va a Dash0. Corre en Kubernetes con GitOps (Argo CD). El repo es **público**.

El contrato entre piezas está en @../../docs/contracts.md. Es la fuente de verdad: si el código y el
contrato no coinciden, el código está mal (o el PR debe cambiar el contrato de forma explícita).

## Qué revisar con prioridad

1. **Secretos.** Ningún token, API key, contraseña, kubeconfig ni header `Authorization` con valor
   real en el código, los manifiestos, los tests, los mocks ni los logs. Las credenciales solo llegan
   por variables de entorno del Secret `kubepulse-secrets`. En el frontend solo puede aparecer
   `DASH0_RUM_TOKEN` (token de solo ingesta), inyectado por la plantilla, nunca escrito a mano.
2. **Horas con zona horaria.** Toda hora en datos, respuestas del API, mocks y tests va en ISO 8601
   con offset explícito de Salt Lake City (`2026-11-09T09:20:00-07:00`). Marca cualquier hora sin
   offset, con `Z` donde el contrato pide `-07:00`, o construida con `new Date()` local sin offset.
3. **Formato del API.** Las respuestas de `/recommend`, `/search`, `/pulse`, `/pulse/history`,
   `/chaos` y `/ask` deben seguir el contrato campo por campo. Los errores son `{ "error": "<mensaje>" }`
   con 400 para entrada inválida. Valida siempre el body y los query params.
4. **Dueños de carpetas.** Cada carpeta tiene un dueño según la tabla del contrato. Un PR que toca
   carpetas de otro módulo debe justificarlo. `app/package.json` solo cambia para agregar
   dependencias necesarias, con versión fijada por el lockfile.
5. **Degradación elegante.** Si Elasticsearch, Dash0 o el LLM fallan o tardan, la app responde con
   un fallback (ranking local, mocks, `degraded: true`) y no rompe la UI. Toda llamada externa tiene
   timeout.
6. **Carga acotada.** Nada de bucles sin fin, timers múltiples ni memoria que crezca sin límite:
   el cluster tiene 2 CPU y 4 GiB de requests en total. El caos (`POST /chaos`) solo existe con
   `DEMO_MODE=true` y siempre tiene duración y latencia máximas.
7. **Kubernetes.** Nada privilegiado, ni `hostPath`, `hostNetwork` o `hostPID`. Todo contenedor con
   requests y limits. No se borra el Service `app` (puerto 80) ni `/healthz` y `/readyz`.
8. **Accesibilidad (frontend).** Elementos nativos (`<button>`, `<a href>`, `<label>`,
   `<fieldset>`), nada de `onclick` en `div`. Estados de ocupación siempre con símbolo + texto +
   porcentaje, nunca solo color. Contraste ≥ 4.5:1. Colores solo vía variables CSS del tema.
9. **Privacidad.** No se rastrea a personas: la ocupación es simulada y el perfil vive en
   `localStorage`. Marca cualquier envío del perfil a terceros o cualquier dato personal en logs.

## Qué no comentar

- Los datos de ocupación son simulados a propósito; no lo marques como riesgo por sí solo.
- La latencia extra durante el caos es intencional para la demo, siempre que esté acotada.
- Las mascotas de Phippy & Friends son CC-BY; solo exige la atribución en el footer.
