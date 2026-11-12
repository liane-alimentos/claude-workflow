---
name: orquestrar
description: Manual da sessão principal no fluxo orquestrado de demandas (sessão de coordenação que abre uma sessão por demanda; Arquiteto → Developer → Reviewer, com aprovação do usuário a cada etapa). Usar ao abrir uma sessão para continuar o desenvolvimento, escolher a próxima demanda, iniciar, retomar ou conduzir uma demanda em um repositório que tenha .claude/fluxo.json, ou quando o usuário pedir para delegar, especificar, implementar ou revisar uma demanda pelo fluxo.
---

# Fluxo de trabalho orquestrado

Como os subagentes do plugin `fluxo` entregam uma demanda: da ideia ao PR. Um **escopo** por vez, com aprovação explícita do usuário antes de qualquer implementação.

Há dois tipos de sessão principal: a **sessão de coordenação**, que cuida do backlog e abre uma sessão por demanda, e a **sessão da demanda**, que conduz uma demanda pelas etapas. Veja "Sessão de coordenação" abaixo para saber qual você é.

## Configuração do projeto
Leia `.claude/fluxo.json` na raiz do repositório antes de tudo. Campos (todos opcionais):

| Campo | Padrão | Uso |
|---|---|---|
| `branchPrincipal` | `main` | Branch base das demandas; a guarda impede commit e merge nela |
| `pastaDemandas` | `docs/development` | Onde ficam `NNN-slug/{us,spec,tasks}.md`; único lugar onde o Arquiteto escreve |
| `kanban` | `<pastaDemandas>/readme.md` | Fonte única de status e backlog |
| `templates` | `<pastaDemandas>/_template` | Modelos de `us`, `spec`, `tasks` e `flow-evaluation` |
| `pastaHandoff` | `docs/handoff` | Handoffs de sessão, somente leitura depois de escritos |
| `pastaWorktrees` | `../worktrees` | Onde criar o worktree de cada demanda |
| `regras` | `AGENT.md`, `CLAUDE.md` | Arquivos de regras que todo agente lê |
| `reviewerComandos` | nenhum | Programas e subcomandos extras que o Reviewer pode rodar para build e testes, ex.: `{ "dotnet": ["build", "test"] }`. Shells, `git`, `gh`, `node`, `npm`, `npx` e comandos de escrita não entram |

Sem o arquivo, o repositório ainda não está no fluxo: ofereça `/fluxo:iniciar`.

As regras próprias do projeto (comandos de teste, armadilhas, restrições como "migrations uma por vez") ficam nos arquivos de `regras` e **prevalecem** sobre este manual onde forem mais específicas.

## Sessão de coordenação
**Qual sessão você é.** O hook `SessionStart` do plugin já informa isso no início da sessão, pela branch. Você é a **sessão da demanda** quando a branch atual é a de uma demanda (`feat/NNN-slug` ou `docs/NNN-slug`) ou quando a sessão foi aberta pelo brief de uma sessão de coordenação (que nomeia a demanda, a branch e a pasta do worktree). Um pedido do usuário como "vamos fazer a 001" numa sessão que não está na branch da demanda não faz dela a sessão da demanda. Nos outros casos (checkout principal, worktree automático do app, como `claude/<nome>`, ou um pedido como "continuar o desenvolvimento" ou "próxima demanda"), você é a **sessão de coordenação**.

**O que a coordenação faz:**
1. Lê o kanban, o handoff mais recente e as sessões de demanda já abertas, e conversa com o usuário sobre qual demanda começar ou retomar. Decisões e dúvidas de escopo que já aparecem aqui são resolvidas com o usuário antes de abrir a sessão.
2. Faz a preparação (etapa 0): reserva o próximo `NNN`, cria a branch a partir de `origin/<branchPrincipal>` e o worktree em `<pastaWorktrees>/NNN-slug`. O `NNN` é reservado aqui, para que duas sessões em paralelo não escolham o mesmo número.
3. Abre uma **sessão filha** na pasta do worktree, uma por demanda, com um brief que basta para começar sem esta conversa:
   - demanda `NNN-slug`, branch e pasta do worktree;
   - o pedido do usuário com as palavras dele, e as decisões já tomadas;
   - a etapa de onde começar (em geral a US) e a instrução de seguir `/fluxo:orquestrar` como sessão da demanda.
4. Acompanha as sessões filhas e responde às mensagens delas. Quando uma sessão filha fecha um turno, a coordenação informa o usuário em uma ou duas linhas e não conduz as etapas da demanda.

