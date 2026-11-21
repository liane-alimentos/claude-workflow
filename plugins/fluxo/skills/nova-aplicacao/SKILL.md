---
name: nova-aplicacao
description: Cria uma aplicação nova da Liane já no padrão da casa. Faz perguntas (objetivo, backend, frontend, stacks, nomes dos clients Keycloak, CI/CD), cria a estrutura apps/ e docs/, o README, o CLAUDE.md, o fluxo orquestrado (.claude/fluxo.json, kanban, templates), o plano de deploy com o Keycloak e o design system no frontend. Usar quando o usuário pedir para iniciar, criar ou montar uma aplicação, projeto ou repositório novo.
---

# Nova aplicação

Monta o repositório de uma aplicação nova no padrão da Liane. Esta skill **não escreve código de aplicação**: cria a estrutura, as regras e os documentos, e deixa o esqueleto (login, design system, primeira tela) como a demanda `001`, que segue o fluxo (`/fluxo:orquestrar`) com testes primeiro.

Os modelos ficam em `templates/`, nesta skill. Os marcadores `{{...}}` são preenchidos com as respostas; as seções marcadas com `<!-- se backend -->`, `<!-- se frontend -->` e `<!-- se ci -->` saem quando não se aplicam.

## 1. Perguntas
Responda a tudo antes de criar qualquer arquivo. Use a caixa de perguntas (`AskUserQuestion`) sempre que houver opções; o usuário escreve um valor livre em "Outro".

**Primeiro, numa mensagem só** (pule o que já veio no pedido), e pare até a resposta:
- **Objetivo do projeto**: para que serve, quem usa, o que resolve. Vai para o `README.md`.
- **Nome do projeto**: o slug do repositório (kebab-case, sem acento), por exemplo `portal-fornecedores`.

**Depois, na caixa de perguntas** (até 4 por vez):
1. **Backend?** Opções: `.NET 9 (Minimal APIs)`, `Python 3.12 (FastAPI)`, `Node.js (TypeScript)`, `Sem backend`.
2. **Frontend?** Opções: `Next.js (React)`, `React + Vite`, `Sem frontend`. O design system da Liane é React; se o usuário escolher outra stack em "Outro", avise que o design system não se aplica.
3. **CI/CD no GitHub Actions?** Opções: `CI e publicação de imagem` (build e testes em PR; imagem Docker no GHCR a cada merge), `Só CI` (build e testes em PR), `Sem CI/CD`.
4. **Branch principal?** Opções: `main`, `master`.

**Por fim, os nomes dos clients no Keycloak** (só dos lados que existem), na caixa de perguntas com sugestões derivadas do slug:
- backend: `{{slug}}-api` como primeira opção;
- frontend: `{{slug}}-web` como primeira opção (ou `{{slug}}`).

Os nomes são o `client_id` no realm `liane` e o prefixo dos groups (`/apps/<client>/<role>`): kebab-case, sem acento, únicos no realm.

**Antes de criar**, mostre um resumo curto (pastas, stacks, clients, CI/CD) e pergunte se pode criar e se deve **criar o repositório no GitHub** (`liane-alimentos/{{slug}}`, privado). Criar o repositório remoto só com o ok explícito.

## 2. Onde criar
- Se a pasta atual for um repositório vazio (ou só com `README`/`.gitignore`) do mesmo projeto, crie nela.
- Senão, crie `C:\projetos\liane\{{slug}}` (ou a pasta irmã do repositório atual), com `git init -b {{branch}}`. Nunca escreva dentro de outro repositório.
- Trabalhe na branch principal só neste commit inicial de um repositório novo. Num repositório que já tem histórico, use a branch `chore/estrutura-inicial` e entregue por PR.

