# KubePulse en Dash0: dashboard, SLO y alerta

Esto lo crea una persona en la UI de Dash0. Ningún agente tiene acceso a Dash0.
Todas las consultas son PromQL y usan los nombres reales que exporta la app (ver "Qué exporta la app").

## Qué exporta la app

Revisado en `app/telemetry.js`, `app/src/pulse/otel.js` y las versiones instaladas en `app/package-lock.json`.
Todo sale por OTLP con `service.name=kubepulse` (y `service.version=<sha>` si existe `APP_VERSION`).

| Señal | Nombre OTel | Tipo | Atributos útiles | Origen |
|---|---|---|---|---|
| Ocupación de sala | `room.occupancy` | gauge, unidad `1` (0-1) | `room.id`, `room.name`, `room.capacity` | `app/src/pulse/otel.js` |
| Latencia y volumen HTTP | `http.server.request.duration` | histograma, segundos | `http.request.method`, `http.route`, `http.response.status_code` | `@opentelemetry/instrumentation-http` 0.301 (semconv estable; ya no emite `http.server.duration`) |
| Heap de V8 | `v8js.memory.heap.used` | gauge, bytes | `v8js.heap.space.name` | `instrumentation-runtime-node` |
| Event loop | `nodejs.eventloop.delay.p99`, `nodejs.eventloop.utilization` | gauge | | `instrumentation-runtime-node` |
| Trazas | spans `POST /recommend`, `GET /search`, `POST /ask`, ... | | mismos atributos HTTP | instrumentación HTTP + Express |

Notas que cambian los paneles:

- **Las sondas no aparecen.** `telemetry.js` ignora `/healthz` y `/readyz` (`ignoreIncomingRequestHook`), así que no hay span ni
  medición para ellas. Todo `http.server.request.duration` ya es tráfico "no-probe".
- **`X-KubePulse-Degraded` no existe hoy.** Ni el encabezado ni un atributo de span lo emite ningún archivo de `app/`. `/ask`
  devuelve `degraded` en el cuerpo JSON (contrato), que no llega a la telemetría. El panel de "% degradado" queda pendiente: hace
  falta que E · Extras (o B · Datos) ponga en el span activo un atributo, p. ej. `kubepulse.degraded=true`, o que A · Infra
  capture el encabezado de respuesta con `headersToSpanAttributes.server.responseHeaders` en `telemetry.js`. Abajo va la
  consulta lista para cuando exista.
- **No hay RSS del proceso.** `process.memory.usage` viene de `instrumentation-host-metrics`, que
  `auto-instrumentations-node` deja apagada por defecto. Para tener RSS, A · Infra debe activarla en `telemetry.js`
  (`'@opentelemetry/instrumentation-host-metrics': { enabled: true }`). Mientras tanto, el panel usa el heap de V8.
- **Hoy `/recommend`, `/search` y `/ask` responden 501** (stubs en `main`). Cuentan como 5xx: el SLO de disponibilidad saldrá
  rojo hasta que B y E unan sus rutas. Es esperado.

### Cómo escribir los nombres en Dash0

Dash0 recomienda el selector `otel_metric_name` y, en etiquetas, cambia puntos por guiones bajos
(`room.name` → `room_name`, `service.name` → `service_name`, `http.route` → `http_route`).
Para histogramas también expone el nombre traducido a Prometheus (`http_server_request_duration_seconds_bucket`, `_count`,
`_sum`). Confirma el nombre exacto con el autocompletado del Query Builder antes de guardar; si `_bucket` no aparece, usa la
variante de histograma nativo indicada en cada panel.

Abreviaturas usadas abajo:

```promql
# Peticiones HTTP de KubePulse (ya sin sondas)
{otel_metric_name="http.server.request.duration", service_name="kubepulse"}
```

## Dashboard "KubePulse"

Crear en **Dashboards > New dashboard**, nombre `KubePulse`. Variables: ninguna. Usa `$__rate_interval` en todo `rate()`.

### 1. Ocupación por sala (línea, umbral 0.9)

```promql
max by (room_name) ({otel_metric_name="room.occupancy", service_name="kubepulse"})
```

Tipo: línea. Eje Y de 0 a 1, unidad porcentaje (0-1). Umbral fijo en `0.9` (rojo) = estado "Llena" del contrato.
Leyenda: `{{room_name}}`. Se usa `max` porque con varias réplicas cada pod reporta la misma sala.

### 2. Tasa de peticiones por ruta

```promql
sum by (http_route, http_request_method) (
  rate(http_server_request_duration_seconds_count{service_name="kubepulse",
       http_route=~"^/(recommend|search|ask)$"}[$__rate_interval])
)
```

Tipo: línea, unidad req/s. Leyenda: `{{http_request_method}} {{http_route}}`.

### 3. Latencia p95 por ruta

```promql
histogram_quantile(0.95,
  sum by (le, http_route) (
    rate(http_server_request_duration_seconds_bucket{service_name="kubepulse",
         http_route=~"^/(recommend|search|ask)$"}[$__rate_interval])
  )
)
```

Variante si Dash0 lo expone como histograma nativo:

```promql
histogram_quantile(0.95,
  sum by (http_route) (
    rate({otel_metric_name="http.server.request.duration", service_name="kubepulse",
          http_route=~"^/(recommend|search|ask)$"}[$__rate_interval])
  )
)
```

