---
title: "Horas siempre con zona horaria"
description: "Exige ISO 8601 con offset -07:00 en datos, respuestas del API, mocks y tests"
when: "A pull request is opened or updated and changes files under app/data/, app/public/mock/, app/src/ or tests"
actions: "If the diff adds a date-time without an explicit UTC offset, a naive local time, or a time in UTC where docs/contracts.md requires Salt Lake City time (-07:00), post a pull request comment listing each occurrence with the corrected value, for example 2026-11-09T09:20:00-07:00"
---

## When it applies
On PRs that touch talk data, frontend mocks, API code or tests.

## How it works
It checks the times being added. Valid: `2026-11-09T09:20:00-07:00`. Invalid:
`2026-11-09T09:20:00`, `09:20` as a talk's time in data or responses, or `...Z` in fields
that the contract defines in Salt Lake City time.

## Why it matters
The conference is in Salt Lake City and attendees come from many time zones. A time without an
offset makes the agenda and the pulse show the wrong talk.
