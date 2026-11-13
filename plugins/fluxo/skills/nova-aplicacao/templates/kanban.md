# Demandas

Cada demanda vive em `docs/demandas/NNN-slug/` com `us.md`, `spec.md` e `tasks.md`, copiados de [`_template/`](_template/). O fluxo é o do plugin `fluxo` (`/fluxo:orquestrar`); a configuração está em [`.claude/fluxo.json`](../../.claude/fluxo.json) e as regras no [`CLAUDE.md`](../../CLAUDE.md).

## Nomeação
- `NNN`: sequencial com 3 dígitos (`001`, `002`, …), nunca reutilizado, mesmo se a demanda for cancelada.
- `slug`: kebab-case, minúsculo, sem acento, curto.
- Branch `feat/NNN-slug` (ou `docs/NNN-slug` se só doc), a partir de `origin/{{branch}}`, e worktree `.claude/worktrees/NNN-slug`.

## Status (ciclo de vida)
`us-em-revisão` → `us-aprovada` → `spec-em-revisão` → `spec-aprovada` → `tasks-em-revisão` → `tasks-aprovada` → `em-implementação` → `em-review` → `concluída` (ou `cancelada`).
O status do cabeçalho de `us.md` e a linha da tabela abaixo devem sempre coincidir.

## Kanban
| NNN | Slug | Título | Status | Branch / PR |
|---|---|---|---|---|

## Backlog
Itens ainda sem demanda. Ganham `NNN` e pasta própria quando entram no fluxo.

| Item | Observação |
|---|---|
| 001 — Esqueleto das aplicações | {{esqueleto}}. Cria o projeto de cada app, o login pelo Keycloak (clients do `docs/deploy/DEPLOY.md`), o layout com o design system, o `.env.example`, os testes iniciais e os Dockerfiles |
