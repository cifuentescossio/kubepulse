// Owner: A · Infra. OpenTelemetry for KubePulse: traces, metrics and logs over OTLP.
//
// Configured only through the standard OTEL_* environment variables
// (OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_EXPORTER_OTLP_HEADERS, OTEL_EXPORTER_OTLP_PROTOCOL,
// OTEL_METRIC_EXPORT_INTERVAL, OTEL_LOG_LEVEL, ...). In the cluster they come from the
// Secret kubepulse-secrets; locally from `node --env-file=<file>`.
//
// If OTEL_EXPORTER_OTLP_ENDPOINT is unset this module does nothing: no SDK, no patching,
// and the @opentelemetry/api calls elsewhere in the app (e.g. the room.occupancy gauge)
// fall back to the API's built-in no-ops.
//
// server.js requires this first, before express, so auto-instrumentation can patch modules.
// Other modules don't need to require it: use `require('@opentelemetry/api')` directly.

const util = require('node:util');

const enabled = Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT) && process.env.OTEL_SDK_DISABLED !== 'true';

let sdk = null;

if (enabled) {
  const { diag, DiagLogLevel, logs, SeverityNumber } = require('@opentelemetry/api');
  const { NodeSDK } = require('@opentelemetry/sdk-node');
  const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
  const { defaultResource, resourceFromAttributes } = require('@opentelemetry/resources');

  const attributes = { 'service.name': 'kubepulse' };
  if (process.env.APP_VERSION) attributes['service.version'] = process.env.APP_VERSION;

  // Kubernetes probes hit these every few seconds on every pod; keep them out of traces.
  const quietPaths = new Set(['/healthz', '/readyz']);

  sdk = new NodeSDK({
    resource: defaultResource().merge(resourceFromAttributes(attributes)),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
        '@opentelemetry/instrumentation-net': { enabled: false },
        '@opentelemetry/instrumentation-http': {
          ignoreIncomingRequestHook: (req) => quietPaths.has((req.url || '').split('?')[0]),
        },
      }),
    ],
    // Exporters (traces, metrics, logs) default to OTLP and read OTEL_EXPORTER_OTLP_*.
  });

  try {
    sdk.start();
  } catch (err) {
    console.error('[otel] could not start the SDK, continuing without telemetry:', err.message);
    sdk = null;
  }

  if (sdk) {
    // Keep the real console methods: the SDK's own diagnostics write through them,
    // so an exporter error never turns into a log record that is exported again.
    const original = {
      debug: console.debug.bind(console),
      info: console.info.bind(console),
      log: console.log.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
    };

    const levels = { NONE: DiagLogLevel.NONE, ERROR: DiagLogLevel.ERROR, WARN: DiagLogLevel.WARN, INFO: DiagLogLevel.INFO, DEBUG: DiagLogLevel.DEBUG, VERBOSE: DiagLogLevel.VERBOSE, ALL: DiagLogLevel.ALL };
    const level = levels[(process.env.OTEL_LOG_LEVEL || 'WARN').toUpperCase()] ?? DiagLogLevel.WARN;
    const diagOut = (fn) => (...args) => fn('[otel]', ...args);
    diag.setLogger(
      { error: diagOut(original.error), warn: diagOut(original.warn), info: diagOut(original.info), debug: diagOut(original.debug), verbose: diagOut(original.debug) },
      { logLevel: level, suppressOverrideMessage: true },
    );

    // Bridge console.* to OTel logs, so the app's plain console output reaches the backend
    // (correlated with the active trace). It still prints to stdout as before.
    const logger = logs.getLogger('kubepulse');
    const severity = {
      debug: [SeverityNumber.DEBUG, 'DEBUG'],
      info: [SeverityNumber.INFO, 'INFO'],
      log: [SeverityNumber.INFO, 'INFO'],
      warn: [SeverityNumber.WARN, 'WARN'],
      error: [SeverityNumber.ERROR, 'ERROR'],
    };
    let inBridge = false;
    for (const method of Object.keys(original)) {
      console[method] = (...args) => {
        original[method](...args);
        if (inBridge) return;
        inBridge = true;
        try {
          const [severityNumber, severityText] = severity[method];
          logger.emit({ severityNumber, severityText, body: util.format(...args), attributes: { 'log.source': 'console' } });
        } catch {
          // Telemetry must never break logging.
        } finally {
          inBridge = false;
        }
      };
    }

    original.log('[otel] telemetry on: traces, metrics and logs over OTLP');
  }
}

// Flush and stop exporters. Safe to call when telemetry is off, and never waits forever.
function shutdown(timeoutMs = 5000) {
  if (!sdk) return Promise.resolve();
  const current = sdk;
  sdk = null;
  return Promise.race([
    current.shutdown().catch((err) => console.error('[otel] shutdown error:', err.message)),
    new Promise((resolve) => setTimeout(resolve, timeoutMs).unref()),
  ]);
}

// When this process started. Reported by /version and the startup log line.
const startedAt = new Date();

// Format a start time for /version and logs (docs/contracts.md: ISO 8601 with offset).
function formatStartTime(date = startedAt) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'longOffset',
  }).formatToParts(date).map(({ type, value }) => [type, value]));
  const offset = parts.timeZoneName === 'GMT' ? '+00:00' : parts.timeZoneName.replace(/^GMT/, '');
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
}

module.exports = { enabled: Boolean(sdk), shutdown, startedAt, formatStartTime };
