# KubePulse · Contracts between modules

This file is the source of truth. Only the coordinator (the main session) changes it.
If an agent needs a change, it proposes it in its PR and does not apply it on its own.

## Stack
- Node 22 + Express 4 + Nunjucks (templates with Jinja2 syntax). No frontend build.
- Port `$PORT` (8080). Keep `/healthz` and `/readyz`.
- Everything lives in `app/` (the Dockerfile copies `app/`).

## Folders and owners
| Path | Owner |
|---|---|
| `app/server.js`, `app/telemetry.js`, `app/package.json`, `Dockerfile`, `deploy/` | A · Infra |
| `app/src/search/`, `app/data/`, `app/scripts/ingest.js` | B · Data |
| `app/src/pulse/` | C · Pulse |
| `app/views/`, `app/public/`, `app/src/pages/` | D · Frontend |
| `app/src/ask/`, `README.md` | E · Extras |
| `docs/`, `.gitar/` | Coordinator |

Each module's `app/src/<x>/index.js` exports an `express.Router()`. `server.js` already mounts them.
npm dependencies are added only in `app/package.json` and the coordinator approves them (avoids conflicts).

## Times and time zones
Every time is ISO 8601 with Salt Lake City's explicit offset: `2026-11-09T09:20:00-07:00`.
Never a time without a zone.

## Rooms (`app/data/rooms.json`)
```json
[{ "id": "ace", "name": "Grand Ballroom ACE", "capacity": 1200, "wheelchair_accessible": true }]
```
Rooms: `ace` Grand Ballroom ACE, `gi` Grand Ballroom GI, `r254` Room 254, `r255ef` Room 255 EF.

## API

### Errors (all routes)
Body `{ "error": "<readable message>" }`, with optional extra fields.
`400` invalid input (body or query) · `404` unknown route, or `/chaos` without `DEMO_MODE` ·
`409` conflict (e.g. `/chaos` while a chaos run is active: adds `room` and `until`) ·
`502/503` external dependency down, only when there is no fallback (normally the response uses the fallback).

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
    "parallel_matches": [{ "id": "t-0920-gi", "title": "...", "speakers": ["..."],
      "start": "2026-11-09T09:20:00-07:00", "end": "2026-11-09T09:45:00-07:00",
      "room": { "id": "gi", "name": "Grand Ballroom GI" },
      "topics": ["Agentes"], "match_reason": ["Agentes"], "forecast": "low|mid|high" }],
    "forecast": "low|mid|high" }],
  "breaks": [{ "start": "2026-11-09T10:25:00-07:00", "label": "coffee|lunch" }] }
```
`parallel_alternative` can be `null` (kept for compatibility: it is the first element of `parallel_matches`, or the best
parallel talk even without a match when there is none).
`parallel_matches`: **all** the other talks that overlap in time with the recommended one and match at least one interest
(non-empty `match_reason`), sorted by descending score, at most 4. Always present (`[]` when there are none). Same profile filter as the
recommended talk (level, language, accessibility). Each room's live occupancy is not included here: the frontend joins it by `room.id` with `GET /pulse`.

### GET /search?q=text
Response: `{ "talks": [ ...same talk format... ] }`

### GET /pulse
```json
{ "rooms": [{ "id": "ace", "name": "Grand Ballroom ACE", "occupancy": 0.96, "capacity": 1200, "trend": "up|down|flat" }],
  "updated_at": "2026-11-09T15:55:03-07:00" }
```
`occupancy` ranges from 0 to 1.

### GET /pulse/history?room=ace
`{ "room": "ace", "points": [{ "t": "2026-11-09T15:25:00-07:00", "occupancy": 0.71 }] }` · last 30 min.

### POST /chaos
Only when `DEMO_MODE=true`; otherwise 404.
Request `{ "room": "ace" }` (optional). Response `{ "room": "ace", "until": "<ISO>" }`.
Effect: that room rises to ≥96% for 3 minutes, and `/recommend` and `/search` get extra latency.

### POST /ask
Request `{ "question": "...", "profile": { ... } }`.
Response `{ "answer": "...", "citations": ["t-0920-ace"], "provider": "openai|elastic|none", "degraded": false }`.

## Occupancy states
`< 0.50` → low "Room available" · `0.50–0.89` → mid "Filling up" · `>= 0.90` → high "Full".

## Elasticsearch
Index `talks`. Fields: `id` keyword, `title` text, `abstract` text, `semantic` semantic_text
(title + abstract + topics), `speakers` keyword, `room_id` keyword, `start`/`end` date,
`topics` keyword, `level` keyword, `language` keyword, `captions` boolean.

## OpenTelemetry
- Service: `service.name=kubepulse`.
- Metric: gauge `room.occupancy` (ratio 0-1) with attributes `room.id`, `room.name`, `room.capacity`.
- Frontend RUM events: `profile_saved`, `agenda_confirmed`, `theme_changed`, `lang_changed`,
  `recommendation_switched`, `chaos_triggered`.

## Environment variables (K8s Secret `kubepulse-secrets`, never in the repo)
`ELASTIC_ENDPOINT`, `ELASTIC_API_KEY`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`,
`OTEL_EXPORTER_OTLP_PROTOCOL`, `DASH0_RUM_TOKEN` (ingest only), `DASH0_RUM_ENDPOINT`,
`LLM_PROVIDER` (openai|elastic|none), `OPENAI_API_KEY`, `DEMO_MODE`.

## If the backend is missing
The frontend uses `app/public/mock/agenda.json` and `app/public/mock/pulse.json` with this same format.
