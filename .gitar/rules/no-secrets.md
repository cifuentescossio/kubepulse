---
title: "Sin secretos en un repo público"
description: "Bloquea cualquier credencial escrita en el código, los manifiestos o el frontend"
when: "A pull request is opened or updated and adds or changes any file"
actions: "If the diff adds anything that looks like a real credential (API key, bearer token, password, kubeconfig, Authorization header value, Elastic or Dash0 or OpenAI key), post a pull request comment that names the file and line, explains that the repository is public, and asks to move the value to the Kubernetes Secret kubepulse-secrets; request changes on the pull request"
---

## When it applies
On every PR. The repo `cifuentescossio/kubepulse` is public and every commit is visible.

## How it works
It searches the added lines for real credential values. Variable names
(`ELASTIC_API_KEY`, `OTEL_EXPORTER_OTLP_HEADERS`, `DASH0_RUM_TOKEN`) and references to
`secretKeyRef`/`envFrom` of the Secret `kubepulse-secrets` are allowed; the values are not.

## Why it matters
A token leaked in a public repo gets used within minutes. Credentials live only in the Kubernetes
Secret, created outside git.
