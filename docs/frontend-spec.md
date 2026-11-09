# KubePulse · Especificación de frontend

> **Adaptación al stack real:** el repo es Node 22 + Express + Nunjucks (sintaxis igual a Jinja2), no FastAPI.
> Plantillas en `app/views/` (base.html + una por pantalla), estáticos en `app/public/` servidos en `/static`.
> Las rutas de página se definen en `app/src/pages/index.js`. Probar en local con `cd app && npm run dev`
> y abrir http://localhost:8080/perfil. Formatos de datos: `docs/contracts.md` (manda sobre este archivo).
> Diseño de referencia: `docs/design/perfil.png`, `agenda.png`, `pulso.png`, `temas.png`.

## Restricciones técnicas
- Sin build de frontend: HTML + CSS + JS plano. Una plantilla base (base.html) con header común; cada pantalla la extiende.
- Librerías solo por CDN y con versión fija: Chart.js 4.4.1 (cdnjs). Google Fonts: Inter, Space Grotesk (títulos) y Atkinson Hyperlegible (tema lectura).
- Nada de secretos en el frontend. El token de Dash0 para RUM es uno aparte de solo ingesta, inyectado por la plantilla (DASH0_RUM_TOKEN), nunca hardcodeado.
- PRs pequeños, uno por pantalla o feature, porque Gitar revisa cada PR.

## Pantallas (flujo de 3 pasos)
1. **/perfil** — "Paso 1 de 3 · Tu perfil"
   - Bienvenida con Phippy y el texto: "Con esto armamos tu agenda de KubeCon y te avisamos cuando una sala se llena." Nota visible: "No rastreamos tu ubicación. Tu perfil se queda en tu navegador."
   - Formulario: nombre (input), rol (select: Platform Engineer, SRE / DevOps, Developer, Security, Estudiante), intereses como chips (Agentes, Platform Engineering, MCP, Seguridad, Observabilidad, eBPF, GitOps, Inferencia / GPUs; elegir 2 a 5), nivel (Cualquier nivel, Principiante, Avanzado), idioma (Español, English).
   - Bloque "Accesibilidad" con checkboxes: subtítulos en vivo, salas accesibles en silla de ruedas, evitar salas muy llenas (sensibilidad sensorial).
   - Botones "Saltar" y "Armar mi agenda →". Perfil en localStorage `kubepulse.profile`.
2. **/agenda** — "Paso 2 de 3 · Tu agenda propuesta"
   - "{nombre}, esta es tu ruta para hoy" + subtítulo con día, evento y tags.
   - Línea de tiempo vertical: hora, ícono de tema, título, ponente · sala, "Por qué: {tags}", y si hay charla en paralelo "En paralelo: {título} ({sala})" como enlace para intercambiarla. Chip de pronóstico a la derecha.
   - Filas no clicables para pausas ("10:25 · Break de café", "11:40 · Almuerzo").
   - Lateral: resumen (tags, número de charlas, franjas con alternativa), aviso de Obee ("La de las 3:55 suele llenarse. Si se llena, te aviso…"), botones "Confirmar y ver el pulso →" y "← Editar intereses".
   - Datos: POST /recommend con el perfil (formato en contracts.md).
3. **/pulso** — "Pulso en vivo" (pantalla principal de la demo)
   - Banner de Obee cuando cambia algo: "La sala de tu siguiente charla está al 96%. Te propongo {charla} en {sala}, que también es de {tag} y está al {x}%." con botón "Cambiar".
   - Izquierda "Tu ruta de hoy": charlas confirmadas con ocupación actual; llena → borde rojo de 2px.
   - Derecha "Pulso de las salas": tarjetas por sala con porcentaje grande + estado, y gráfico de línea (Chart.js) de la ocupación de tu siguiente sala en 30 min (GET /pulse/history), línea punteada en 90%. Keddy en este panel.
   - Texto: "Datos simulados vía OpenTelemetry · también en Dash0".
   - Polling cada 5 s a GET /pulse. Si tarda o falla, mostrar el último dato con "hace X s" sin romper la UI.
   - "Botón de caos" visible solo con ?demo=1 → POST /chaos; la barra sube en vivo y aparece el banner de Obee.

## Header común
- Fondo con el acento del tema, Obee a la izquierda + "KubePulse" en Space Grotesk.
- Derecha: botón "Tema: {nombre} ▾" (menú) y grupo ES | EN (botones con aria-pressed).
- En /pulso además: tags del perfil como chips + enlace "Editar perfil".

## Estados de ocupación (nunca solo color)
< 50% "● Hay espacio" · 50–89% "▲ Llenándose" · ≥ 90% "■ Llena". Siempre símbolo + texto + porcentaje.