## 3. Estrutura
```text
{{slug}}/
  README.md                      objetivo, apps, como rodar, links
  CLAUDE.md                      regras do projeto (Keycloak, design system, segredos, testes)
  .gitignore  .gitattributes  .editorconfig
  .claude/
    fluxo.json                   configuração do fluxo
    settings.json                marketplace liane e plugins fluxo e pr-review-toolkit
  apps/
    {{backend}}/README.md        stack, comandos, autenticação (se houver backend)
    {{frontend}}/README.md       stack, comandos, login, design system (se houver frontend)
    {{frontend}}/.npmrc          escopo @liane-alimentos no GitHub Packages (se houver frontend)
  docs/
    demandas/README.md           kanban, com a 001 no backlog
    demandas/_template/          modelos us, spec, tasks, bug, flow-evaluation
    handoff/README.md
    deploy/DEPLOY.md             plano de implantação: Keycloak, infra, variáveis
    releases/pendentes/README.md notas de implantação à espera do /fluxo:publicar
  .github/workflows/ci.yml       se houver CI
  .github/workflows/publish.yml  se houver publicação de imagem
```

Os nomes das pastas em `apps/` são os nomes dos clients Keycloak, salvo se o usuário pedir outro.

## Marcadores dos modelos
Os marcadores não têm espaço (`{{slug}}`); as expressões do GitHub Actions (`${{ secrets.GITHUB_TOKEN }}`, `${{ matrix.app }}`, `${{ steps.d.outputs.web }}`) ficam como estão.

| Marcador | Valor |
|---|---|
| `{{nome}}` | Nome legível do projeto (do slug, ou como o usuário escrever) |
| `{{slug}}` | Slug do repositório |
| `{{objetivo}}` / `{{objetivo_curto}}` | Objetivo, em parágrafos no README e numa frase no CLAUDE.md |
| `{{branch}}` | Branch principal |
| `{{backend}}` / `{{frontend}}` | Clients Keycloak (e pastas em `apps/`) |
| `{{app_client}}` | O client que guarda as roles da aplicação: `{{backend}}` se houver backend, senão `{{frontend}}` |
| `{{stack_backend}}` / `{{stack_frontend}}` | Stack escolhida |
| `{{comandos_backend}}` / `{{comandos_frontend}}` | Da tabela abaixo |
| `{{apps_com_imagem}}` | Lista das apps com imagem, ex.: `{{backend}}, {{frontend}}` |
| `{{esqueleto}}` | Resumo da 001, ex.: "API .NET 9 e web Next.js com login e layout" |

| Stack | Comandos |
|---|---|
| .NET 9 | `dotnet build`, `dotnet test`, `dotnet run --project <Api>` |
| Python 3.12 (FastAPI) | `poetry install`, `poetry run pytest`, `poetry run ruff check .`, `poetry run uvicorn <app>:app --reload` |
| Node.js (TypeScript) | `pnpm install`, `pnpm test`, `pnpm lint`, `pnpm dev` |
| Next.js / React + Vite | `pnpm install` (com `GITHUB_TOKEN` para o design system), `pnpm dev`, `pnpm test`, `pnpm lint`, `pnpm exec tsc --noEmit`, `pnpm build` |

No `ci.yml`, um backend Node.js usa uma cópia do job `web` apontando para `apps/{{backend}}`; os jobs das stacks não escolhidas saem.