**O que a coordenação não faz:** não aciona `fluxo:architect`, `fluxo:developer` nem `fluxo:reviewer` e não responde às perguntas da demanda pelo usuário. As aprovações de US, Spec e Tasks acontecem na sessão da demanda, com o usuário.

**Paralelismo:** uma demanda por sessão filha. A coordenação só abre outra demanda ao mesmo tempo se o usuário pedir, respeitando as restrições dos arquivos de `regras` (por exemplo, "migrations uma demanda por vez").

**Depois do merge:** o status `concluída` e o `flow-evaluation.md` são gravados pela sessão da demanda. Se ela já tiver sido encerrada, a coordenação grava, numa branch própria e com PR.

**A demanda vai sempre para uma sessão filha.** Isso vale mesmo quando o usuário diz "aqui", "agora" ou "neste repositório": essas palavras indicam o repositório ou o momento, não esta sessão. Não reaproveite a branch nem o worktree de outra sessão para conduzir a demanda aqui; a sessão filha abre na pasta do worktree da demanda.

**Exceções:** a coordenação só passa a ser a sessão da demanda quando o usuário pede explicitamente para não abrir sessão filha (por exemplo, "faça nesta sessão" ou "sem sub-sessão") ou quando não há como abrir outra sessão (no CLI, por exemplo). Ela avisa o usuário em uma linha e segue a partir da etapa 0, no worktree da demanda. **Na dúvida, pergunte** antes de começar, oferecendo abrir a sessão filha como primeira opção.

## Papéis

| Papel | Modelo | Responsabilidade | Não faz |
|---|---|---|---|
| **Usuário** | — | Define a demanda, aprova US, Spec e Tasks, decide escalações e faz o merge | — |
| **Sessão de coordenação** | O escolhido pelo usuário | Conversa sobre o backlog, reserva o `NNN`, cria a branch e o worktree e abre uma sessão filha por demanda | Não aciona os subagentes do fluxo nem conduz as etapas |
| **Sessão principal** (da demanda) | O escolhido pelo usuário | Cria a branch e o worktree (quando a coordenação não criou), delega, leva aprovações e perguntas ao usuário, conta as rodadas, grava os registros do fluxo (handoff, status `em-implementação`, `em-review` e `concluída`, e `flow-evaluation.md`), faz o push e abre o PR | Não escreve código, testes, US, Spec nem Tasks |
| **`Plan`** (opcional) | O padrão do agente | Explora código, docs e handoff e entrega um plano | Não altera estado |
| **`fluxo:architect`** | `opus` | Escreve `us.md`, `spec.md` e `tasks.md`, uma etapa por vez, e faz commit | Não altera código; não faz push, merge nem rebase |
| **`fluxo:developer`** | `sonnet` | Escreve os testes a partir dos CA-N, confirma que falham e implementa até passarem | Não decide dúvida de requisito; não altera teste só para fazê-lo passar; não faz push nem merge |
| **`fluxo:reviewer`** | `opus` | Julga a implementação contra os CA-N e verifica que os testes nasceram da spec | Não edita arquivos nem altera o estado do Git |
| **`pr-review-toolkit`** | Definido pelo plugin | Revisão complementar de código, testes e falhas silenciosas | Não confere a origem dos testes |

A guarda do plugin (`hooks/guard-agent.mjs`, ligada em `PreToolUse`) identifica o agente pelo `agent_type` e nega o que o papel não pode fazer. Na sessão principal e nos demais agentes, ela não interfere.

## Etapas

```text
Usuário pede a demanda → sessão cria a branch e o worktree
→ Arquiteto: US → usuário aprova → Arquiteto: Spec → usuário aprova → Arquiteto: Tasks → usuário aprova
→ Developer implementa e faz commit
→ Reviewer + plugin, em paralelo → reprovado: volta ao Developer (no máximo 3 rodadas; depois, escala ao usuário)
→ aprovado: a sessão grava os registros do fluxo, faz o push e abre o PR → o merge é do usuário
```

### 0. Preparação
Quando a demanda veio de uma sessão de coordenação, a branch e o worktree já existem: a sessão confere a pasta e a branch do brief e segue para a etapa 1. Caso contrário, a sessão escolhe o próximo `NNN` no kanban (maior + 1, nunca reutilizado), faz `git fetch`, cria a branch a partir de `origin/<branchPrincipal>` e o worktree em `<pastaWorktrees>/NNN-slug`, e **trabalha no worktree**. Os subagentes trabalham na pasta da sessão, então não use `isolation: worktree` no Agent: esse campo cria outro worktree a partir da branch padrão. Se a sessão não estiver no worktree, informe a pasta a cada subagente e confira que ele a usa.

