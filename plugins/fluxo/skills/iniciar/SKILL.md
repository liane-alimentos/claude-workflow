---
name: iniciar
description: Prepara um repositório para o fluxo orquestrado de demandas (cria .claude/fluxo.json, pasta de demandas com templates e kanban, e liga os plugins no .claude/settings.json). Usar quando o usuário pedir para adotar o fluxo num repositório que ainda não tem .claude/fluxo.json.
---

# Iniciar o fluxo num repositório

Faça numa branch própria (`docs/fluxo-orquestrado`, a partir da branch principal atualizada), nunca direto na branch principal, e entregue por PR.

1. **Descubra o projeto antes de propor:** branch principal (`git symbolic-ref refs/remotes/origin/HEAD`), onde já ficam docs de demanda e handoffs, arquivo de regras (`CLAUDE.md`, `AGENT.md`, `AGENTS.md`) e os comandos de teste e build de cada app. Se o repositório já tem um fluxo próprio, leia-o e mostre ao usuário o que muda.
2. **Proponha ao usuário** os valores de `.claude/fluxo.json` e o que entra nos arquivos de regras, e espere o ok.
3. **Crie `.claude/fluxo.json`** só com os campos que fogem do padrão (padrões no `/fluxo:orquestrar`). Exemplo:
   ```json
   {
     "branchPrincipal": "master",
     "pastaDemandas": "docs/demandas",
     "kanban": "docs/demandas/README.md",
     "pastaHandoff": "docs/handoff",
     "regras": ["CLAUDE.md"]
   }
   ```
4. **Copie os templates** de `templates/`, nesta skill, para `<pastaDemandas>/_template/`.
5. **Crie o kanban** com a seção de nomeação, o ciclo de status e a tabela `| NNN | Slug | Título | Status | Branch / PR |`. Demandas antigas que não seguem `NNN-slug` ficam como estão; cite-as numa seção "Antes do fluxo".
6. **Ligue os plugins** no `.claude/settings.json` do projeto, preservando o que já existe:
   ```json
   {
     "extraKnownMarketplaces": {
       "liane": { "source": { "source": "github", "repo": "liane-alimentos/claude-workflow" } }
     },
     "enabledPlugins": {
       "fluxo@liane": true,
       "pr-review-toolkit@claude-plugins-official": true
     }
   }
   ```
7. **No arquivo de regras**, troque qualquer fluxo antigo por uma seção curta: "Fluxo de trabalho: plugin `fluxo` — siga `/fluxo:orquestrar`; configuração em `.claude/fluxo.json`". Mantenha (e, se preciso, reorganize sob "Regras do projeto para o fluxo") o que é próprio do projeto: comandos de teste e build, contornos conhecidos, armadilhas, restrições de paralelismo e de operação em servidor. Inclua a regra "testes primeiro".
8. Commit, push e PR com descrição em pt-BR (`--body-file` em UTF-8). O merge é do usuário.
