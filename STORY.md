# KubePulse · La historia del día

Notas para la demo de las 5:30. Todas las horas son del lunes 2026-11-09 en Salt Lake City (`-07:00`).

## Before

Radar Checks (`get_cluster_audit`), cluster `kubepulse` (`EZimagd4xoE`), namespace `team-kubepulse`,
2026-11-09T12:30-07:00. Momento: primer deploy por Argo CD (`a06dc31`, imagen
`ghcr.io/cifuentescossio/kubepulse:01665fb`), antes de cualquier feature.

**4 hallazgos, todos medium, todos en `Deployment/team-kubepulse/app`:**

| Categoría | Check | Mensaje |
|---|---|---|
| Security | `automountServiceAccountToken` | Service account token is auto-mounted |
| Security | `readOnlyRootFs` | Container "app" does not use a read-only root filesystem |
| Reliability | `missingPDB` | Deployment has 2 replicas but no PodDisruptionBudget |
| Reliability | `missingTopologySpread` | Deployment has 2 replicas but no topology spread constraints |

Critical 0 · High 0 · Medium 4 · Low 0.

## Timeline

- **11:55-07:00** Repo `cifuentescossio/kubepulse` desde `skyhook-io/cnh-starter`; contratos y esqueleto Express.
- **12:00-07:00** Cuatro agentes en paralelo (infra/OTel, datos/Elastic, pulso, frontend), cada uno en su rama.
- **12:05-07:00** Push inicial a `main` → build en GHCR → commit `deploy: 01665fb`.
- **12:25-07:00** Argo CD aplicado con el MCP de Radar: Application `app` Synced/Healthy en `a06dc31`, 2/2 pods, `/version` = `01665fb`.
- **12:30-07:00** Gitar instalado; PR #1 (pulso) aprobado por Gitar; PR #2 con reglas del repo en `.gitar/`, unido a las 12:31-07:00 tras aplicar la sugerencia de Gitar (`5784ab0`).
- **12:30-07:00** El cluster se desconectó de Radar unos minutos: la UI de Checks avisó "Some audit results are unavailable" en vez de mostrar un falso 0.
- **12:36-07:00** PR #4 de A (OTel → Dash0 + fix de los 4 Checks), aprobado por Gitar (reglas 2/2) y unido (`c1b2dc0`).
- **12:37-07:00** El deploy no avanzaba. Con `diagnose` de Radar vimos la causa: la Application tenía `ComparisonError` ("connection refused" a `argocd-repo-server:8081`) y el repo-server (preinstalado) estaba en CrashLoopBackOff. Cuando volvió a `Running`, sincronizamos con `manage_gitops` y esperamos con `wait_for`: Synced/Healthy en `3ecbfac`, 2/2 pods con `:c1b2dc0` en dos nodos, `/version` = `c1b2dc0`. **A en vivo.**
- **12:39-07:00** PR #1 de C (pulso) unido; build `3d54149` listo, pero el repo-server volvió a caer.
- **12:55-07:00** Investigación del AI SRE de Radar sobre `argocd/argocd-repo-server`: no se cae solo, lo mata su liveness probe. Dos health checks tardaron 1.6 s y 2.4 s contra un `timeoutSeconds: 1`, Kubernetes manda SIGTERM y el ciclo se repite (13 reinicios). No tocamos el componente preinstalado.
- **13:00-07:00** Evidencia llevada a la mesa de Radar como issue de plataforma; lo están revisando.
- **Entre 12:55 y 13:36-07:00** En una ventana con el repo-server 1/1 hicimos refresh + sync: **C en vivo** con `3d54149`.
- **13:36-07:00** Secret `kubepulse-secrets` creado desde la UI de Radar, fuera de git (8 claves; ningún valor en el repo). Restart con `manage_workload`: 2/2 pods con `:3d54149`, logs `[otel] telemetry on` y ningún error de export OTLP.
- **13:46-07:00** PR #7 de A unido: CI de pull requests. El CI falló a propósito con un test de zona horaria (`/version` daba UTC con `Z`). Con `gitar auto-apply:on`, Gitar analizó el fallo y subió el fix solo (`5848b27`, offset `America/Denver` + test de horario de verano). CI verde en ~3 min.
- **13:47-07:00** PR #8 de C unido: pulso determinista (misma ocupación en todos los pods) y caos compartido entre réplicas por el Service headless `app-peers`. Gitar pidió cambios en la ronda 1 (cualquiera podía falsear el header de reenvío; ventanas sin tope) y aprobó en la ronda 2.
- **13:48-07:00** PR #9 de E unido: `POST /ask` con OpenAI/Elastic y fallback local, README y declaración de uso de IA. En vivo: `/version` = `75983f6`, arrancado a las 13:54:02-07:00.
- **14:00-07:00** PR #5 de B unido: búsqueda híbrida RRF en Elastic con fallback local. Gitar encontró un falso match por substring en los temas (`sec`/`gen` coincidían con palabras que no tocaban); se arregló con match por palabra completa (`78b34ac`). Build `40c8fc9` ok.
- **14:01-07:00** PR #6 de D unido: frontend /profile, /schedule, /live (entonces /perfil, /agenda, /pulso). Gitar encontró que los eventos RUM a Dash0 llevaban rol, intereses y datos de accesibilidad; ahora `profile_saved` solo manda un conteo (`df48d0e`). Build `aad9ff6` ok.
- **14:18-07:00** `/version` sigue en `75983f6`: los builds de B y D están listos y falta el sync de Argo CD.
- **14:38-07:00** PR #10 unido y build `f285332` (commit `deploy: f285332`): inglés por defecto, 5 idiomas (en, zh, hi, es, fr), tema Kube por defecto y URLs en inglés (`/profile`, `/schedule`, `/live`; las viejas redirigen con 301). Como el `argocd-repo-server` seguía inestable, se desplegó cambiando la imagen cuando git ya coincidía con esa versión.

