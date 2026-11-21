---
name: publicar
description: Monta a publicação de um repositório no fluxo. Junta as notas de implantação pendentes e os commits desde a última tag de cada app num runbook único, propõe as versões, abre o PR do runbook e, depois do merge e com o ok do usuário, cria as tags <app>-vX.Y.Z e o GitHub Release com o runbook. Usar quando o usuário pedir para publicar, gerar release, criar tag, preparar deploy ou montar o runbook de uma versão.
---

# Publicar uma versão

Cada PR do fluxo deixa uma **nota de implantação** em `<pastaReleases>/pendentes/NNN-slug.md`. Esta skill junta as notas que ainda não saíram num **runbook da publicação**, para que o deploy de várias demandas juntas não dependa de caçar cada PR. Roda na **sessão de coordenação**, sem subagentes do fluxo.

**Tag e release são sempre com o ok explícito do usuário.** A skill propõe; o usuário confirma as versões, faz o merge do PR do runbook e autoriza as tags.

## Configuração
Do `.claude/fluxo.json` (veja `/fluxo:orquestrar`):

| Campo | Padrão | Uso |
|---|---|---|
| `branchPrincipal` | `main` | De onde sai a publicação |
| `pastaReleases` | `docs/releases` | `pendentes/` e uma pasta por publicação |
| `apps` | inferido | `{ "api": "apps/api", "web": "apps/web" }`: nome da app, que é o prefixo da tag, e a pasta dela |
| `templates` | `<pastaDemandas>/_template` | Onde está o `runbook-publicacao.md` |

Sem `apps`, infira: os prefixos das tags `<app>-vX.Y.Z` existentes (`git tag --list '*-v*'`) e as pastas `apps/<app>`. Mostre ao usuário o que inferiu e sugira gravar o campo.

O formato da tag é `<app>-vX.Y.Z`, o que o `publish.yml` da casa espera para gerar `ghcr.io/liane-alimentos/<slug>-<app>:X.Y.Z`. Se o repositório usar outro formato nas tags existentes, siga o dele e avise.

## 1. Preparar
1. `git fetch origin --tags` e confira que a `<branchPrincipal>` local não tem nada que não esteja na remota.
2. Crie a branch `release/AAAA-MM-DD` a partir de `origin/<branchPrincipal>`, com worktree em `<pastaWorktrees>/release-AAAA-MM-DD`, e trabalhe nele. Se já houver publicação no mesmo dia, use o sufixo `-2`.

## 2. Levantar o que sai
Para cada app:
1. **Última tag:** `git tag --list '<app>-v*' --sort=-v:refname`, a primeira da lista. Sem tag, é a primeira publicação da app, e a base é o início do histórico.
2. **Commits desde ela na pasta da app:** `git log --first-parent --format='%h %s' <tag>..origin/<branchPrincipal> -- <pasta>`. Sem commits, a app não tem o que publicar.
3. **PRs:** o número de cada merge (`Merge pull request #N` ou o `(#N)` do squash). Para commit sem PR, liste o commit.

Depois, as notas em `<pastaReleases>/pendentes/`. Leia o cabeçalho de cada uma (Demanda, Branch, Apps, Mudança, Migration, Compatível com a versão anterior, Variáveis de ambiente, Outros) e cruze com os PRs. O PR de uma nota é o da branch dela: `gh pr list --head <branch> --state merged --json number,mergeCommit`.
- **PR com nota:** entra pela nota.
- **PR sem nota** (anterior às notas ou feito fora do fluxo): leia a seção "Implantação e riscos" do corpo do PR (`gh pr view N --json body`) e resuma no runbook, em "Sem nota de implantação", com o link. Não invente passo: se o PR não diz nada, escreva "o PR não traz instruções de implantação".
- **Nota sem commit na faixa** (o PR ainda não entrou na `<branchPrincipal>`, ou a nota é de outra app): fica em `pendentes/`.

