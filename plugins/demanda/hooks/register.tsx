import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Aba, Contexto, Demanda, Task } from '../types'

const PANE = 'demanda'
const PASTA_PADRAO = 'docs/development'
/** Releitura periódica dos arquivos da demanda (o Arquiteto e o Developer os mudam). */
const RELER_MS = 20_000

const atual = atom({ plugin: 'demanda', key: 'atual' } as const, null as Demanda | null, {
  shape: 'atual-3',
})
const contexto = atom(
  { plugin: 'demanda', key: 'contexto' } as const,
  { raiz: null, pastaDemandas: null, branch: '', disponiveis: [] } as Contexto,
  { shape: 'contexto-1' },
)
const aba = atom({ plugin: 'demanda', key: 'aba' } as const, 'us' as Aba)
const abertas = atom({ plugin: 'demanda', key: 'abertas' } as const, [] as string[])

/** Branch de demanda do fluxo: feat/NNN-slug, docs/NNN-slug ou fix/NNN-slug. */
const BRANCH = /^(?:feat|docs|fix)\/(\d{3}[a-z]?-[a-z0-9][a-z0-9-]*)$/
/** Um us.md, spec.md, tasks.md ou bug.md dentro da pasta NNN-slug de uma demanda. */
const ARQUIVO = /^(.*\/(\d{3}[a-z]?-[a-z0-9][a-z0-9-]*))\/(?:us|spec|tasks|bug)\.md$/i

const ETAPAS = ['US', 'Spec', 'Tasks', 'Implementação', 'Review', 'Concluída'] as const
const ETAPAS_CORRECAO = ['Diagnóstico', 'Implementação', 'Review', 'Concluída'] as const

/** Etapa corrente e se ela aguarda a aprovação do usuário, a partir do status do us.md (ou do bug.md). */
export function etapa(
  status: string,
  tipo: Demanda['tipo'] = 'funcionalidade',
): { i: number; aguardando: boolean; cancelada: boolean } {
  const s = semAcento(status)
  if (s.includes('cancelad')) return { i: -1, aguardando: false, cancelada: true }
  const tabela: [string, number, boolean][] = tipo === 'correcao' ? [
    ['diagnostico-em-revisao', 0, true],
    ['diagnostico-aprovado', 1, false],
    ['em-implementacao', 1, false],
    ['em-review', 2, false],
    ['concluida', 4, false],
  ] : [
    ['us-em-revisao', 0, true],
    ['us-aprovada', 1, false],
    ['spec-em-revisao', 1, true],
    ['spec-aprovada', 2, false],
    ['tasks-em-revisao', 2, true],
    ['tasks-aprovada', 3, false],
    ['em-implementacao', 3, false],
    ['em-review', 4, false],
    ['concluida', 6, false],
  ]
  const achou = tabela.find(([k]) => s.includes(k))
  return achou ? { i: achou[1], aguardando: achou[2], cancelada: false } : { i: 0, aguardando: false, cancelada: false }
}

