# NNN-slug — Avaliação do fluxo

Preencher ao final da demanda, para decidir o que manter ou ajustar no fluxo com subagentes, inclusive os modelos. Copie este arquivo para a pasta da demanda.

- **Demanda:** NNN-slug
- **PR:**
- **Preenchido por / data:**

## Rodadas de correção
Rodadas entre Developer e Reviewer, contadas pela sessão principal. O limite é 3.

| Rodada | Veredito | Motivo da reprovação |
|---|---|---|
| 1 | | |

**Total de rodadas:**
**Escalou ao usuário?** Sim ou não, e por quê.

## Defeitos encontrados
Um defeito por linha, antes do merge.

| Defeito | Origem (Reviewer, plugin ou usuário) | Severidade | Arquivo | Corrigido? |
|---|---|---|---|---|
| | | | | |

## Defeitos que passaram
Apareceram depois do merge, ou foram achados pelo usuário depois do veredito `aprovado`.

| Defeito | Onde apareceu | Quem deveria ter pego | Por que passou |
|---|---|---|---|
| | | | |

## Tokens por agente

| Agente | Modelo | Execuções | Tokens |
|---|---|---|---|
| `architect` | `opus` | | |
| `developer` | `sonnet` | | |
| `reviewer` | `opus` | | |
| `pr-review-toolkit:code-reviewer` | `opus` | | |
| `pr-review-toolkit:pr-test-analyzer` | Herda da sessão | | |
| `pr-review-toolkit:silent-failure-hunter` | Herda da sessão | | |
| Sessão principal | | | |

## Intervenções manuais
O que o usuário ou a sessão principal precisou fazer fora do fluxo.

| Intervenção | Motivo |
|---|---|
| | |

## Bloqueios da guarda

| Agente | Comando ou caminho | Correto? | Observação |
|---|---|---|---|
| | | | |

## Falhas de subagente

| Agente | O que aconteceu | Resolvido com contexto limpo? |
|---|---|---|
| | | |

## Decisão
- **Manter:**
- **Ajustar:**
- **Modelos:** manter Arquiteto `opus`, Developer `sonnet` e Reviewer `opus`, ou trocar? Por quê?
- **Plugin:** cada agente do plugin compensou o custo?