## After

Radar Checks en `team-kubepulse`: **4 Medium → 0**. El fix es el commit `0795b53` (PR #4): sin token de
service account, root filesystem de solo lectura con `emptyDir` en `/tmp`, PDB `app` con `minAvailable: 1`, y
`topologySpreadConstraints` con `ScheduleAnyway` (los pods quedaron en dos nodos).

Vista general del cluster (captura After): `team-kubepulse` ya no aparece en el filtro de Namespace;
checks con hallazgos 14 → 12, recursos con problemas 44 → 40, passing 369/416 → 374/417. Los hallazgos que
quedan son de la plataforma preinstalada (Argo CD, Prometheus, CNPG, Radar) y no son del equipo.

## The story

**Three minutes, in English.** *Resumen en español:* KubePulse arma tu agenda de KubeCon y te avisa en vivo
cuando una sala se llena. Lo desplegamos por GitOps con Argo CD, operado desde Radar. Radar encontró una falla
real de la plataforma (el `argocd-repo-server` en CrashLoop por un liveness probe de 1 s); el AI SRE la explicó y
llevamos la evidencia al equipo de Radar. Gitar revisó cada PR y arregló solo un CI roto. Checks: de 4 a 0.

- **What we built.** KubePulse is a conference copilot: it turns the KubeCon schedule into a personal plan with
  Elastic hybrid search (BM25 + semantic, RRF) and shows live, simulated room occupancy so attendees don't walk to
  a full room; it runs at `https://kubepulse.cnh.radarhq.io` (`/version` = `75983f6`).
- **How we shipped.** Every change went through a PR reviewed by Gitar, merged to `main`, built by the
  `build-and-deploy` Action (8 `deploy:` commits today) and synced by Argo CD through Radar's `manage_gitops` and
  `wait_for`.
- **What broke and what Radar showed.** A deploy stalled at 12:37-07:00; Radar's `diagnose` showed the
  Application's `ComparisonError` and the pre-installed `argocd-repo-server` in CrashLoopBackOff, so we deployed
  in its healthy windows instead of touching a component we don't own.
- **The investigation.** Radar's AI SRE found the cause at 12:55-07:00: the liveness probe kills the repo-server
  when a health check takes 1.6–2.4 s against a 1 s timeout (13 restarts); we took that evidence to the Radar
  team as a platform issue.
- **Checks before and after.** Radar Checks in `team-kubepulse` went from 4 Medium findings to 0 with one commit
  (`0795b53`), and the cluster view went from 369/416 to 374/417 passing.

Gitar extras worth a sentence if there's time: auto-apply fixed a failing time-zone test on PR #7 (`5848b27`), and
its reviews caught a substring false match in search (PR #5) and profile data leaking into RUM events (PR #6).

### Screenshots to take

Cluster id `EZimagd4xoE`.

- Timeline of the day's changes: `https://app.radarhq.io/c/EZimagd4xoE/timeline`
- Application `app`: `https://app.radarhq.io/c/EZimagd4xoE/resources/applications?resource=team-kubepulse/app&apiGroup=argoproj.io`
- All Checks (the platform's findings show what Radar catches): `https://app.radarhq.io/checks?scope=EZimagd4xoE`
- Team Checks, next to the morning's Before: `https://app.radarhq.io/checks?scope=EZimagd4xoE&namespace=team-kubepulse`
- The AI SRE investigation: `https://app.radarhq.io/c/EZimagd4xoE/investigations` (already in `~/k8s/kubecon/evidencia/ai-sre-*.webp`)
- The repo-server Radar page: `https://app.radarhq.io/c/EZimagd4xoE/resources/deployments?resource=argocd/argocd-repo-server`