Tipo: línea, unidad segundos. Umbral en `1.5` para alinear con el SLO de latencia. Con `POST /chaos` activo la latencia de
`/recommend` y `/search` sube entre 0.4 y 1.5 s (`chaosLatency`), y se ve aquí.

Alternativa sin métricas: pestaña **Tracing** del Query Builder, filtro `service.name = kubepulse` y
`http.route in (/recommend, /search, /ask)`, agrupar por `http.route`, mostrar tasa y p95. Usa los mismos spans.

### 4. Errores 5xx

```promql
sum by (http_route) (
  rate(http_server_request_duration_seconds_count{service_name="kubepulse",
       http_response_status_code=~"^5"}[$__rate_interval])
)
```

Tipo: barras apiladas, unidad req/s. Recordatorio: hoy los stubs devuelven 501.

### 5. % de respuestas degradadas (pendiente)

No hay datos hasta que exista el atributo (ver notas). Cuando `kubepulse.degraded` esté en los spans, crear el panel desde la
pestaña **Tracing**: spans de `service.name = kubepulse` y `http.route = /ask`, fórmula
`count(kubepulse.degraded = true) / count(*)`, en %. Si en su lugar se captura el encabezado, el atributo será
`http.response.header.x-kubepulse-degraded`.

### 6. Memoria del proceso

Hoy (heap de V8, suma de todos los espacios, por pod):

```promql
sum by (k8s_pod_name) ({otel_metric_name="v8js.memory.heap.used", service_name="kubepulse"})
```

Cuando se active `instrumentation-host-metrics` (RSS real):

```promql
max by (k8s_pod_name) ({otel_metric_name="process.memory.usage", service_name="kubepulse"})
```

Tipo: línea, unidad bytes. Umbral en 512 MiB (límite por defecto del contenedor en el cluster). Si `k8s_pod_name` no aparece
(la app no añade atributos de Kubernetes al recurso), agrupar por `service_instance_id`.

## SLOs

Crear en **SLOs > New SLO**, servicio `kubepulse`. Ventana: 1 hora (es una demo de un día; en producción serían 28 días).

### Disponibilidad 99 % (peticiones HTTP no-probe)

- Objetivo: 99 %. Ventana: 1 h.
- Eventos buenos / totales:

```promql
# buenos: todo lo que no es 5xx
sum(rate(http_server_request_duration_seconds_count{service_name="kubepulse",
    http_response_status_code!~"^5"}[$__rate_interval]))
# totales
sum(rate(http_server_request_duration_seconds_count{service_name="kubepulse"}[$__rate_interval]))
```

No hace falta excluir `/healthz` ni `/readyz`: la app no las mide.

### Latencia p95 < 1.5 s en `/recommend`

- Objetivo: 95 % de las peticiones a `POST /recommend` en menos de 1.5 s, ventana 1 h (equivale a p95 < 1.5 s).
- Eventos buenos / totales. La instrumentación usa los buckets que recomienda la semconv
  (`… 0.5, 0.75, 1, 2.5, 5 …` s), así que no hay bucket de 1.5 s. Primero intenta el histograma nativo (umbral exacto); si no está, usa `le="2.5"` como aproximación
  conservadora y anótalo en la demo:

```promql
# buenos (histograma clásico)
sum(rate(http_server_request_duration_seconds_bucket{service_name="kubepulse",
    http_route="/recommend", http_request_method="POST", le="2.5"}[$__rate_interval]))
# totales
sum(rate(http_server_request_duration_seconds_count{service_name="kubepulse",
    http_route="/recommend", http_request_method="POST"}[$__rate_interval]))
```

```promql
# buenos (histograma nativo, umbral exacto 1.5 s)
histogram_fraction(0, 1.5,
  sum(rate({otel_metric_name="http.server.request.duration", service_name="kubepulse",
            http_route="/recommend", http_request_method="POST"}[$__rate_interval])))
```

Para un umbral exacto con histograma clásico, A · Infra puede añadir una `View` con buckets que incluyan `1.5` en
`telemetry.js`.

## Alerta: sala por encima de 95 %

Crear en **Alerting > Check rules > New** (o **Create check rule** desde el Query Builder).

- Nombre: `KubePulse · sala llena (>95 %)`.
- Consulta:

```promql
max by (room_name) ({otel_metric_name="room.occupancy", service_name="kubepulse"}) > 0.95
```

- Para: `1m`. Evaluar cada `30s`.
- Severidad: warning. Resumen: `{{ $labels.room_name }} al {{ $value | humanizePercentage }}`.
- Descripción: "La ocupación supera el 95 % desde hace 1 minuto. Sugerir a los asistentes la charla paralela."

Cómo dispararla en la demo: con `DEMO_MODE=true`, `POST /chaos` con `{ "room": "ace" }` pone esa sala al ≥96 % durante
3 minutos (contrato). La alerta pasa a pending enseguida y dispara al minuto. Abre la alerta y pide a **Agent0** que la
investigue: debería correlacionar la subida de `room.occupancy` con la latencia extra de `/recommend` en las trazas.
Un segundo `POST /chaos` mientras dura devuelve 409, no la alarga.