**Planejamento (opcional):** se a demanda pedir exploração antes da US, acione o agente `Plan`. Ele só lê e entrega escopo, impacto, abordagem, riscos e perguntas.

### 1. Especificação
A sessão aciona o `fluxo:architect` com o pedido do usuário, a demanda (`NNN-slug`) e a etapa (`us`, `spec` ou `tasks`). Ele escreve só essa etapa a partir dos templates, atualiza o status no `us.md` e no kanban, faz commit e encerra.

Formato: `us.md` = história e critérios de aceite numerados (CA-N); `spec.md` = solução técnica, citando os CA que atende; `tasks.md` = passos pequenos e ordenados, cada um citando a seção da spec e como será verificado.

### 2. Aprovação
**As aprovações de US, Spec e Tasks são sempre do usuário, e nenhum subagente as dispensa.** Depois de cada etapa, a sessão apresenta um resumo e as perguntas ao usuário e **para**. A etapa seguinte só começa com aprovação explícita. Sem a aprovação das Tasks, o `fluxo:developer` não é acionado.

Subagentes não falam com o usuário. Quando o `architect` ou o `developer` encerra com `PERGUNTA:`, a sessão leva a pergunta ao usuário e retoma o **mesmo** agente (SendMessage) com a resposta. A sessão não responde por conta própria nem inventa regra de negócio.

### 3. Implementação
Ao acionar o `fluxo:developer`, a sessão grava o status `em-implementação` no `us.md` e no kanban. Ela informa a pasta do worktree, a branch e a pasta da demanda. Ele confere a pasta e a branch, escreve os testes em commit próprio, registra a falha e só então implementa, com um commit por task.

### 4. Revisão
A sessão aciona em paralelo, informando a pasta da demanda e a referência-base do diff (`origin/<branchPrincipal>`):
- o agente `fluxo:reviewer`;
- os agentes `code-reviewer`, `pr-test-analyzer` e `silent-failure-hunter`, do `pr-review-toolkit`, com o pedido de que só leiam e com o diff completo da branch (por padrão o `code-reviewer` olha só o que não foi preparado).

O `reviewer` não aciona o plugin: os agentes do plugin herdam as ferramentas de edição, e isso anularia o limite de leitura dele. Por isso, a sessão consolida os resultados e, ao final, confere com `git status --porcelain` que nenhum arquivo mudou. O `code-simplifier` fica de fora, pois é feito para editar código.

**O veredito é do `reviewer`.** Os achados do plugin são avaliados pela sessão: defeito real volta ao `developer`, e ruído é registrado e descartado.

### 5. Rodadas de correção
Reprovado o trabalho, a sessão devolve os achados ao `developer`, e depois os agentes revisam de novo. Cada ida e volta é uma rodada.

- **Plugin só no `code-reviewer`.** Nas rodadas de correção, roda apenas o `code-reviewer`, com o pedido de relatar só defeitos que afetem a entrega. O `reviewer` segue em toda rodada.
- **A sessão conta e registra as rodadas**, porque os subagentes não sabem quantas já houve.
- **Limite de 3 rodadas.** Se a terceira terminar reprovada, a sessão escala ao usuário, com os achados em aberto, e não aciona o `developer` de novo sem a decisão dele.

### 6. Entrega
Com o veredito `aprovado`, a sessão escreve o handoff em commit próprio (`<pastaHandoff>/SESSION-HANDOFF-AAAA-MM-DD-NNN.md`), a partir dos resultados entregues pelo `developer`, e grava o status `em-review` no `us.md` e no kanban. Confere por `git diff` que só documentação mudou desde o commit aprovado. Depois, faz o push, abre o PR (descrição em pt-BR, gravada em arquivo UTF-8 e passada com `--body-file`: resumo, CA atendidos, testes, o que falta testar manualmente) e reporta ao usuário o que foi feito, os riscos e as pendências. **O merge é do usuário.**

Depois do merge, a sessão reúne os dados e grava uma cópia preenchida de `flow-evaluation.md` na pasta da demanda, junto com o status `concluída`. O `developer` não a grava.

## Retomar uma demanda em outra sessão
Uma branch só pode estar em um worktree por vez. Quando a demanda passa de uma sessão para outra (as Tasks aprovadas numa sessão e a implementação noutra, por exemplo), a branch não pode ficar presa no worktree da sessão anterior.

