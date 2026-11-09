# KubePulse · Contratos entre piezas

Este archivo es la fuente de verdad. Solo lo cambia el "cerebro" (sesión principal).
Si un agente necesita un cambio, lo propone en su PR y no lo aplica por su cuenta.

## Stack
- Node 22 + Express 4 + Nunjucks (plantillas con sintaxis Jinja2). Sin build de frontend.
- Puerto `$PORT` (8080). Mantener `/healthz` y `/readyz`.
- Todo vive en `app/` (el Dockerfile copia `app/`).

## Carpetas y dueños
| Ruta | Dueño |
|---|---|
| `app/server.js`, `app/telemetry.js`, `app/package.json`, `Dockerfile`, `deploy/` | A · Infra |
| `app/src/search/`, `app/data/`, `app/scripts/ingest.js` | B · Datos |
| `app/src/pulse/` | C · Pulso |
| `app/views/`, `app/public/`, `app/src/pages/` | D · Frontend |
| `app/src/ask/`, `README.md` | E · Extras |
| `docs/`, `.gitar/` | Cerebro |

Cada módulo de `app/src/<x>/index.js` exporta un `express.Router()`. `server.js` ya los monta.
Las dependencias de npm se agregan solo en `app/package.json` y las aprueba el cerebro (evita conflictos).

## Horas y zonas horarias
Todas las horas van en ISO 8601 con offset explícito de Salt Lake City: `2026-11-09T09:20:00-07:00`.
Nunca horas sin zona.

## Salas (`app/data/rooms.json`)
```json
[{ "id": "ace", "name": "Grand Ballroom ACE", "capacity": 1200, "wheelchair_accessible": true }]
```
Salas: `ace` Grand Ballroom ACE, `gi` Grand Ballroom GI, `r254` Room 254, `r255ef` Room 255 EF.

## API

### POST /recommend
Request:
```json
{ "name": "Daniel", "role": "Platform Engineer",
  "interests": ["Agentes", "Platform Engineering", "MCP"],
  "level": "any|beginner|advanced", "lang": "es|en",
  "a11y": { "captions": true, "wheelchair": false, "avoid_crowded": false } }
```
Response:
```json
{ "talks": [{
    "id": "t-0920-ace", "title": "MCP Without Polling: ...", "speakers": ["Aman Singh"],
    "start": "2026-11-09T09:20:00-07:00", "end": "2026-11-09T09:50:00-07:00",
    "room": { "id": "ace", "name": "Grand Ballroom ACE" },
    "topics": ["MCP", "Agentes"], "match_reason": ["MCP", "Agentes"],
    "parallel_alternative": { "id": "t-0920-gi", "title": "...", "room": { "id": "gi", "name": "Grand Ballroom GI" } },
    "forecast": "low|mid|high" }],
  "breaks": [{ "start": "2026-11-09T10:25:00-07:00", "label": "coffee|lunch" }] }
```
`parallel_alternative` puede ser `null`.

### GET /search?q=texto
Response: `{ "talks": [ ...mismo formato de charla... ] }`

### GET /pulse
```json
{ "rooms": [{ "id": "ace", "name": "Grand Ballroom ACE", "occupancy": 0.96, "capacity": 1200, "trend": "up|down|flat" }],
  "updated_at": "2026-11-09T15:55:03-07:00" }
```
`occupancy` va de 0 a 1.

### GET /pulse/history?room=ace
`{ "room": "ace", "points": [{ "t": "2026-11-09T15:25:00-07:00", "occupancy": 0.71 }] }` · últimos 30 min.

### POST /chaos
Solo si `DEMO_MODE=true`; si no, 404.
Request `{ "room": "ace" }` (opcional). Response `{ "room": "ace", "until": "<ISO>" }`.
Efecto: esa sala sube al ≥96% durante 3 minutos y `/recommend` y `/search` reciben latencia extra.

### POST /ask
Request `{ "question": "...", "profile": { ... } }`.
Response `{ "answer": "...", "citations": ["t-0920-ace"], "provider": "openai|elastic|none", "degraded": false }`.

## Estados de ocupación
`< 0.50` → low "Hay espacio" · `0.50–0.89` → mid "Llenándose" · `>= 0.90` → high "Llena".

## Elasticsearch
Índice `talks`. Campos: `id` keyword, `title` text, `abstract` text, `semantic` semantic_text
(título + abstract + topics), `speakers` keyword, `room_id` keyword, `start`/`end` date,
`topics` keyword, `level` keyword, `language` keyword, `captions` boolean.

## OpenTelemetry
- Servicio: `service.name=kubepulse`.
- Métrica: gauge `room.occupancy` (ratio 0-1) con atributos `room.id`, `room.name`, `room.capacity`.
- Eventos RUM del frontend: `profile_saved`, `agenda_confirmed`, `theme_changed`, `lang_changed`,
  `recommendation_switched`, `chaos_triggered`.

## Variables de entorno (Secret de K8s `kubepulse-secrets`, nunca en el repo)
`ELASTIC_ENDPOINT`, `ELASTIC_API_KEY`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`,
`OTEL_EXPORTER_OTLP_PROTOCOL`, `DASH0_RUM_TOKEN` (solo ingesta), `DASH0_RUM_ENDPOINT`,
`LLM_PROVIDER` (openai|elastic|none), `OPENAI_API_KEY`, `DEMO_MODE`.

## Si falta el backend
El frontend usa `app/public/mock/agenda.json` y `app/public/mock/pulse.json` con este mismo formato.
