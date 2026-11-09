---
title: "Contrato y dueños de carpetas"
description: "Avisa cuando un PR cambia el contrato del API o toca carpetas de otro módulo"
when: "A pull request is opened or updated and changes docs/contracts.md, or changes files under more than one of these owner areas: app/src/search/ and app/data/ and app/scripts/ingest.js (Datos), app/src/pulse/ (Pulso), app/views/ and app/public/ and app/src/pages/ (Frontend), app/src/ask/ and README.md (Extras), app/server.js and app/telemetry.js and app/package.json and Dockerfile and deploy/ (Infra)"
actions: "Post a pull request comment that lists which owner areas the pull request touches, flags any response field that no longer matches docs/contracts.md, and reminds that only the coordinator changes docs/contracts.md and that changes to app/package.json must only add required dependencies"
---

## When it applies
When a PR changes `docs/contracts.md` or mixes folders from several modules.

## How it works
It compares the touched folders with the owners table in `docs/contracts.md` and checks that the
response formats follow the contract.

## Why it matters
Several agents work in parallel, each one in its own module. If one changes a format on its own,
the frontend breaks without anyone noticing until the demo.
