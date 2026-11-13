# {{backend}}

API do {{nome}}. Stack: {{stack_backend}}.

> O projeto é criado na demanda `001` (esqueleto), pelo fluxo.

## Comandos
{{comandos_backend}}

## Autenticação
- Valida o JWT emitido pelo Keycloak (realm `liane`) pelo JWKS: `${KEYCLOAK_ISSUER}/protocol/openid-connect/certs`.
- Confere `iss` (`KEYCLOAK_ISSUER`) e `aud` (`{{backend}}`).
- Roles em `resource_access["{{backend}}"].roles`; cada endpoint declara as roles que aceita.
- Configuração do client e dos groups: [`docs/deploy/DEPLOY.md`](../../docs/deploy/DEPLOY.md).

## Variáveis
Ver `.env.example` (sem valores). Segredos fora do Git.
