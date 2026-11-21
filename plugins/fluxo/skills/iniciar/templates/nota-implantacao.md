# NNN-slug — Nota de implantação

- **Demanda:** `NNN-slug` (em `<pastaDemandas>/NNN-slug/`)
- **Branch:** `feat/NNN-slug` ou `fix/NNN-slug` (o `/fluxo:publicar` acha o PR por ela)
- **Apps:** api, web
- **Mudança:** correção | funcionalidade | quebra
- **Migration:** não | sim: <quais, na ordem>
- **Compatível com a versão anterior:** sim | não: <qual app precisa sair antes e por quê>
- **Variáveis de ambiente:** nenhuma | <nome, app, novo ou alterado; nunca o valor>
- **Outros:** nenhum | <labels, cron, Keycloak, infra, DNS, proxy>

Os campos acima são lidos pelo `/fluxo:publicar`; mantenha um valor por campo, sem texto livre antes dele.

## Antes do deploy
Pré-checagens só de leitura e backups. "Nenhuma ação além do deploy" quando for o caso.

## Deploy
Passos por app, na ordem. Só o que foge do deploy padrão da imagem.

## Depois do deploy
Como conferir que funcionou (saúde, tela, endpoint, consulta).

## Como voltar
O que fazer se der errado: voltar a imagem para a tag anterior e, se houver migration, o que ela deixa para trás.

## Proibições
- nenhuma
