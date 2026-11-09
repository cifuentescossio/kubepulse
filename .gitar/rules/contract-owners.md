---
title: "Contrato y dueños de carpetas"
description: "Avisa cuando un PR cambia el contrato del API o toca carpetas de otro módulo"
when: "A pull request is opened or updated and changes docs/contracts.md, or changes files under more than one of these owner areas: app/src/search/ and app/data/ and app/scripts/ingest.js (Datos), app/src/pulse/ (Pulso), app/views/ and app/public/ and app/src/pages/ (Frontend), app/src/ask/ and README.md (Extras), app/server.js and app/telemetry.js and app/package.json and Dockerfile and deploy/ (Infra)"
actions: "Post a pull request comment that lists which owner areas the pull request touches, flags any response field that no longer matches docs/contracts.md, and reminds that only the coordinator changes docs/contracts.md and that changes to app/package.json must only add required dependencies"
---

## Cuándo aplica
Cuando un PR cambia `docs/contracts.md` o mezcla carpetas de varios módulos.

## Cómo funciona
Compara las carpetas tocadas con la tabla de dueños de `docs/contracts.md` y revisa que los
formatos de las respuestas sigan el contrato.

## Por qué importa
Varios agentes trabajan en paralelo, cada uno en su módulo. Si uno cambia un formato por su cuenta,
el frontend se rompe sin que nadie lo note hasta la demo.
