# {{frontend}}

Web do {{nome}}. Stack: {{stack_frontend}}.

> O projeto é criado na demanda `001` (esqueleto), pelo fluxo.

## Comandos
{{comandos_frontend}}

## Login
- OIDC com Authorization Code + PKCE no client público `{{frontend}}` do realm `liane`.
- Roles lidas de `resource_access` do access token (do client `{{app_client}}`), só para mostrar ou esconder o que a pessoa pode usar; a autorização de verdade é da API.
- Configuração do client: [`docs/deploy/DEPLOY.md`](../../docs/deploy/DEPLOY.md).

## Design system
- Pacotes `@liane-alimentos/tokens` e `@liane-alimentos/ui`, do repositório [`liane-alimentos/design-system`](https://github.com/liane-alimentos/design-system), publicados no GitHub Packages.
- O `.npmrc` desta pasta aponta o escopo `@liane-alimentos` para o GitHub Packages; a instalação precisa de `GITHUB_TOKEN` com `read:packages`.
- Versão travada (`^x.y.z`, nunca `latest`); upgrade deliberado, lendo o changelog.
- Importe `@liane-alimentos/tokens/css` e `@liane-alimentos/ui/styles.css` uma vez, no layout raiz. Tema escuro por `data-theme="dark"` no `<html>`.
- Padrões de tela (listagem, cadastro) em `docs/patterns` do design system.
- Telas mobile-first.
