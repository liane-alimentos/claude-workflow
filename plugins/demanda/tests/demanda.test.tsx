import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { cabecalho, etapa, lerTasks } from '../hooks/register'

const RAIZ = 'C:/repo'
const DIR = `${RAIZ}/docs/demandas/007-painel-pedidos`

const US = `# 007-painel-pedidos — Painel de pedidos

- **Status:** tasks-aprovada
- **Branch:** \`feat/007-painel-pedidos\`

## História
Como vendedor, quero ver os pedidos, para acompanhar a entrega.

## Critérios de aceite
- **CA-1:** lista os pedidos do dia
`

const TASKS = `# 007-painel-pedidos — Tasks

| # | Task | Spec | Verificação | Status |
|---|---|---|---|---|
| 1 | Testes da lista (CA-1) | §Estratégia | falham antes | ☑ |
| 2 | Implementar a lista | §Mudanças › Backend | teste 1 passa | ◐ |
| 3 | Catálogo do **Pype**.<br>Criar \`src/pype.ts\`:<br>• os passos | §Mudanças › Catálogo | \`pype.test.ts\` passa<br>salvo o caso 4 | ☐ |
`

const PANE = {
  plugin: 'demanda',
  component: 'Pane',
  requestId: 'demanda',
  props: {
    title: 'Demanda',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

/** O engine entrega os caminhos com barras invertidas no Windows. */
const p = (s: string) => s.replace(/\\/g, '/')

/** Um repositório no fluxo, na branch da demanda 007. */
function mundo(on: On, branch = 'feat/007-painel-pedidos') {
  const files: Record<string, string> = {
    [`${RAIZ}/.claude/fluxo.json`]: '{ "pastaDemandas": "docs/demandas" }',
    [`${DIR}/us.md`]: US,
    [`${DIR}/tasks.md`]: TASKS,
  }
  const dirs = new Set([DIR])
  on('session.cwd', () => ({ value: RAIZ }))
  on('process.run', (_, e) => {
    const args = e.argv.join(' ')
    const stdout = args.includes('show-toplevel') ? RAIZ : args.includes('show-current') ? branch : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.exists', (_, e) => ({ value: p(e.path) in files || dirs.has(p(e.path)) }))
  on('fs.read', (_, e) => {
    const t = files[p(e.path)]
    if (t === undefined) throw new Error('ENOENT')
    return { value: t }
  })
  on('fs.list', () => ({
    value: [{ name: '007-painel-pedidos', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }],
  }))
  on('command.register', () => ({ value: { command: 'demanda' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
  return files
}

test('lê o cabeçalho, a etapa e as tasks', () => {
  expect(cabecalho(US)).toEqual({ titulo: 'Painel de pedidos', status: 'tasks-aprovada', branch: 'feat/007-painel-pedidos' })
  expect(cabecalho('- **Status:** us-em-revisão | us-aprovada').status).toBe('')
  expect(etapa('spec-em-revisão')).toEqual({ i: 1, aguardando: true, cancelada: false })
  expect(etapa('em-implementação').i).toBe(3)
  expect(etapa('concluída').i).toBe(6)
  const t = lerTasks(TASKS)
  expect(t.map(x => x.estado)).toEqual(['feita', 'andamento', 'pendente'])
  expect(t[1]?.spec).toBe('§Mudanças › Backend')
  expect(t[2]?.titulo).toBe('Catálogo do Pype.')
  expect(t[2]?.detalhe).toBe('Criar `src/pype.ts`:\n• os passos')
  expect(t[2]?.verificacao).toBe('`pype.test.ts` passa\nsalvo o caso 4')
})

test('acha a demanda pela branch e mostra as tasks, em todo surface', async ($, on) => {
  const clock = mock.clock(on)
  mundo(on)
  await $.session.start({ cwd: RAIZ, surface: 'desktop', isInteractive: true })
  await clock.advance(1000)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /^Painel de pedidos$/ }))?.text).toBe('Painel de pedidos')
    expect(await ui.find({ type: 'Text', text: /Implementar a lista/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /Status: tasks-aprovada/ })).toBeTruthy()
    expect(JSON.stringify(await ui.drawn())).toContain('"US"')
    // Abriu na aba das tasks; a aba US mostra o us.md.
    await ui.press({ key: 'aba:us' })
    expect(await ui.find({ type: 'Text', text: /Implementar a lista/ })).toBeFalsy()
    await ui.press({ key: 'aba:tasks' })
    // A task 3 mostra só o título; o detalhe abre ao clicar nela.
    expect(await ui.find({ type: 'Text', text: /^Catálogo do Pype.$/ })).toBeTruthy()
    expect(JSON.stringify(await ui.drawn())).not.toContain('src/pype.ts')
    await ui.press({ key: 'task:3' })
    expect(JSON.stringify(await ui.drawn())).toContain('src/pype.ts')
    await ui.press({ key: 'task:3' })
    await ui.unmount()
  }
})

test('fora de uma branch de demanda, acha a demanda pelo arquivo que a sessão lê', async ($, on) => {
  const clock = mock.clock(on)
  mundo(on, 'main')
  await $.session.start({ cwd: RAIZ, surface: 'desktop', isInteractive: true })
  await clock.advance(1000)

  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Nenhuma demanda detectada/ })).toBeTruthy()
  await ui.unmount()

  await $.tool.call({ tool: 'Read', file_path: `${DIR.replace(/\//g, '\\')}\\us.md` })
  await clock.advance(10)

  ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /pelos arquivos tocados/ })).toBeTruthy()
  await ui.unmount()
})

