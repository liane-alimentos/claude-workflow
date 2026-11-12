# CLAUDE.md: como trabalhar neste repositório

{{nome}}: {{objetivo_curto}}

<!-- se backend -->
- `apps/{{backend}}`: API, {{stack_backend}}.
<!-- se frontend -->
- `apps/{{frontend}}`: web, {{stack_frontend}}.
- `docs/`: demandas, handoffs e plano de deploy.

Responda sempre em **português**.

## 1. Fluxo de trabalho: plugin `fluxo`
As demandas seguem o fluxo orquestrado do plugin `fluxo` (marketplace `liane`, repositório `liane-alimentos/claude-workflow`). O manual está em **`/fluxo:orquestrar`**; a configuração deste repositório, em [`.claude/fluxo.json`](.claude/fluxo.json).

Em resumo: a sessão principal só orquestra; o `fluxo:architect` escreve US, Spec e Tasks, cada uma aprovada pelo responsável; o `fluxo:developer` escreve os testes a partir dos CA-N e implementa até passarem; o `fluxo:reviewer` e o `pr-review-toolkit` revisam; a sessão abre o PR, e o merge é do responsável.

**Testes primeiro:** desenhe os testes a partir dos CA-N da spec antes de implementar, e implemente até passarem. Não se altera um teste para fazê-lo passar sem voltar à spec.

## 2. Regras do projeto
- **Login pelo Keycloak** (realm `liane`), no modelo "uma aplicação = um client": roles da aplicação como client roles, atribuídas por groups `/apps/<client>/<role>`, com `fullScopeAllowed: false`. Referência: [infra/keycloak/README.md do data-intelligence](https://github.com/liane-alimentos/data-intelligence/blob/main/infra/keycloak/README.md). As roles são lidas de `resource_access["<client>"].roles`, nunca de `realm_access`.
<!-- se backend -->
- **API:** valida o JWT pelo JWKS do realm (`/realms/liane/protocol/openid-connect/certs`), confere emissor e audiência (`{{backend}}`) e aplica as roles em cada endpoint. A autorização é feita na API; o front só esconde o que a pessoa não pode usar.
<!-- se frontend -->
- **Web:** login OIDC com Authorization Code + PKCE no client público `{{frontend}}`. Interface com o design system [`liane-alimentos/design-system`](https://github.com/liane-alimentos/design-system) (`@liane-alimentos/tokens` e `@liane-alimentos/ui`, versão travada com `^x.y.z`); componentes novos só quando o design system não tiver o que a tela precisa. Telas mobile-first.
- **Keycloak e infraestrutura:** toda mudança de realm (client, client role, group, scope mapping) e de publicação (manifesto de deploy, `.conf` do proxy, DNS no repositório `infra`) entra como passo no [`docs/deploy/DEPLOY.md`](docs/deploy/DEPLOY.md) e é executada pelo responsável na implantação. Nenhum agente altera o Keycloak, o servidor ou o banco de produção.
- **Segredos:** nunca no Git (`.env`, client secrets, senhas, tokens, dumps). Cada app tem `.env.example` com as chaves sem valores.
- **Encoding:** UTF-8 com acentos nos docs; LF. Não regrave arquivos pelo PowerShell com `Set-Content`.
- **Git:** Conventional Commits; em worktree, não use `git stash` simples, porque a pilha é compartilhada com as outras sessões.

## 3. Comandos
<!-- se backend -->
- **API** (`apps/{{backend}}`): {{comandos_backend}}
<!-- se frontend -->
- **Web** (`apps/{{frontend}}`): {{comandos_frontend}}

## 4. Demandas e onde está o estado
- **Kanban:** [`docs/demandas/README.md`](docs/demandas/README.md), fonte única de status e backlog. Demandas em `docs/demandas/NNN-slug/{us,spec,tasks}.md`.
- **Handoffs:** `docs/handoff/SESSION-HANDOFF-AAAA-MM-DD-NNN.md`; comece pelo mais recente.