## 3. Propor as versões
Por app, a partir da maior mudança que sai nela:
- **quebra** (ou `!`/`BREAKING CHANGE` no commit) → major;
- **funcionalidade** (ou `feat`) → minor;
- **correção** (ou `fix`, e o resto) → patch.

A mudança vem da nota; sem nota, do Conventional Commit. Na primeira publicação de uma app, proponha `1.0.0`.

Apresente ao usuário, em uma tabela: app, versão anterior, versão proposta, PRs que entram, migrations e o que não tem nota. **Pare e espere** a confirmação das versões e de quais apps saem. Uma app pode ficar de fora: as notas dela seguem em `pendentes/`. Uma nota de várias apps só sai de `pendentes/` quando todas as apps dela saírem; se só parte sair, copie o trecho para o runbook e deixe a nota.

## 4. Escrever o runbook
1. Crie `<pastaReleases>/AAAA-MM-DD-<app>-<versão>[-<app>-<versão>…]/` e mova as notas que saem para lá com `git mv`.
2. Escreva `runbook.md` a partir do template `runbook-publicacao.md`, juntando as notas sem repetir passo:
   - **Nota:** na tabela "O que sai", troque o nome do arquivo por um link para a nota, que agora está na mesma pasta (`[nota](NNN-slug.md)`). O template traz só o nome, para não ter link quebrado no `_template/`.
   - **Ordem das apps:** uma app que não é compatível com a versão anterior de outra sai depois dela (a nota diz qual). Sem restrição, api antes de web, e o etl por último. Explique a ordem em uma linha por app.
   - **Migrations:** na ordem das demandas (o `NNN`), com o backup antes se houver qualquer uma.
   - **Variáveis de ambiente:** só os nomes, nunca os valores.
   - **Como voltar:** na ordem inversa do deploy, apontando as tags anteriores.
   - **Proibições:** a soma de todas as notas.
   - Passo que só uma nota traz continua citando a demanda de origem.
3. No kanban, a célula "Branch / PR" de cada demanda que sai ganha a tag, ex.: `#46 · api-v1.0.3`.
4. Commit (`docs(release): publicação AAAA-MM-DD`), push e PR com o runbook no corpo (`--body-file`, UTF-8), em pt-BR. **O merge é do usuário.**

## 5. Tags e release
Só depois do merge do PR do runbook e com o ok do usuário:
1. `git fetch origin --tags`. Ache o commit de merge do PR do runbook (`gh pr view N --json mergeCommit`).
2. Confira que nenhum commit de app entrou na `<branchPrincipal>` entre o início do passo 2 e esse merge (`git log <commit do início>..<merge> -- <pastas das apps>`). Se entrou, a tag levaria esse commit sem que ele esteja no runbook: pare e avise o usuário. Ou ele entra, e o runbook é atualizado num PR antes das tags (refaça a partir do passo 2), ou a publicação espera.
3. Crie uma tag anotada por app nesse commit (`git tag -a <app>-vX.Y.Z -m "Publicação AAAA-MM-DD" <merge>`) e faça o push só dessas tags (`git push origin <tag> <tag>`). O push dispara o `publish.yml`, que gera as imagens.
4. Crie um GitHub Release por tag com o runbook: `gh release create <tag> --title "<app> X.Y.Z" --notes-file <pastaReleases>/<pasta>/runbook.md`.
5. Reporte ao usuário as tags, os releases, o link do runbook e o andamento do `publish.yml` (`gh run list --workflow publish.yml --limit 5`). O deploy no servidor é do responsável, seguindo o runbook.

## Regras
- Nunca crie, mova nem apague tag sem o ok do usuário, e nunca force o push de tag.
- Não edite as notas de implantação além de movê-las; correção numa nota é um PR próprio, ou um ajuste no runbook citando a nota.
- Nunca coloque segredos, senhas, tokens ou dados pessoais no runbook, nas notas, nos commits ou no release.
- O runbook descreve; nenhum agente executa deploy, migration ou backup.
