---
title: "Horas siempre con zona horaria"
description: "Exige ISO 8601 con offset -07:00 en datos, respuestas del API, mocks y tests"
when: "A pull request is opened or updated and changes files under app/data/, app/public/mock/, app/src/ or tests"
actions: "If the diff adds a date-time without an explicit UTC offset, a naive local time, or a time in UTC where docs/contracts.md requires Salt Lake City time (-07:00), post a pull request comment listing each occurrence with the corrected value, for example 2026-11-09T09:20:00-07:00"
---

## Cuándo aplica
En PRs que tocan datos de charlas, mocks del frontend, código del API o tests.

## Cómo funciona
Revisa las horas que se agregan. Válido: `2026-11-09T09:20:00-07:00`. Inválido:
`2026-11-09T09:20:00`, `09:20` como hora de una charla en datos o respuestas, o `...Z` en campos
que el contrato define en hora de Salt Lake City.

## Por qué importa
La conferencia es en Salt Lake City y los asistentes vienen de muchas zonas horarias. Una hora sin
offset hace que la agenda y el pulso muestren la charla equivocada.
