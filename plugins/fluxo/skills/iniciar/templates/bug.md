# NNN-slug — Título da correção

- **Status:** diagnóstico-em-revisão | diagnóstico-aprovado | em-implementação | em-review | concluída
- **Tipo:** correção
- **Trivial:** sim | não
- **Branch:** `fix/NNN-slug`
- **Worktree:** `../worktrees/NNN-slug`
- **Solicitante / data:** <quem, AAAA-MM-DD>

## Relato
O que o usuário viu, com as palavras dele. Onde (tela, endpoint, job), desde quando e o impacto.

## Como reproduzir
1. …
2. …

## Esperado × atual
- **Esperado:** … (cite a regra, a spec ou a doc que define o comportamento certo)
- **Atual:** …

## Causa raiz
Onde o defeito está (`arquivo:linha`) e por que acontece. Se não foi possível confirmar, diga o que falta.

## Correção proposta
A menor mudança que resolve a causa raiz. Arquivos afetados e o que muda em cada um.

## Critérios de aceite
- **CA-1:** seguindo os passos de "Como reproduzir", o resultado é o esperado.
- **CA-2:** … (não-regressão: o comportamento vizinho que não pode mudar)

## Tasks
**Teste primeiro:** a primeira task escreve o teste que reproduz o bug (deve falhar pela causa raiz); as seguintes corrigem até passar.

| # | Task | Spec | Verificação | Status |
|---|---|---|---|---|
| 1 | Teste que reproduz o bug (CA-1, CA-2) | §Como reproduzir | falha antes da correção, pela causa raiz | ☐ |
| 2 | Corrigir … | §Correção proposta | teste 1 passa (<comando de teste>) | ☐ |

## Fora de escopo
- …

## Perguntas em aberto
- …
