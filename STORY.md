# KubePulse · La historia del día

Notas para la demo de las 5:30. La skill `demo-story` agrega `## The story` al final.

## Before

Radar Checks (`get_cluster_audit`), cluster `kubepulse` (`EZimagd4xoE`), namespace `team-kubepulse`,
lunes 9 nov 2026, ~12:30 MT. Momento: primer deploy por Argo CD (`a06dc31`, imagen
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

- **11:55** Repo `cifuentescossio/kubepulse` desde `skyhook-io/cnh-starter`; contratos y esqueleto Express.
- **12:00** Cuatro agentes en paralelo (infra/OTel, datos/Elastic, pulso, frontend), cada uno en su rama.
- **12:05** Push inicial a `main` → build en GHCR → commit `deploy: 01665fb`.
- **12:25** Argo CD aplicado con el MCP de Radar: Application `app` Synced/Healthy en `a06dc31`, 2/2 pods, `/version` = `01665fb`.
- **12:30** Gitar instalado; PR #1 (pulso) aprobado por Gitar; PR #2 con reglas del repo en `.gitar/`, unido tras aplicar la sugerencia de Gitar.
- **12:30** El cluster se desconectó de Radar unos minutos: la UI de Checks avisó "Some audit results are unavailable" en vez de mostrar un falso 0.
- **12:35** PR #4 (OTel → Dash0 + fix de los 4 Checks), aprobado por Gitar sin hallazgos (reglas 2/2), unido. Build `c1b2dc0`.
- **12:37** El deploy no avanzaba. Radar mostró la causa: la Application tenía `ComparisonError` ("connection refused" a `argocd-repo-server:8081`) y el repo-server (preinstalado) llevaba 8 reinicios. Cuando volvió a `Running`, sincronizamos con `manage_gitops` y esperamos el rollout con `wait_for`: Synced/Healthy en `3ecbfac`, 2/2 pods con `:c1b2dc0` en dos nodos distintos, `/version` = `c1b2dc0`.

## After (parcial, 12:38)

Radar Checks en `team-kubepulse`: **0 hallazgos** (antes 4 medium). El PDB `app` se creó y los pods
quedaron repartidos en dos nodos gracias a `topologySpreadConstraints`.
