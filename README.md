# claude-workflow

Marketplace de plugins do Claude Code da Liane Alimentos. Hoje tem três plugins: **`fluxo`**, o fluxo orquestrado de demandas criado no repositório `sales-force` (demanda 005), **`worktrees`**, um painel para acompanhar e limpar as git worktrees, e **`demanda`**, um painel com a US, a Spec e as Tasks da demanda em que a sessão trabalha.

## O que o plugin `fluxo` traz
- **Agentes** `fluxo:architect` (opus), `fluxo:developer` (sonnet) e `fluxo:reviewer` (opus).
- **Guarda de comandos** (`hooks/guard-agent.mjs`), ligada em `PreToolUse`. Ela identifica o agente pelo `agent_type` e nega o que o papel não pode: push, merge e commit na branch principal, escrita do Arquiteto fora da pasta de demandas, escrita do Developer no handoff, qualquer escrita do Reviewer. Na sessão principal e nos demais agentes, não interfere. Em sessão num git worktree, a pasta do projeto é o worktree do `cwd` (se for do mesmo repositório).
- **Contexto de início de sessão** (`hooks/session-start.mjs`, em `SessionStart`): num repositório com `.claude/fluxo.json`, diz à sessão se ela é a de coordenação (branch que não é de demanda) ou a de uma demanda (`feat/NNN-slug`, `docs/NNN-slug`, `fix/NNN-slug`) e manda carregar o `/fluxo:orquestrar`.
- **Skill `/fluxo:nova-aplicacao`**: cria uma aplicação nova no padrão da casa. Pergunta o objetivo, se há backend e frontend (stack e nome do client Keycloak de cada um) e se haverá CI/CD; cria `apps/`, `docs/`, README, `CLAUDE.md`, o fluxo, o plano de deploy com o Keycloak e o `infra`, o design system no frontend e os workflows do GitHub Actions. O esqueleto das apps fica como a demanda 001.
- **Skills** `/fluxo:orquestrar` (manual da sessão principal: a sessão de coordenação abre uma sessão por demanda, e a sessão da demanda conduz as etapas) e `/fluxo:iniciar` (prepara um repositório para o fluxo, com templates de US, Spec, Tasks, Bug e avaliação).
- **Dois tipos de demanda**: funcionalidade (US → Spec → Tasks, três aprovações, branch `feat/`) e correção (um `bug.md` com reprodução, causa raiz, correção, CA-N e tasks; uma aprovação, a do diagnóstico, ou nenhuma se a correção for trivial; branch `fix/`). A coordenação classifica e confirma com o usuário.

## O que o plugin `worktrees` traz
Um painel, aberto com `/worktrees`, que varre os repositórios das pastas configuradas (padrão `C:\projetos\liane`) e mostra cada git worktree: status, tamanho em disco, branch, PR e a sessão do app que trabalha nela.
- **Status**: em uso (sessão nas últimas 3 h), com trabalho (arquivos sem commit ou commits só na máquina), aguardando (PR aberto ou mexida recente) e pode liberar (PR merged ou fechado, tudo já na branch principal, parada há mais de 7 dias com tudo enviado, ou pasta órfã).
- **Filtro**: os cards do topo filtram a lista por status.
- **Sessão**: clicar no nome da worktree (↗) abre a sessão do app desktop que trabalha nela.
- **Remoção**: só para o que não perde nada, sempre com confirmação. Usa `git worktree remove` sem `--force` e apaga a branch local quando ela já foi merged.
- A barra de status mostra quanto dá para liberar. A varredura roda ao abrir a sessão e a cada 30 minutos.
- Opção `raizes`: as pastas varridas, separadas por `;`.

## O que o plugin `demanda` traz
Um painel, aberto com `/demanda` (e sozinho quando a sessão entra numa demanda), com a demanda do fluxo em que a sessão está trabalhando.
- **Qual demanda**: a da branch (`feat/NNN-slug`, `docs/NNN-slug` ou `fix/NNN-slug`) em `<pastaDemandas>` do `.claude/fluxo.json`; fora dela, a dos arquivos `us.md`, `spec.md`, `tasks.md` ou `bug.md` que a sessão ou um subagente dela leu ou escreveu. Sem nenhuma das duas, o painel lista as demandas da pasta para escolher.
- **Etapas**: US → Spec → Tasks → Implementação → Review → Concluída, a partir do status do `us.md`, marcando quando a etapa aguarda a sua aprovação. Numa correção: Diagnóstico → Implementação → Review → Concluída, a partir do `bug.md`, com as abas Diagnóstico e Tasks.
- **Abas** US, Spec e Tasks com o conteúdo dos arquivos. Na aba Tasks, uma linha por task com o estado (☐ pendente, ◐ em andamento, ☑ feita) e o título, com a task da vez destacada e a barra de andamento; clicar na task abre o detalhe, a seção da Spec e a verificação.
- Releitura a cada 20 s e depois das ferramentas da sessão; a barra de status mostra a demanda, o status e as tasks feitas.

## Instalar
Uma vez por máquina:

```bash
claude plugin marketplace add liane-alimentos/claude-workflow
claude plugin install fluxo@liane
claude plugin install worktrees@liane
claude plugin install demanda@liane
claude plugin install pr-review-toolkit@claude-plugins-official
```

Nos repositórios que já adotaram o fluxo, o `.claude/settings.json` declara o marketplace e habilita os plugins; quem abrir o repositório é convidado a instalar.

