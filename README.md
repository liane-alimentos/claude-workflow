# claude-workflow

Marketplace de plugins do Claude Code da Liane Alimentos. Hoje tem um plugin: **`fluxo`**, o fluxo orquestrado de demandas criado no repositório `sales-force` (demanda 005).

## O que o plugin `fluxo` traz
- **Agentes** `fluxo:architect` (opus), `fluxo:developer` (sonnet) e `fluxo:reviewer` (opus).
- **Guarda de comandos** (`hooks/guard-agent.mjs`), ligada em `PreToolUse`. Ela identifica o agente pelo `agent_type` e nega o que o papel não pode: push, merge e commit na branch principal, escrita do Arquiteto fora da pasta de demandas, escrita do Developer no handoff, qualquer escrita do Reviewer. Na sessão principal e nos demais agentes, não interfere. Em sessão num git worktree, a pasta do projeto é o worktree do `cwd` (se for do mesmo repositório).
- **Skills** `/fluxo:orquestrar` (manual da sessão principal) e `/fluxo:iniciar` (prepara um repositório para o fluxo, com templates de US, Spec, Tasks e avaliação).

## Instalar
Uma vez por máquina:

```bash
claude plugin marketplace add liane-alimentos/claude-workflow
claude plugin install fluxo@liane
claude plugin install pr-review-toolkit@claude-plugins-official
```

Nos repositórios que já adotaram o fluxo, o `.claude/settings.json` declara o marketplace e habilita os plugins; quem abrir o repositório é convidado a instalar.

## Configuração por projeto
Cada repositório tem um `.claude/fluxo.json` com o que foge do padrão (branch principal, pasta de demandas, kanban, handoff, arquivos de regras). Campos e padrões em [`skills/orquestrar/SKILL.md`](plugins/fluxo/skills/orquestrar/SKILL.md).

## Desenvolver
- `npm test` roda a suíte da guarda (Node 20+).
- Mudou o plugin? Suba a `version` em `plugins/fluxo/.claude-plugin/plugin.json`, abra PR e, depois do merge, rode `claude plugin marketplace update liane` nas máquinas.

## Changelog
- **1.2.0** — A guarda funciona em sessões num git worktree. Antes, a raiz do projeto era sempre o `CLAUDE_PROJECT_DIR`, que no Claude Desktop aponta para o checkout principal; com o `cwd` no worktree, o Arquiteto tinha negada a escrita em `docs/demandas/` do worktree, e para o Developer o `docs/handoff/` protegido era o do checkout principal, não o do worktree (e, com o worktree fora do checkout principal, toda escrita era negada). Agora, se o `cwd` do hook estiver num worktree do mesmo repositório (mesmo `git rev-parse --git-common-dir`), a raiz é o topo desse worktree, e o `.claude/fluxo.json` é lido dali. Escrever no checkout principal a partir do worktree continua negado, um worktree de outro repositório não vira raiz e, se o Git falhar, vale o `CLAUDE_PROJECT_DIR`.
- **1.1.0** — `reviewerComandos` no `.claude/fluxo.json` libera build e testes por projeto; log de diagnóstico opcional por `FLUXO_GUARD_LOG`.
