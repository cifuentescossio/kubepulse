# KubePulse · Frontend specification

> **Adapted to the real stack:** the repo is Node 22 + Express + Nunjucks (same syntax as Jinja2), not FastAPI.
> Templates in `app/views/` (base.html + one per screen), static files in `app/public/` served at `/static`.
> Page routes are defined in `app/src/pages/index.js`. Try it locally with `cd app && npm run dev`
> and open http://localhost:8080/profile. Data formats: `docs/contracts.md` (it takes precedence over this file).
> Reference design: `docs/design/perfil.png`, `agenda.png`, `pulso.png`, `temas.png`.
> The pages are now served at `/profile`, `/schedule` and `/live`; the original Spanish URLs (`/perfil`, `/agenda`,
> `/pulso`) redirect to them with a 301.

## Technical constraints
- No frontend build: plain HTML + CSS + JS. One base template (base.html) with the shared header; each screen extends it.
- Libraries only from a CDN and with a pinned version: Chart.js 4.4.1 (cdnjs). Google Fonts: Inter, Space Grotesk (headings) and Atkinson Hyperlegible (reading theme).
- No secrets in the frontend. The Dash0 RUM token is a separate ingest-only token, injected by the template (DASH0_RUM_TOKEN), never hardcoded.
- Small PRs, one per screen or feature, because Gitar reviews every PR.

## Screens (3-step flow)
1. **/profile** — "Step 1 of 3 · Your profile"
   - Welcome with Phippy and the text: "We use this to build your KubeCon agenda and to let you know when a room fills up." Visible note: "We don't track your location. Your profile stays in your browser."
   - Form: name (input), role (select: Platform Engineer, SRE / DevOps, Developer, Security, Student), interests as chips (Agents, Platform Engineering, MCP, Security, Observability, eBPF, GitOps, Inference / GPUs; pick 2 to 5), level (Any level, Beginner, Advanced), language (Español, English).
   - "Accessibility" block with checkboxes: live captions, wheelchair-accessible rooms, avoid very crowded rooms (sensory sensitivity).
   - "Skip" and "Build my agenda →" buttons. Profile in localStorage `kubepulse.profile`.
2. **/schedule** — "Step 2 of 3 · Your proposed agenda"
   - "{name}, here is your route for today" + subtitle with day, event and tags.
   - Vertical timeline: time, topic icon, title, speaker · room, "Why: {tags}", and when there is a parallel talk, "In parallel: {title} ({room})" as a link to swap it. Forecast chip on the right.
   - Non-clickable rows for breaks ("10:25 · Coffee break", "11:40 · Lunch").
   - Sidebar: summary (tags, number of talks, slots with an alternative), notice from Obee ("The 3:55 one usually fills up. If it does, I'll let you know…"), buttons "Confirm and see the pulse →" and "← Edit interests".
   - Data: POST /recommend with the profile (format in contracts.md).