## Configuração por projeto
Cada repositório tem um `.claude/fluxo.json` com o que foge do padrão (branch principal, pasta de demandas, kanban, handoff, arquivos de regras). Campos e padrões em [`skills/orquestrar/SKILL.md`](plugins/fluxo/skills/orquestrar/SKILL.md).

## Desenvolver
- `npm test` roda as suítes da guarda e do hook de início de sessão (Node 20+). Os painéis (`worktrees`, `demanda`) se testam com `claude plugin test plugins/<nome>`.
- Mudou o plugin? Suba a `version` em `plugins/fluxo/.claude-plugin/plugin.json`, abra PR e, depois do merge, rode `claude plugin marketplace update liane` nas máquinas.

## Changelog
- **1.5.0** e **demanda 0.2.0** — Caminho de correção. Bug não passa mais por US, Spec e Tasks: a coordenação classifica a demanda (funcionalidade ou correção, e se a correção é trivial) e confirma com o usuário; a correção usa a branch `fix/NNN-slug` e um único `bug.md` (relato, reprodução, esperado × atual, causa raiz, correção proposta, CA-N e tasks), com uma aprovação, a do diagnóstico, ou nenhuma se trivial. O Arquiteto pode derrubar a triagem (`TRIVIAL: não`) ou propor tratar como funcionalidade; o Developer começa pelo teste que reproduz o bug, e o Reviewer confere que ele veio antes da correção. Hook `SessionStart` e painel `/demanda` reconhecem `fix/` e o `bug.md`. Repositórios que já adotaram o fluxo: copiem `plugins/fluxo/skills/iniciar/templates/bug.md` para `<pastaDemandas>/_template/` e acrescentem o ciclo de status da correção ao kanban.
- **demanda 0.1.1**: aba Tasks compacta: uma linha por task com o título (até o primeiro `<br>`), a task da vez destacada e o detalhe, a Spec e a verificação abertos ao clicar, em markdown.
- **demanda 0.1.0**: primeira versão do painel `/demanda`.
- **worktrees 0.1.0**: primeira versão do painel `/worktrees`.
- **1.4.0** — Skill `/fluxo:nova-aplicacao`: perguntas (objetivo, backend, frontend, stacks, clients Keycloak, CI/CD, branch), estrutura `apps/<backend>`, `apps/<frontend>` e `docs/`, README, `CLAUDE.md` com as regras da casa (Keycloak por client roles e groups, design system `@liane-alimentos/ui`), fluxo orquestrado pronto, `docs/deploy/DEPLOY.md` com os passos no Keycloak e no `infra`, e `ci.yml`/`publish.yml` que só rodam quando a app já tem projeto. Repositório no GitHub só com o ok do usuário.
- **1.3.2** — A guarda deixa o Reviewer definir antes do comando as variáveis inofensivas `DOTNET_ROOT`, `DOTNET_ROLL_FORWARD`, `DOTNET_NOLOGO`, `DOTNET_CLI_TELEMETRY_OPTOUT`, `CI`, `NO_COLOR` e `FORCE_COLOR`, com valor simples; antes, `DOTNET_ROOT=$HOME/.dotnet dotnet test` era negado. O comando em si segue as regras do Reviewer. No `/fluxo:orquestrar`, nova seção "Retomar uma demanda em outra sessão": quem para antes do PR solta a branch (`git switch --detach`, sem alteração pendente) e a coordenação abre a sessão filha no worktree da demanda.
- **1.3.1** — A coordenação conduz a demanda sempre numa sessão filha. "Aqui", "agora" ou "neste repositório" não bastam para fazer a demanda na própria sessão: só um pedido explícito para não abrir sessão filha, ou a falta de como abrir sessões (CLI). Na dúvida, a sessão pergunta. O hook `SessionStart` repete a regra, e um pedido como "vamos fazer a 001" não transforma a coordenação na sessão da demanda.
- **1.3.0** — Sessão de coordenação no `/fluxo:orquestrar`. Uma sessão aberta fora de uma branch de demanda (checkout principal, worktree automático do app ou pedido como "próxima demanda") passa a coordenar: conversa sobre o backlog, reserva o `NNN`, cria a branch e o worktree e abre uma sessão filha por demanda, com um brief. A sessão filha conduz as etapas com os subagentes, como antes. Onde não há sessões filhas (CLI), a coordenação passa a ser a sessão da demanda. Novo hook `SessionStart` que, pela branch, diz à sessão qual dos dois papéis ela tem.
- **1.2.0** — A guarda funciona em sessões num git worktree. Antes, a raiz do projeto era sempre o `CLAUDE_PROJECT_DIR`, que no Claude Desktop aponta para o checkout principal; com o `cwd` no worktree, o Arquiteto tinha negada a escrita em `docs/demandas/` do worktree, e para o Developer o `docs/handoff/` protegido era o do checkout principal, não o do worktree (e, com o worktree fora do checkout principal, toda escrita era negada). Agora, se o `cwd` do hook estiver num worktree do mesmo repositório (mesmo `git rev-parse --git-common-dir`), a raiz é o topo desse worktree, e o `.claude/fluxo.json` é lido dali. Escrever no checkout principal a partir do worktree continua negado, um worktree de outro repositório não vira raiz e, se o Git falhar, vale o `CLAUDE_PROJECT_DIR`.
- **1.1.0** — `reviewerComandos` no `.claude/fluxo.json` libera build e testes por projeto; log de diagnóstico opcional por `FLUXO_GUARD_LOG`.