export function semAcento(t: string) {
  return t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

export function norm(p: string) {
  return p.replace(/\\/g, '/').replace(/\/+$/, '')
}

/** Título, status e branch do cabeçalho do us.md. */
export function cabecalho(us: string | null) {
  const texto = us ?? ''
  const h1 = /^#\s+(.+)$/m.exec(texto)?.[1]?.trim() ?? ''
  const titulo = h1.includes('—') ? h1.split('—').slice(1).join('—').trim() : h1
  let status = /\*\*Status:\*\*\s*(.+)/.exec(texto)?.[1]?.trim() ?? ''
  status = status.replace(/`/g, '').trim()
  // O template lista todos os status separados por "|": ainda não foi preenchido.
  if (status.includes('|')) status = ''
  const branch = /\*\*Branch:\*\*\s*`?([^`\n]+?)`?\s*$/m.exec(texto)?.[1]?.trim() ?? ''
  return { titulo, status, branch }
}

function estado(celula: string): Task['estado'] {
  const c = semAcento(celula)
  if (/☑|✅|✔|✓|\[x\]|feit|conclu|\bok\b|done/.test(c)) return 'feita'
  if (/◐|🔄|⏳|andamento|em curso|wip|fazendo/.test(c)) return 'andamento'
  return 'pendente'
}

/** Uma célula de tabela em markdown de bloco: `<br>` vira quebra de linha. */
export function celulaMd(c: string) {
  return c
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\\\|/g, '|')
    .split('\n')
    .map(l => l.trim())
    .join('\n')
    .trim()
}

/** Texto de uma linha sem a marcação de markdown (para títulos curtos). */
export function semMarcacao(t: string) {
  return t
    .replace(/\*\*|__|`/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .trim()
}

/** As linhas da tabela de tasks (colunas #, Task, Spec, Verificação, Status). */
export function lerTasks(md: string | null): Task[] {
  if (!md) return []
  const linhas = md.split(/\r?\n/).filter(l => l.trim().startsWith('|'))
  const celulas = (l: string) =>
    l
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map(c => c.trim())
  const iCab = linhas.findIndex(l => celulas(l).some(c => semAcento(c) === 'task'))
  if (iCab < 0) return []
  const cab = celulas(linhas[iCab]!).map(semAcento)
  const col = (nome: string) => cab.findIndex(c => c.startsWith(nome))
  const [cN, cT, cS, cV, cE] = [col('#'), col('task'), col('spec'), col('verifica'), col('status')]
  const out: Task[] = []
  for (const l of linhas.slice(iCab + 1)) {
    const c = celulas(l)
    if (c.every(x => /^:?-{2,}:?$/.test(x) || x === '')) continue
    const pega = (i: number) => (i >= 0 ? (c[i] ?? '') : '')
    const texto = celulaMd(pega(cT))
    if (!texto) continue
    const [primeira = '', ...resto] = texto.split('\n')
    out.push({
      n: pega(cN) || String(out.length + 1),
      titulo: semMarcacao(primeira),
      detalhe: resto.join('\n').trim(),
      spec: celulaMd(pega(cS)),
      verificacao: celulaMd(pega(cV)),
      estado: estado(pega(cE)),
    })
  }
  return out
}

export const register: Register = on => {
  let ops: {
    detectar: () => void
    carregar: (dir: string, origem: Demanda['origem']) => void
    reler: () => void
  } | null = null

  on('session.start', async ($, e, next) => {
    const ran = await next(e)

    async function git(cwd: string, args: string[]) {
      try {
        const r = await $.process.run(['git', ...args], { cwd, timeoutMs: 15_000 })
        return r.exitCode === 0 ? r.stdout.trim() : ''
      } catch {
        return ''
      }
    }
    async function ler(path: string) {
      try {
        return (await $.fs.exists(path)) ? await $.fs.read(path) : null
      } catch {
        return null
      }
    }

    async function carregar(dir: string, origem: Demanda['origem'], abrir = true) {
      const [us = null, spec = null, tasks = null, bug = null] = await Promise.all(
        ['us', 'spec', 'tasks', 'bug'].map(f => ler(`${dir}/${f}.md`)),
      )
      if (us === null && spec === null && tasks === null && bug === null) return
      // Correção: só o bug.md, com o cabeçalho e as tasks dele. Se a correção virou funcionalidade, vale o us.md.
      const tipo: Demanda['tipo'] = bug !== null && us === null ? 'correcao' : 'funcionalidade'
      const cab = cabecalho(tipo === 'correcao' ? bug : us)
      const lista = lerTasks(tipo === 'correcao' ? bug : tasks)
      const antes = await read($, atual)
      const d: Demanda = {
        dir,
        id: dir.split('/').pop() ?? dir,
        origem,
        tipo,
        titulo: cab.titulo,
        status: cab.status,
        branch: cab.branch,
        us,
        spec,
        tasks,
        bug,
        lista,
        lidoEm: await $.clock.now(),
      }
      await update($, atual, () => d)
      const feitas = lista.filter(t => t.estado === 'feita').length
      $.ui.status(`📋 ${d.id}${d.status ? ` · ${d.status}` : ''}${lista.length ? ` · tasks ${feitas}/${lista.length}` : ''}`)
      if (abrir && antes?.dir !== dir) {
        // Abre na aba da etapa em andamento.
        const et = etapa(d.status, tipo)
        const abaInicial: Aba =
          tipo === 'correcao'
            ? et.i >= 1 && lista.length ? 'tasks' : 'bug'
            : et.i >= 2 && tasks ? 'tasks' : et.i >= 1 && spec ? 'spec' : 'us'
        await update($, aba, () => abaInicial)
        void $.ui.open({ id: PANE, title: 'Demanda' })
      }
    }

    async function detectar() {
      const cwd = norm(await $.session.cwd())
      const raiz = norm((await git(cwd, ['rev-parse', '--show-toplevel'])) || cwd)
      let pasta: string | null = null
      const cfg = await ler(`${raiz}/.claude/fluxo.json`)
      if (cfg !== null) {
        try {
          const j = JSON.parse(cfg) as { pastaDemandas?: unknown }
          pasta = norm(typeof j.pastaDemandas === 'string' && j.pastaDemandas ? j.pastaDemandas : PASTA_PADRAO)
        } catch {
          pasta = PASTA_PADRAO
        }
      }
      const branch = await git(raiz, ['branch', '--show-current'])
      const base = pasta ? (/^([a-z]:)?\//i.test(pasta) ? pasta : `${raiz}/${pasta}`) : null
      let disponiveis: string[] = []
      if (base) {
        try {
          disponiveis = (await $.fs.list(base))
            .filter(x => x.kind === 'dir' && /^\d{3}[a-z]?-/.test(x.name))
            .map(x => x.name)
            .sort()
            .reverse()
        } catch {
          disponiveis = []
        }
      }
      await update($, contexto, () => ({ raiz: pasta ? raiz : null, pastaDemandas: base, branch, disponiveis }))
      const m = BRANCH.exec(branch)
      if (m && base && (await $.fs.exists(`${base}/${m[1]}`))) await carregar(`${base}/${m[1]}`, 'branch')
    }

    async function reler() {
      const d = await read($, atual)
      if (d) await carregar(d.dir, d.origem, false)
    }

    const depois = (fn: () => Promise<void>) => void $.clock.after(0, () => void fn())
    ops = {
      detectar: () => depois(detectar),
      carregar: (dir, origem) => depois(() => carregar(dir, origem)),
      reler: () => depois(reler),
    }

    await $.command.register({
      name: 'demanda',
      description: 'Painel com a US, a Spec e as Tasks (ou o diagnóstico da correção) da demanda desta sessão',
    })
    $.clock.after(500, () => void detectar())
    $.clock.every(RELER_MS, () => void reler())
    return ran
  })

  on('command.run', { command: 'demanda' }, async $ => {
    ops?.detectar()
    await $.ui.open({ id: PANE, title: 'Demanda' })
    const d = await read($, atual)
    return { text: d ? `Painel da demanda ${d.id} aberto.` : 'Painel de demanda aberto.' }
  })

  // Os arquivos que a sessão (ou um subagente dela) lê ou escreve dizem em que demanda ela está.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    try {
      const fp = (e as { file_path?: unknown }).file_path
      const caminho = typeof fp === 'string' ? norm(fp) : ''
      const m = caminho ? ARQUIVO.exec(caminho) : null
      if (m && !/\/_template$/i.test(m[1]!)) {
        const d = await read($, atual)
        if (!d || d.dir === m[1] || d.origem === 'arquivo') {
          ops?.carregar(m[1]!, d && d.dir === m[1] ? d.origem : 'arquivo')
        }
      } else if (e.tool === 'Bash') {
        // git switch, commits e afins podem trocar a branch ou os arquivos.
        const d = await read($, atual)
        if (d) ops?.reler()
        else ops?.detectar()
      }
    } catch {
      // O painel nunca atrapalha a chamada da ferramenta.
    }
    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button, Markdown } = ui
    // Nem todo host tem o Progress; sem ele, uma barra de texto.
    const Progress = 'Progress' in ui ? (ui.Progress as typeof ui.Progress | undefined) : undefined
    const d = await read($, atual)
    const ctx = await read($, contexto)
    const abaAtual = await read($, aba)
    const abertasAgora = await read($, abertas)
    const isTerminal = e.surface === 'terminal'

    if (!d) {
      return (
        <Box flexDirection="column" gap={1} paddingX={1}>
          <Text size="title" weight="bold" bold>Demanda</Text>
          {ctx.pastaDemandas === null ? (
            <Text dimColor>
              Este repositório não está no fluxo (sem .claude/fluxo.json). O painel mostra a demanda quando a sessão
              trabalha numa branch feat/NNN-slug ou fix/NNN-slug, ou lê os arquivos us.md, spec.md, tasks.md ou bug.md de uma demanda.
            </Text>
          ) : (
            <Text dimColor>
              {`Nenhuma demanda detectada nesta sessão (branch ${ctx.branch || 'desconhecida'}). Ela aparece sozinha quando a sessão estiver numa branch feat/NNN-slug ou fix/NNN-slug, ou tocar os arquivos de uma demanda.`}
            </Text>
          )}
          {ctx.disponiveis.length > 0 && (
            <Box flexDirection="column" gap={1}>
              <Text weight="semibold" bold>Ou escolha uma demanda:</Text>
              <Box flexDirection="row" gap={1} flexWrap="wrap">
                {ctx.disponiveis.slice(0, 30).map(id => (
                  <Button key={`pick:${id}`} onPress={() => ops?.carregar(`${ctx.pastaDemandas}/${id}`, 'escolha')}>
                    {id}
                  </Button>
                ))}
              </Box>
            </Box>
          )}
          <Box flexDirection="row">
            <Button key="detectar" hotkey="r" onPress={() => ops?.detectar()}>Detectar de novo</Button>
          </Box>
        </Box>
      )
    }

    const correcao = d.tipo === 'correcao'
    const et = etapa(d.status, d.tipo)
    const etapas: readonly string[] = correcao ? ETAPAS_CORRECAO : ETAPAS
    const feitas = d.lista.filter(t => t.estado === 'feita').length
    const andamento = d.lista.filter(t => t.estado === 'andamento').length
    // A task da vez: a primeira em andamento, senão a primeira pendente.
    const atualN = (d.lista.find(t => t.estado === 'andamento') ?? d.lista.find(t => t.estado === 'pendente'))?.n
    // A aba guardada pode ser de outro tipo de demanda: US e Spec não existem numa correção, nem Bug numa funcionalidade.
    const abaVista: Aba = correcao ? (abaAtual === 'tasks' ? 'tasks' : 'bug') : abaAtual === 'bug' ? 'us' : abaAtual
    const texto = correcao
      ? d.bug
      : abaVista === 'us' ? d.us : abaVista === 'spec' ? d.spec : d.tasks
    const nomeArquivo = correcao ? 'bug.md' : `${abaVista}.md`
    const rotuloTasks = d.lista.length ? `Tasks ${feitas}/${d.lista.length}` : 'Tasks'
    const abas: { id: Aba; label: string; existe: boolean }[] = correcao
      ? [
          { id: 'bug', label: 'Diagnóstico', existe: d.bug !== null },
          { id: 'tasks', label: rotuloTasks, existe: d.lista.length > 0 },
        ]
      : [
          { id: 'us', label: 'US', existe: d.us !== null },
          { id: 'spec', label: 'Spec', existe: d.spec !== null },
          { id: 'tasks', label: rotuloTasks, existe: d.tasks !== null },
        ]
    const ORIGEM: Record<Demanda['origem'], string> = {
      branch: 'pela branch',
      arquivo: 'pelos arquivos tocados na sessão',
      escolha: 'escolhida no painel',
    }

    return (
      <Box flexDirection="column" gap={1} paddingX={1}>
        <Box flexDirection="column">
          <Text dimColor size="caption">{`${d.id} · ${ORIGEM[d.origem]}${d.branch ? ` · ⎇ ${d.branch}` : ''}`}</Text>
          <Text size="title" weight="bold" bold>{d.titulo || d.id}</Text>
        </Box>

        {/* Linha das etapas do fluxo */}
        <Box flexDirection="row" gap={1} flexWrap="wrap" alignItems="center">
          {et.cancelada ? (
            <Text backgroundColor="error" color="inverseText" bold size="caption">{' cancelada '}</Text>
          ) : (
            etapas.map((nome, i) => {
              const feita = i < et.i || et.i >= etapas.length
              const corrente = i === et.i
              return (
                <Text
                  backgroundColor={feita ? 'success' : corrente ? (et.aguardando ? 'warning' : 'claude') : undefined}
                  color={feita || corrente ? 'inverseText' : undefined}
                  dimColor={!feita && !corrente}
                  bold={corrente}
                  size="caption"
                >
                  {` ${feita ? '✓' : corrente ? '●' : '○'} ${nome} `}
                </Text>
              )
            })
          )}
        </Box>
        <Text dimColor size="footnote">
          {`Status: ${d.status || 'não preenchido'}${et.aguardando ? ' — aguardando a sua aprovação' : ''}`}
        </Text>

        {d.lista.length > 0 &&
          (Progress ? (
            <Progress
              label="Tasks concluídas"
              value={feitas}
              max={d.lista.length}
              valueText={`${feitas} de ${d.lista.length}${andamento ? ` · ${andamento} em andamento` : ''}`}
              color="success"
            />
          ) : (
            <Box flexDirection="row" gap={1}>
              <Text color="success">{'█'.repeat(Math.round((feitas / d.lista.length) * 20))}</Text>
              <Text dimColor>{'░'.repeat(20 - Math.round((feitas / d.lista.length) * 20))}</Text>
              <Text dimColor tabular>{`${feitas} de ${d.lista.length} tasks${andamento ? ` · ${andamento} em andamento` : ''}`}</Text>
            </Box>
          ))}

        <Box flexDirection="row" gap={1} flexWrap="wrap" alignItems="center">
          {abas.map((a, i) => (
            <Button
              key={`aba:${a.id}`}
              hotkey={String(i + 1)}
              variant={abaVista === a.id ? 'primary' : 'secondary'}
              dimColor={!a.existe}
              onPress={() => update($, aba, () => a.id)}
            >
              {a.label}
            </Button>
          ))}
          <Button key="reler" hotkey="r" plain onPress={() => ops?.reler()}>
            <Text dimColor>⟳ Atualizar</Text>
          </Button>
        </Box>

        {texto === null ? (
          <Text dimColor>{`${nomeArquivo} ainda não foi escrito.`}</Text>
        ) : abaVista === 'tasks' && d.lista.length > 0 ? (
          <Box flexDirection="column">
            <Box flexDirection="row" justifyContent="flex-end">
              <Button
                key="tasks:todas"
                plain
                onPress={() =>
                  update($, abertas, cur => (cur.length > 0 ? [] : d.lista.map(t => t.n)))
                }
              >
                <Text dimColor size="caption">{abertasAgora.length > 0 ? 'Recolher todas' : 'Expandir todas'}</Text>
              </Button>
            </Box>
            {d.lista.map(t => {
              const aberta = abertasAgora.includes(t.n)
              const ehAtual = t.n === atualN
              const cor = t.estado === 'feita' ? 'success' : t.estado === 'andamento' ? 'warning' : ehAtual ? 'claude' : undefined
              const corpo = [
                t.detalhe,
                t.spec && `**Spec:** ${t.spec}`,
                t.verificacao && `**Verificação:** ${t.verificacao}`,
              ]
                .filter(Boolean)
                .join('\n\n')
              return (
                <Box flexDirection="column" paddingY={0}>
                  <Box flexDirection="row" gap={1}>
                    <Text color={cor} bold>
                      {t.estado === 'feita' ? '☑' : t.estado === 'andamento' ? '◐' : '☐'}
                    </Text>
                    <Text bold dimColor={t.estado === 'feita'} tabular>{`${t.n.padStart(2, ' ')}.`}</Text>
                    <Button
                      key={`task:${t.n}`}
                      plain
                      onPress={() =>
                        update($, abertas, cur => (cur.includes(t.n) ? cur.filter(x => x !== t.n) : [...cur, t.n]))
                      }
                    >
                      <Text dimColor={t.estado === 'feita'} bold={ehAtual} color={ehAtual ? cor : undefined}>
                        {t.titulo || '(sem título)'}
                      </Text>
                      {corpo ? <Text dimColor>{aberta ? '  ▾' : '  ▸'}</Text> : null}
                    </Button>
                  </Box>
                  {aberta && corpo && (
                    <Box paddingLeft={5} marginBottom={1}>
                      {isTerminal ? <Text dimColor>{corpo}</Text> : <Markdown text={corpo} />}
                    </Box>
                  )}
                </Box>
              )
            })}
          </Box>
        ) : isTerminal ? (
          <Text>{texto}</Text>
        ) : (
          <Markdown text={texto} />
        )}
      </Box>
    )
  })
}
