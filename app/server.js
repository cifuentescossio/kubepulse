// KubePulse server. Each module under src/ exports an express.Router(),
// so agents working in parallel only touch their own folder.
// Telemetry must load before anything else so auto-instrumentation can patch modules.
const telemetry = require('./telemetry');

const path = require('node:path');
const express = require('express');
const nunjucks = require('nunjucks');

const port = Number(process.env.PORT || 8080);
const version = process.env.APP_VERSION || 'dev';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

nunjucks.configure(path.join(__dirname, 'views'), { autoescape: true, express: app });
app.set('view engine', 'html');

app.get(['/healthz', '/readyz'], (_req, res) => res.type('text/plain').send('ok\n'));
const startedAt = telemetry.formatStartTime();
app.get('/version', (_req, res) => res.json({ version, started_at: startedAt }));

app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: '5m' }));

app.use(require('./src/pages'));   // D · Frontend: /, /profile, /schedule, /live (old /perfil, /agenda, /pulso redirect)
app.use(require('./src/search'));  // B · Data: /recommend, /search
app.use(require('./src/pulse'));   // C · Pulse: /pulse, /pulse/history, /chaos
app.use(require('./src/ask'));     // E · Extras: /ask

app.use((_req, res) => res.status(404).type('text/plain').send('not found\n'));

const server = app.listen(port, () => console.log(`kubepulse listening on :${port}, version ${version}, started ${startedAt}`));

// Exit cleanly when Kubernetes stops the pod, so rollouts don't drop requests.
// Flush telemetry (bounded wait) before exiting.
process.on('SIGTERM', () => server.close(() => telemetry.shutdown().finally(() => process.exit(0))));
