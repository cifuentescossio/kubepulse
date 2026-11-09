---
title: "Sin secretos en un repo público"
description: "Bloquea cualquier credencial escrita en el código, los manifiestos o el frontend"
when: "A pull request is opened or updated and adds or changes any file"
actions: "If the diff adds anything that looks like a real credential (API key, bearer token, password, kubeconfig, Authorization header value, Elastic or Dash0 or OpenAI key), post a pull request comment that names the file and line, explains that the repository is public, and asks to move the value to the Kubernetes Secret kubepulse-secrets; request changes on the pull request"
---

## Cuándo aplica
En cualquier PR. El repo `cifuentescossio/kubepulse` es público y cada commit queda a la vista.

## Cómo funciona
Busca en las líneas agregadas valores reales de credenciales. Los nombres de variables
(`ELASTIC_API_KEY`, `OTEL_EXPORTER_OTLP_HEADERS`, `DASH0_RUM_TOKEN`) y las referencias a
`secretKeyRef`/`envFrom` del Secret `kubepulse-secrets` están permitidos; los valores no.

## Por qué importa
Un token filtrado en un repo público se usa en minutos. Las credenciales viven solo en el Secret
de Kubernetes, creado fuera de git.