## Temas (variables CSS en `:root[data-theme="..."]`, localStorage `kubepulse.theme`)
Variables: --bg, --surface, --border, --text, --muted, --header-bg, --header-text, --accent, --btn-bg, --btn-text, --low-bg, --low-text, --mid-bg, --mid-text, --high-bg, --high-text, --font-body, --font-size-base, --line-height, --letter-spacing, --radius.
- **kube** (default): bg #F6F7FB, header #326CE5, texto #1F2933, botón #1F2933. Ocupación: bajo #E4F4EC/#1E6B43, medio #FDF0DC/#8A5300, alto #FBE3E1/#A42A24.
- **dark**: bg #0E1420, surface #151D2C, borde #2A3650, texto #E6EAF2, muted #A3AEC2, acento #5B8DEF, botón #5B8DEF con texto #0E1420. Ocupación: #12372A/#86E5B5, #3A2A10/#F2C27A, #3A1513/#FFB4AE. Respetar prefers-color-scheme: dark si no hay preferencia guardada.
- **mujeres**: degradado #FFF0F5 → #FBEFFF, header #C2255C, franja bajo el header #F783AC/#E599F7/#FCC2D7, texto #3D1A2B, muted #7A4A5E, botón #A61E4D, radios tipo píldora, logo "♡ KubePulse".
- **daltonismo** (Okabe-Ito): header #0072B2, texto #1A1A1A. Ocupación: bajo #DCEEF8/#00507D, medio #FCEFD2/#7A5200, alto con rayas diagonales #F9DFD0/#F2C9B2 y texto #8F3A00. Nunca verde contra rojo.
- **lectura**: Atkinson Hyperlegible, base 17-18px, line-height 1.7, letter-spacing .02em, fondo #FFFDF5, header #111111, bordes 2px #111111, enlaces subrayados, botón #1F4FB8, sin cursivas.
- **pride**: header con franjas arcoíris (#E40303, #FF8C00, #FFED00, #008026, #004DFF, #750787) y logo en píldora blanca; debajo franja Progress Pride (#FFFFFF, #F5A9B8, #5BCEFA, #784F17, #000000); botón #750787; borde de tarjeta #004DFF.
El cambio de tema solo cambia data-theme en `<html>`; ningún componente lleva colores fijos.

## Idioma (i18n)
`/static/i18n.json` con claves ES y EN; el JS reemplaza textos con `data-i18n="clave"`. Idioma en localStorage `kubepulse.lang` y en `<html lang>`. Los títulos de charlas NO se traducen.

## Mascotas Phippy & Friends (CC-BY)
- SVG oficiales de github.com/cncf/artwork, carpeta other/phippy-and-friends: obee_full.svg, phippy_full.svg, keddy_full.svg → `app/public/mascots/`.
- Las mascotas son la voz de la app y NUNCA etiquetan charlas. Obee: header y mensajes del asistente. Phippy: bienvenida del perfil. Keddy: alertas y panel de pulso.
- Charlas con íconos neutros por tema (SVG en línea con stroke): Agentes/MCP = chip de procesador (azul), Seguridad = escudo (rojo), Platform Engineering = capas (verde).
- Footer en todas las páginas: `Personajes de Phippy & Friends · <a href="https://phippy.io">phippy.io</a> (CC-BY)`.

## Accesibilidad (premio Merge Forward)
- Elementos reales: `<button>`, `<a href>`, `<input>` con `<label>`, `<fieldset>`/`<legend>`. Nada de onClick en divs.
- Áreas táctiles ≥ 44px. Contraste de texto ≥ 4.5:1 en todos los temas.
- aria-label en botones solo con ícono; mascotas con alt; gráficos con role="img" y aria-label que resuma el dato.
- < 768px: columnas apiladas y header con wrap.
- Banner de Obee en una región aria-live="polite".

## Observabilidad en el frontend (track Dash0)
- SDK web de Dash0 (RUM) en base.html con DASH0_RUM_TOKEN y DASH0_RUM_ENDPOINT; si no hay token, no se carga.
- Eventos: profile_saved, agenda_confirmed, theme_changed, lang_changed, recommendation_switched, chaos_triggered.

## Orden de trabajo (un commit/PR por punto)
1. base.html + CSS de temas + selector de tema + i18n.
2. /perfil con localStorage.
3. /agenda con POST /recommend (fallback a /static/mock/agenda.json).
4. /pulso con polling, gráfico y banner de Obee (fallback a /static/mock/pulse.json).
5. Botón de caos + RUM de Dash0.
6. Pasada de accesibilidad y responsive.
