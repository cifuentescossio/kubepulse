# KubePulse in Dash0: dashboard, SLO and alert

A person creates all of this in the Dash0 UI. No agent has access to Dash0.
Every query is PromQL and uses the real names the app exports (see "What the app exports").

## What the app exports

Checked in `app/telemetry.js`, `app/src/pulse/otel.js` and the versions installed in `app/package-lock.json`.
Everything goes out over OTLP with `service.name=kubepulse` (and `service.version=<sha>` when `APP_VERSION` is set).

| Signal | OTel name | Type | Useful attributes | Source |
|---|---|---|---|---|
| Room occupancy | `room.occupancy` | gauge, unit `1` (0-1) | `room.id`, `room.name`, `room.capacity` | `app/src/pulse/otel.js` |
| HTTP latency and volume | `http.server.request.duration` | histogram, seconds | `http.request.method`, `http.route`, `http.response.status_code` | `@opentelemetry/instrumentation-http` 0.301 (stable semconv; no longer emits `http.server.duration`) |
| V8 heap | `v8js.memory.heap.used` | gauge, bytes | `v8js.heap.space.name` | `instrumentation-runtime-node` |
| Event loop | `nodejs.eventloop.delay.p99`, `nodejs.eventloop.utilization` | gauge | | `instrumentation-runtime-node` |
| Traces | spans `POST /recommend`, `GET /search`, `POST /ask`, ... | | same HTTP attributes | HTTP + Express instrumentation |

Notes that change the panels:

- **Probes don't show up.** `telemetry.js` ignores `/healthz` and `/readyz` (`ignoreIncomingRequestHook`), so there is no span or
  measurement for them. All of `http.server.request.duration` is already "no-probe" traffic.
- **`X-KubePulse-Degraded` doesn't exist today.** No file in `app/` emits it, neither as the header nor as a span attribute. `/ask`
  returns `degraded` in the JSON body (contract), which doesn't reach telemetry. The "% degraded" panel is pending: E · Extras
  (or B · Data) needs to set an attribute on the active span, e.g. `kubepulse.degraded=true`, or A · Infra needs to
  capture the response header with `headersToSpanAttributes.server.responseHeaders` in `telemetry.js`. The query below is
  ready for when it exists.
- **There is no process RSS.** `process.memory.usage` comes from `instrumentation-host-metrics`, which
  `auto-instrumentations-node` leaves off by default. To get RSS, A · Infra must enable it in `telemetry.js`
  (`'@opentelemetry/instrumentation-host-metrics': { enabled: true }`). Until then, the panel uses the V8 heap.
- **Today `/recommend`, `/search` and `/ask` answer 501** (stubs on `main`). They count as 5xx: the availability SLO will be
  red until B and E merge their routes. This is expected.

### How to write the names in Dash0

Dash0 recommends the `otel_metric_name` selector and, in labels, replaces dots with underscores
(`room.name` → `room_name`, `service.name` → `service_name`, `http.route` → `http_route`).
For histograms it also exposes the name translated to Prometheus (`http_server_request_duration_seconds_bucket`, `_count`,
`_sum`). Confirm the exact name with the Query Builder's autocomplete before saving; if `_bucket` doesn't show up, use the
native histogram variant given for each panel.

Shorthand used below:

```promql
# KubePulse HTTP requests (already without probes)
{otel_metric_name="http.server.request.duration", service_name="kubepulse"}
```

## Dashboard "KubePulse"

Create it in **Dashboards > New dashboard**, name `KubePulse`. Variables: none. Use `$__rate_interval` in every `rate()`.

### 1. Occupancy per room (line, threshold 0.9)

```promql
max by (room_name) ({otel_metric_name="room.occupancy", service_name="kubepulse"})
```

Type: line. Y axis from 0 to 1, unit percent (0-1). Fixed threshold at `0.9` (red) = the contract's "Full" state.
Legend: `{{room_name}}`. `max` is used because with several replicas each pod reports the same room.

### 2. Request rate per route

```promql
sum by (http_route, http_request_method) (
  rate(http_server_request_duration_seconds_count{service_name="kubepulse",
       http_route=~"^/(recommend|search|ask)$"}[$__rate_interval])
)
```

Type: line, unit req/s. Legend: `{{http_request_method}} {{http_route}}`.

### 3. p95 latency per route

```promql
histogram_quantile(0.95,
  sum by (le, http_route) (
    rate(http_server_request_duration_seconds_bucket{service_name="kubepulse",
         http_route=~"^/(recommend|search|ask)$"}[$__rate_interval])
  )
)
```

Variant if Dash0 exposes it as a native histogram:

```promql
histogram_quantile(0.95,
  sum by (http_route) (
    rate({otel_metric_name="http.server.request.duration", service_name="kubepulse",
          http_route=~"^/(recommend|search|ask)$"}[$__rate_interval])
  )
)
```

