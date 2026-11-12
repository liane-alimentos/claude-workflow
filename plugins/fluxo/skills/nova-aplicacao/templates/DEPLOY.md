# Plano de implantação: {{nome}}

Passos que o responsável executa na implantação, um por vez, conferindo o resultado de cada um. Nenhum agente executa estes passos. Segredos não entram aqui: o documento só diz onde cada um é configurado.

Referência do modelo do Keycloak: [infra/keycloak/README.md do data-intelligence](https://github.com/liane-alimentos/data-intelligence/blob/main/infra/keycloak/README.md) ("Plugar uma aplicação nova").

## 1. Keycloak (realm `liane`)

<!-- se backend -->
### 1.1 Client da API: `{{backend}}`
1. **Clients → Create client**: `client_id` `{{backend}}`, OpenID Connect.
2. Sem login próprio: *Client authentication* desligado, *Standard flow* e *Direct access grants* desligados. Ele existe para dar nome à audiência e guardar as roles da aplicação.
3. **Client roles**: as roles da aplicação (definidas na spec da demanda que as cria; exemplo: `admin`, `user`).
4. `fullScopeAllowed: false` (aba *Client scopes* → *Dedicated scope* → *Full scope allowed* desligado).
- **Como conferir:** o client aparece na lista, com as roles na aba *Roles*.

<!-- se frontend -->
### 1.2 Client da web: `{{frontend}}`
1. **Clients → Create client**: `client_id` `{{frontend}}`, OpenID Connect, **público** (*Client authentication* desligado), *Standard flow* ligado, PKCE `S256` (*Advanced* → *Proof Key for Code Exchange*).
2. **Valid redirect URIs**: `https://{{frontend}}.intranet.liane.ind.br/*` e, para desenvolvimento, `http://localhost:3000/*`.
3. **Web origins**: `https://{{frontend}}.intranet.liane.ind.br` e `http://localhost:3000`.
4. `fullScopeAllowed: false`.
<!-- se backend -->
5. **Scope mapping** das roles da API: *Client scopes* → *Dedicated scope* → *Scope* → *Assign role* → client `{{backend}}`, todas as roles. Assim o token da web carrega `resource_access["{{backend}}"].roles`.
6. **Audience**: *Dedicated scope* → *Add mapper* → *By configuration* → *Audience*, *Included Client Audience* `{{backend}}`, *Add to access token* ligado.
- **Como conferir:** em *Client scopes* → *Evaluate*, com um usuário de teste, o access token tem `aud` com `{{backend}}` e as roles em `resource_access`.

### 1.3 Groups
1. **Groups → Create group** `/apps/{{app_client}}` (container, sem role mapping).
2. Um subgroup por role, `/apps/{{app_client}}/<role>`, cada um com o role mapping da client role de mesmo nome.
3. Usuários entram pelos groups, nunca por role direta.
- **Como conferir:** um usuário de teste no group `/apps/{{app_client}}/<role>` recebe a role no token.

## 2. Infraestrutura (repositório `infra`)
Mudanças por PR no `infra`, executadas pelo responsável no servidor `.215`:
1. **DNS** (Samba4): registro `{{frontend}}.intranet.liane.ind.br` (e `{{backend}}`, se a API for publicada à parte) → ver `proxy/docs/02-dns-samba.md`.
2. **Proxy**: `.conf` em `proxy/nginx/conf.d/`, a partir de um existente; `nginx -t` e reload.
3. **Deploy**: manifesto em `scripts/deploy/projects/` apontando para as imagens no GHCR (`ghcr.io/liane-alimentos/{{slug}}-…`) e as tags do release; deploy com `deploy.ps1`.
4. **Central**: link da aplicação na página inicial da intranet.

## 3. Variáveis de ambiente
| App | Variável | Valor / onde fica |
|---|---|---|
<!-- se backend -->
| API | `KEYCLOAK_ISSUER` | `https://identity.intranet.liane.ind.br/realms/liane` |
| API | `KEYCLOAK_AUDIENCE` | `{{backend}}` |
<!-- se frontend -->
| Web | `KEYCLOAK_ISSUER` | `https://identity.intranet.liane.ind.br/realms/liane` |
| Web | `KEYCLOAK_CLIENT_ID` | `{{frontend}}` |
| Web | `GITHUB_TOKEN` (build) | token com `read:packages`, para instalar o design system; só no CI e na máquina de build |

## 4. Ordem
Keycloak → API → web. Parar se um passo falhar.