## 4. Arquivos
- **`README.md`**, **`CLAUDE.md`**, **`docs/deploy/DEPLOY.md`**, **`apps/*/README.md`**: dos modelos em `templates/`, preenchidos.
- **`.claude/fluxo.json`**: `{ "branchPrincipal": "{{branch}}", "pastaDemandas": "docs/demandas", "kanban": "docs/demandas/README.md", "pastaHandoff": "docs/handoff", "pastaWorktrees": ".claude/worktrees", "regras": ["CLAUDE.md"], "apps": { "{{backend}}": "apps/{{backend}}", "{{frontend}}": "apps/{{frontend}}" } }` (em `apps`, só as que existirem; o nome é o prefixo da tag `<app>-vX.Y.Z` do `publish.yml`). Se o backend for .NET, acrescente `"reviewerComandos": { "dotnet": ["build", "test"] }`; se o frontend usar pnpm, `"reviewerComandos": { "pnpm": ["test", "lint"] }` (junte os dois quando houver ambos).
- **`.claude/settings.json`**: o mesmo do `/fluxo:iniciar` (marketplace `liane`, `fluxo@liane` e `pr-review-toolkit@claude-plugins-official`).
- **`docs/demandas/_template/`**: copie os modelos de `../iniciar/templates/`.
- **`docs/demandas/README.md`**: kanban de `templates/kanban.md`, com a **001 no backlog** ("Esqueleto das aplicações": `{{esqueleto}}`, login pelo Keycloak e layout com o design system).
- **`docs/releases/pendentes/README.md`**: uma frase: cada PR deixa aqui a nota de implantação, e o `/fluxo:publicar` junta as notas no runbook da publicação.
- **`docs/handoff/README.md`**: uma frase sobre o formato `SESSION-HANDOFF-AAAA-MM-DD-NNN.md`.
- **`.github/workflows/`**: de `templates/ci.yml` e `templates/publish.yml`, só com os jobs das stacks escolhidas. Cada job só roda quando a app já tem projeto (job `detect`), para o CI não falhar antes da 001.
- **`apps/{{frontend}}/.npmrc`**:
  ```text
  @liane-alimentos:registry=https://npm.pkg.github.com
  //npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
  ```
- **`.gitignore`**: `.env`, `.env.*` (exceto `.env.example`), `node_modules/`, `bin/`, `obj/`, `.venv/`, `__pycache__/`, `.next/`, `dist/`, `.claude/worktrees/`, `.claude/settings.local.json`, `.tmp/`.
- **`.gitattributes`**: `* text=auto eol=lf`. **`.editorconfig`**: UTF-8, LF, 2 espaços (4 em `.cs` e `.py`).

Nenhum segredo nos arquivos: senhas, client secrets e tokens ficam fora do Git e entram por variável de ambiente; o `DEPLOY.md` só diz onde cada um é configurado.

## 5. Entrega
1. Confira com `git status` que só entraram os arquivos da estrutura.
2. Commit `chore: estrutura inicial da aplicação` (com a linha de coautoria do Claude).
3. Com o ok do usuário: `gh repo create liane-alimentos/{{slug}} --private --source . --push`. Sem o ok, só o commit local.
4. Reporte o que foi criado, os clients e groups que o `DEPLOY.md` pede no Keycloak, e o próximo passo: abrir a demanda `001` pelo fluxo (`/fluxo:orquestrar`).

## Regras da casa que os modelos já carregam
- **Login pelo Keycloak**, realm `liane`, no modelo "uma aplicação = um client" com client roles, groups `/apps/<client>/<role>` e `fullScopeAllowed: false`. Referência: [infra/keycloak/README.md do data-intelligence](https://github.com/liane-alimentos/data-intelligence/blob/main/infra/keycloak/README.md). Mudanças no realm são passos do `DEPLOY.md`, executados pelo responsável na implantação.
- **Design system** no frontend: [`liane-alimentos/design-system`](https://github.com/liane-alimentos/design-system), pacotes `@liane-alimentos/tokens` e `@liane-alimentos/ui` no GitHub Packages, com versão travada (`^x.y.z`, nunca `latest`).
- **Publicação e infraestrutura**: a aplicação roda no servidor `.215`, atrás do proxy do repositório `infra` (`https://<app>.intranet.liane.ind.br`). O `DEPLOY.md` lista o que entra no `infra` (manifesto em `scripts/deploy/projects/`, `.conf` do proxy, DNS) sem executar nada.
- **Fluxo**: demandas pelo plugin `fluxo`, testes primeiro, merge pelo responsável.