const BUG = `# 007-painel-pedidos — Total do pedido errado

- **Status:** diagnóstico-em-revisão
- **Tipo:** correção
- **Trivial:** não
- **Branch:** \`fix/007-painel-pedidos\`

## Causa raiz
O desconto é aplicado duas vezes em \`src/total.ts:42\`.

## Tasks
| # | Task | Spec | Verificação | Status |
|---|---|---|---|---|
| 1 | Teste que reproduz o bug (CA-1) | §Como reproduzir | falha antes da correção | ☑ |
| 2 | Corrigir o desconto | §Correção proposta | teste 1 passa | ☐ |
`

test('etapas da correção', () => {
  expect(cabecalho(BUG)).toEqual({ titulo: 'Total do pedido errado', status: 'diagnóstico-em-revisão', branch: 'fix/007-painel-pedidos' })
  expect(cabecalho('- **Status:** diagnóstico-em-revisão | diagnóstico-aprovado').status).toBe('')
  expect(etapa('diagnóstico-em-revisão', 'correcao')).toEqual({ i: 0, aguardando: true, cancelada: false })
  expect(etapa('diagnóstico-aprovado', 'correcao')).toEqual({ i: 1, aguardando: false, cancelada: false })
  expect(etapa('em-review', 'correcao').i).toBe(2)
  expect(etapa('concluída', 'correcao').i).toBe(4)
  expect(etapa('cancelada', 'correcao').cancelada).toBe(true)
  expect(lerTasks(BUG).map(t => t.estado)).toEqual(['feita', 'pendente'])
})

test('correção: acha pela branch fix/ e mostra o diagnóstico e as tasks do bug.md', async ($, on) => {
  const clock = mock.clock(on)
  const files = mundo(on, 'fix/007-painel-pedidos')
  delete files[`${DIR}/us.md`]
  delete files[`${DIR}/tasks.md`]
  files[`${DIR}/bug.md`] = BUG
  await $.session.start({ cwd: RAIZ, surface: 'desktop', isInteractive: true })
  await clock.advance(1000)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /^Total do pedido errado$/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /Diagnóstico/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /aguardando a sua aprovação/ })).toBeTruthy()
    // Sem US nem Spec numa correção.
    expect(await ui.find({ type: 'Text', text: /^US$/ })).toBeFalsy()
    expect(await ui.find({ type: "Text", text: /^Spec$/ })).toBeFalsy()
    expect(JSON.stringify(await ui.drawn())).toContain('src/total.ts:42')
    await ui.press({ key: 'aba:tasks' })
    expect(await ui.find({ type: 'Text', text: /Corrigir o desconto/ })).toBeTruthy()
    await ui.press({ key: 'aba:bug' })
    await ui.unmount()
  }
})
