# KubePulse · Review instructions for Gitar

KubePulse is a conference copilot (KubeCon NA 2026, Salt Lake City): it recommends talks with
hybrid search in Elasticsearch and shows room occupancy with a simulated OpenTelemetry metric
that goes to Dash0. It runs on Kubernetes with GitOps (Argo CD). The repo is **public**.

The contract between modules is in @../../docs/contracts.md. It is the source of truth: if the code and the
contract don't match, the code is wrong (or the PR must change the contract explicitly).

## What to review first

1. **Secrets.** No token, API key, password, kubeconfig or `Authorization` header with a real
   value in the code, manifests, tests, mocks or logs. Credentials only arrive
   through environment variables from the Secret `kubepulse-secrets`. In the frontend, only
   `DASH0_RUM_TOKEN` (an ingest-only token) may appear, injected by the template, never written by hand.
2. **Times with a time zone.** Every time in data, API responses, mocks and tests is ISO 8601
   with Salt Lake City's explicit offset (`2026-11-09T09:20:00-07:00`). Flag any time without an
   offset, with `Z` where the contract asks for `-07:00`, or built with a local `new Date()` without an offset.
3. **API format.** The responses of `/recommend`, `/search`, `/pulse`, `/pulse/history`,
   `/chaos` and `/ask` must follow the contract field by field. Errors are `{ "error": "<message>" }`
   with 400 for invalid input. Always validate the body and the query params.
4. **Folder owners.** Each folder has an owner according to the contract's table. A PR that touches
   another module's folders must justify it. `app/package.json` only changes to add
   required dependencies, with the version pinned by the lockfile.
5. **Graceful degradation.** If Elasticsearch, Dash0 or the LLM fail or are slow, the app responds with
   a fallback (local ranking, mocks, `degraded: true`) and doesn't break the UI. Every external call has
   a timeout.
6. **Bounded load.** No endless loops, multiple timers or memory that grows without limit:
   the cluster has 2 CPU and 4 GiB of requests in total. Chaos (`POST /chaos`) only exists with
   `DEMO_MODE=true` and always has a maximum duration and latency.
7. **Kubernetes.** Nothing privileged, no `hostPath`, `hostNetwork` or `hostPID`. Every container has
   requests and limits. The Service `app` (port 80) and `/healthz` and `/readyz` are never removed.
8. **Accessibility (frontend).** Native elements (`<button>`, `<a href>`, `<label>`,
   `<fieldset>`), no `onclick` on a `div`. Occupancy states always use symbol + text +
   percentage, never color alone. Contrast ≥ 4.5:1. Colors only through the theme's CSS variables.
9. **Privacy.** People are not tracked: occupancy is simulated and the profile lives in
   `localStorage`. Flag any sending of the profile to third parties or any personal data in logs.

## What not to comment on

- The occupancy data is simulated on purpose; don't flag that as a risk by itself.
- The extra latency during chaos is intentional for the demo, as long as it is bounded.
- The Phippy & Friends mascots are CC-BY; only require the attribution in the footer.