3. **/live** — "Live pulse" (the demo's main screen)
   - Obee banner when something changes: "The room for your next talk is at 96%. I suggest {talk} in {room}, which is also about {tag} and is at {x}%." with a "Switch" button.
   - Left, "Your route today": confirmed talks with current occupancy; full → 2px red border.
   - Right, "Room pulse": one card per room with a large percentage + state, and a line chart (Chart.js) of your next room's occupancy over 30 min (GET /pulse/history), dotted line at 90%. Keddy in this panel.
   - Text: "Simulated data via OpenTelemetry · also in Dash0".
   - Polling every 5 s to GET /pulse. If it is slow or fails, show the last data with "X s ago" without breaking the UI.
   - "Chaos button" visible only with ?demo=1 → POST /chaos; the bar rises live and the Obee banner appears.

## Shared header
- Background in the theme's accent color, Obee on the left + "KubePulse" in Space Grotesk.
- Right: "Theme: {name} ▾" button (menu) and an ES | EN group (buttons with aria-pressed).
- On /live also: the profile's tags as chips + an "Edit profile" link.

## Occupancy states (never color alone)
< 50% "● Room available" · 50–89% "▲ Filling up" · ≥ 90% "■ Full". Always symbol + text + percentage.

## Themes (CSS variables in `:root[data-theme="..."]`, localStorage `kubepulse.theme`)
Variables: --bg, --surface, --border, --text, --muted, --header-bg, --header-text, --accent, --btn-bg, --btn-text, --low-bg, --low-text, --mid-bg, --mid-text, --high-bg, --high-text, --font-body, --font-size-base, --line-height, --letter-spacing, --radius.
- **kube** (default): bg #F6F7FB, header #326CE5, text #1F2933, button #1F2933. Occupancy: low #E4F4EC/#1E6B43, mid #FDF0DC/#8A5300, high #FBE3E1/#A42A24.
- **dark**: bg #0E1420, surface #151D2C, border #2A3650, text #E6EAF2, muted #A3AEC2, accent #5B8DEF, button #5B8DEF with text #0E1420. Occupancy: #12372A/#86E5B5, #3A2A10/#F2C27A, #3A1513/#FFB4AE. Respect prefers-color-scheme: dark when there is no saved preference.
- **mujeres** (Women in Cloud Native): gradient #FFF0F5 → #FBEFFF, header #C2255C, strip under the header #F783AC/#E599F7/#FCC2D7, text #3D1A2B, muted #7A4A5E, button #A61E4D, pill-shaped radii, logo "♡ KubePulse".
- **daltonismo** (color-blind friendly, Okabe-Ito): header #0072B2, text #1A1A1A. Occupancy: low #DCEEF8/#00507D, mid #FCEFD2/#7A5200, high with diagonal stripes #F9DFD0/#F2C9B2 and text #8F3A00. Never green against red.
- **lectura** (easy reading): Atkinson Hyperlegible, base 17-18px, line-height 1.7, letter-spacing .02em, background #FFFDF5, header #111111, 2px #111111 borders, underlined links, button #1F4FB8, no italics.
- **pride**: header with rainbow stripes (#E40303, #FF8C00, #FFED00, #008026, #004DFF, #750787) and the logo in a white pill; below it a Progress Pride strip (#FFFFFF, #F5A9B8, #5BCEFA, #784F17, #000000); button #750787; card border #004DFF.
Switching themes only changes data-theme on `<html>`; no component has hardcoded colors.

## Language (i18n)
`/static/i18n.json` with ES and EN keys; the JS replaces texts that have `data-i18n="key"`. Language in localStorage `kubepulse.lang` and in `<html lang>`. Talk titles are NOT translated.

## Phippy & Friends mascots (CC-BY)
- Official SVGs from github.com/cncf/artwork, folder other/phippy-and-friends: obee_full.svg, phippy_full.svg, keddy_full.svg → `app/public/mascots/`.
- The mascots are the app's voice and NEVER label talks. Obee: header and assistant messages. Phippy: profile welcome. Keddy: alerts and pulse panel.
- Talks use neutral per-topic icons (inline SVG with stroke): Agentes/MCP = processor chip (blue), Seguridad = shield (red), Platform Engineering = layers (green).
- Footer on every page: `Phippy & Friends characters · <a href="https://phippy.io">phippy.io</a> (CC-BY)`.

## Accessibility (Merge Forward prize)
- Real elements: `<button>`, `<a href>`, `<input>` with `<label>`, `<fieldset>`/`<legend>`. No onClick on divs.
- Touch targets ≥ 44px. Text contrast ≥ 4.5:1 in every theme.
- aria-label on icon-only buttons; mascots with alt; charts with role="img" and an aria-label that summarizes the data.
- < 768px: stacked columns and a wrapping header.
- Obee banner in an aria-live="polite" region.

## Frontend observability (Dash0 track)
- Dash0 web SDK (RUM) in base.html with DASH0_RUM_TOKEN and DASH0_RUM_ENDPOINT; with no token, it isn't loaded.
- Events: profile_saved, agenda_confirmed, theme_changed, lang_changed, recommendation_switched, chaos_triggered.

## Work order (one commit/PR per item)
1. base.html + theme CSS + theme picker + i18n.
2. /profile with localStorage.
3. /schedule with POST /recommend (fallback to /static/mock/agenda.json).
4. /live with polling, chart and Obee banner (fallback to /static/mock/pulse.json).
5. Chaos button + Dash0 RUM.
6. Accessibility and responsive pass.
