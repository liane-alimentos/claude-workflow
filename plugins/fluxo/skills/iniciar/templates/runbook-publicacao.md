# Publicação AAAA-MM-DD — <app> <versão>, <app> <versão>

Runbook gerado pelo `/fluxo:publicar`. O responsável executa um passo por vez; nenhum agente roda nada disto.

## Versões
| App | Versão anterior | Nova versão | Imagem |
|---|---|---|---|
| api | `api-v1.0.2` | `api-v1.0.3` | `ghcr.io/liane-alimentos/<slug>-api:1.0.3` |

## O que sai
| Demanda | PR | Apps | Mudança | Migration | Nota |
|---|---|---|---|---|---|
| NNN-slug | #N | api | correção | não | [nota](NNN-slug.md) |

**Sem nota de implantação:** commits que entram nesta publicação sem nota (PRs anteriores ao fluxo de notas ou feitos fora dele), com o resumo da seção "Implantação e riscos" de cada PR, ou "nenhum".

## 1. Antes do deploy
Pré-checagens de todas as notas, sem repetição. Só leitura.

## 2. Backup
Só se houver migration: o que copiar e onde. Senão, "não se aplica".

## 3. Migrations
Na ordem em que devem rodar, com a demanda de origem. Senão, "nenhuma".

## 4. Variáveis de ambiente
| App | Variável | Novo ou alterado | Demanda |
|---|---|---|---|

## 5. Deploy, na ordem
1. **<app> <versão>**: o passo, e por que esta app sai primeiro (compatibilidade).
2. …

## 6. Depois do deploy
Checagens de todas as notas, por app.

## 7. Como voltar
Por app, na ordem inversa do deploy: voltar a imagem para a tag anterior e o que fazer com as migrations.

## Proibições
Somadas de todas as notas.