Type: line, unit seconds. Threshold at `1.5` to line up with the latency SLO. With `POST /chaos` active, the latency of
`/recommend` and `/search` rises by 0.4 to 1.5 s (`chaosLatency`), and it shows up here.

Alternative without metrics: the Query Builder's **Tracing** tab, filter `service.name = kubepulse` and
`http.route in (/recommend, /search, /ask)`, group by `http.route`, show rate and p95. It uses the same spans.

### 4. 5xx errors

```promql
sum by (http_route) (
  rate(http_server_request_duration_seconds_count{service_name="kubepulse",
       http_response_status_code=~"^5"}[$__rate_interval])
)
```

Type: stacked bars, unit req/s. Reminder: today the stubs return 501.

### 5. % of degraded responses (pending)

No data until the attribute exists (see notes). Once `kubepulse.degraded` is on the spans, create the panel from the
**Tracing** tab: spans with `service.name = kubepulse` and `http.route = /ask`, formula
`count(kubepulse.degraded = true) / count(*)`, in %. If the header is captured instead, the attribute will be
`http.response.header.x-kubepulse-degraded`.

### 6. Process memory

Today (V8 heap, sum of all spaces, per pod):

```promql
sum by (k8s_pod_name) ({otel_metric_name="v8js.memory.heap.used", service_name="kubepulse"})
```

Once `instrumentation-host-metrics` is enabled (real RSS):

```promql
max by (k8s_pod_name) ({otel_metric_name="process.memory.usage", service_name="kubepulse"})
```

Type: line, unit bytes. Threshold at 512 MiB (the cluster's default container limit). If `k8s_pod_name` doesn't show up
(the app doesn't add Kubernetes attributes to the resource), group by `service_instance_id`.

## SLOs

Create them in **SLOs > New SLO**, service `kubepulse`. Window: 1 hour (this is a one-day demo; in production it would be 28 days).

### Availability 99 % (no-probe HTTP requests)

- Target: 99 %. Window: 1 h.
- Good / total events:

```promql
# good: everything that is not 5xx
sum(rate(http_server_request_duration_seconds_count{service_name="kubepulse",
    http_response_status_code!~"^5"}[$__rate_interval]))
# total
sum(rate(http_server_request_duration_seconds_count{service_name="kubepulse"}[$__rate_interval]))
```

There's no need to exclude `/healthz` or `/readyz`: the app doesn't measure them.

### p95 latency < 1.5 s on `/recommend`

- Target: 95 % of `POST /recommend` requests in under 1.5 s, window 1 h (equivalent to p95 < 1.5 s).
- Good / total events. The instrumentation uses the buckets the semconv recommends
  (`… 0.5, 0.75, 1, 2.5, 5 …` s), so there is no 1.5 s bucket. Try the native histogram first (exact threshold); if it isn't there, use `le="2.5"` as a conservative
  approximation and note it in the demo:

```promql
# good (classic histogram)
sum(rate(http_server_request_duration_seconds_bucket{service_name="kubepulse",
    http_route="/recommend", http_request_method="POST", le="2.5"}[$__rate_interval]))
# total
sum(rate(http_server_request_duration_seconds_count{service_name="kubepulse",
    http_route="/recommend", http_request_method="POST"}[$__rate_interval]))
```

```promql
# good (native histogram, exact 1.5 s threshold)
histogram_fraction(0, 1.5,
  sum(rate({otel_metric_name="http.server.request.duration", service_name="kubepulse",
            http_route="/recommend", http_request_method="POST"}[$__rate_interval])))
```

For an exact threshold with a classic histogram, A · Infra can add a `View` with buckets that include `1.5` in
`telemetry.js`.

## Alert: room above 95 %

Create it in **Alerting > Check rules > New** (or **Create check rule** from the Query Builder).

- Name: `KubePulse · room full (>95 %)`.
- Query:

```promql
max by (room_name) ({otel_metric_name="room.occupancy", service_name="kubepulse"}) > 0.95
```

- For: `1m`. Evaluate every `30s`.
- Severity: warning. Summary: `{{ $labels.room_name }} at {{ $value | humanizePercentage }}`.
- Description: "Occupancy has been above 95 % for 1 minute. Suggest the parallel talk to attendees."

How to fire it in the demo: with `DEMO_MODE=true`, `POST /chaos` with `{ "room": "ace" }` puts that room at ≥96 % for
3 minutes (contract). The alert goes to pending right away and fires after a minute. Open the alert and ask **Agent0** to
investigate it: it should correlate the rise in `room.occupancy` with the extra latency of `/recommend` in the traces.
A second `POST /chaos` while it lasts returns 409; it doesn't extend it.
