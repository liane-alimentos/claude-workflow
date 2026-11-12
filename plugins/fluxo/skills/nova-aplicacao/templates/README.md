# {{nome}}

{{objetivo}}

## Aplicações

| Pasta | O que é | Stack | Client Keycloak |
|---|---|---|---|
<!-- se backend -->
| [`apps/{{backend}}`](apps/{{backend}}/README.md) | API | {{stack_backend}} | `{{backend}}` |
<!-- se frontend -->
| [`apps/{{frontend}}`](apps/{{frontend}}/README.md) | Web | {{stack_frontend}} | `{{frontend}}` |

## Como rodar
Os comandos de cada aplicação estão no README dela. As variáveis de ambiente ficam em `.env` (fora do Git), a partir do `.env.example` de cada app.

## Login
Pelo Keycloak da Liane (realm `liane`), com as roles da aplicação como client roles. Detalhes e passos de implantação em [`docs/deploy/DEPLOY.md`](docs/deploy/DEPLOY.md).

## Como trabalhamos
As demandas seguem o fluxo orquestrado do plugin `fluxo` (marketplace `liane`): US, Spec e Tasks aprovadas, testes primeiro, revisão e PR. Regras em [`CLAUDE.md`](CLAUDE.md); kanban em [`docs/demandas/README.md`](docs/demandas/README.md).