- **Ao parar antes do fim:** a sessão da demanda que encerra o trabalho antes do PR (por exemplo, com as Tasks aprovadas e a implementação para depois) solta a branch. Ela confere que não há alteração pendente (`git status --porcelain` vazio e tudo commitado), roda `git switch --detach` no seu worktree e registra no kanban e no handoff onde a demanda parou e que a branch está livre.
- **Ao retomar:** a coordenação abre a sessão filha no worktree da demanda (`<pastaWorktrees>/NNN-slug`), se ele existir. Se a branch estiver presa noutro worktree, a coordenação só a solta se aquele worktree não tiver alteração pendente e se a sessão dele não estiver trabalhando; senão, pergunta ao usuário.

## Falha de um subagente
Falha é um agente que trava, encerra com erro ou entrega algo fora do formato obrigatório.

1. A sessão aciona o **mesmo** agente mais uma vez, com contexto limpo, a partir do que já foi commitado.
2. Se falhar de novo, a sessão escala ao usuário, que decide como seguir.

A sessão não assume o trabalho do agente por conta própria.

**Verificação enquanto o agente roda:** a cada 10 minutos, a sessão confere o estado do subagente, os commits e a transcrição, e encerra a verificação quando ele termina. Se o agente estiver concluído sem relatório, a sessão lê a última mensagem na transcrição: o relatório de um subagente retomado pode não chegar à sessão.

## Regras
- **A sessão principal só orquestra:** delega, leva as aprovações ao usuário, faz o push e abre o PR, sem escrever código, testes, US, Spec nem Tasks. Exceção: os registros do fluxo (handoff, status e `flow-evaluation.md`).
- **Um escopo por vez**, salvo pedido explícito de paralelismo.
- **Relatório não é prova:** a sessão confere o resultado no histórico, nos testes e no diff antes de reportar ao usuário.
- **Guarda negou:** o agente não tenta contornar, e informa o bloqueio. A decisão é do usuário.
- Sem force-push e sem merge na branch principal pelos agentes.
- **Testes automatizados são a fonte da verdade:** desenhar os testes antes do desenvolvimento, a partir dos CA-N da spec; o `developer` implementa até passarem; o `reviewer` verifica que nasceram da spec.
- Nunca colocar segredos, senhas, tokens ou dados pessoais em docs, commits ou PRs.
- Comentários de code review no PR (Copilot e outros): a sessão confere no código se procedem, propõe a resposta e só responde ou resolve no GitHub com o ok do usuário.

## Convenções
- Demanda: `NNN-slug`, com `NNN` sequencial de 3 dígitos (nunca reutilizado) e slug em kebab-case, sem acento.
- Branch: `feat/NNN-slug` (código) ou `docs/NNN-slug` (só documentação).
- Worktree: `<pastaWorktrees>/NNN-slug` (um por demanda; remover após o merge).
- Status (ciclo de vida): `us-em-revisão` → `us-aprovada` → `spec-em-revisão` → `spec-aprovada` → `tasks-em-revisão` → `tasks-aprovada` → `em-implementação` → `em-review` → `concluída` (ou `cancelada`). O status do `us.md` e a linha do kanban sempre coincidem.

## Requisitos de cada máquina
- **Plugins:** `fluxo@liane` e `pr-review-toolkit@claude-plugins-official`, habilitados no `.claude/settings.json` do projeto; cada máquina instala uma vez.
- **Node:** a guarda roda em Node. Sem ele, o hook falha sem bloquear.
- **Nova sessão:** agentes e hooks são lidos no início da sessão; depois de instalar ou atualizar o plugin, reinicie a sessão.

## Limites da guarda
- O Reviewer só define antes do comando as variáveis `DOTNET_ROOT`, `DOTNET_ROLL_FORWARD`, `DOTNET_NOLOGO`, `DOTNET_CLI_TELEMETRY_OPTOUT`, `CI`, `NO_COLOR` e `FORCE_COLOR`, com valor simples (caminho ou `$VAR`). As demais (como `PAGER`, `NODE_OPTIONS` e `GIT_*`) mudam o que roda e seguem negadas.
- Lê o texto do comando e nega o que foge da gramática simples que modela, mas não é uma análise completa de shell. Scripts e interpretadores (`node x.mjs`, `./x.sh`, `npm run`) não são inspecionados. Ela reduz erros; não é uma barreira de segurança completa.
- A restrição do `npx` do `reviewer` ("só o `tsc`") vale em parte por convenção.
- Pode negar comandos legítimos que não consegue analisar. O motivo vem na mensagem, e o agente reescreve o comando de forma simples.
- Vale só para os subagentes do fluxo. Sem proteção de branch no GitHub, nada no servidor impede um push direto.
