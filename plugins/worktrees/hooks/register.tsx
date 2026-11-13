import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { ScanInfo, Wt, WtSession, WtStatus } from '../types'

// ---- Ajustes ---------------------------------------------------------------
/** Padrão das pastas varridas; a opção `raizes` do plugin substitui. */
const DEFAULT_ROOTS = 'C:/projetos/liane'
/** Sessão com atividade há menos que isso: worktree em uso, nunca removível. */
const ACTIVE_HOURS = 3
/** Sem PR e tudo enviado: só vira "parada" (removível) depois desse tempo. */
const STALE_DAYS = 7
/** Tamanho em disco recalculado depois desse tempo. */
const SIZE_TTL_HOURS = 12
const RESCAN_MINUTES = 30
const DU = 'C:/Program Files/Git/usr/bin/du.exe'
// ---------------------------------------------------------------------------

const PANE = 'worktrees'
const rows = atom({ plugin: 'worktrees', key: 'rows' } as const, [] as Wt[], {
  shape: 'rows-4',
})
const scanInfo = atom({ plugin: 'worktrees', key: 'scan' } as const, {
  isScanning: false,
  step: '',
  finishedAt: null,
  message: null,
} as ScanInfo)
const confirm = atom(
  { plugin: 'worktrees', key: 'confirm' } as const,
  null as string | null,
)
const filter = atom(
  { plugin: 'worktrees', key: 'filter' } as const,
  'todas' as 'todas' | 'livre' | 'uso' | 'pendente' | 'aguardando',
)
const busy = atom({ plugin: 'worktrees', key: 'busy' } as const, null as string | null)

const HOUR = 3600_000
const DAY = 24 * HOUR

const LABEL: Record<WtStatus, string> = {
  'em-uso': 'em uso',
  alteracoes: 'alterações',
  'nao-enviado': 'não enviado',
  'pr-aberto': 'PR aberto',
  recente: 'recente',
  concluida: 'concluída',
  'pr-fechado': 'PR fechado',
  parada: 'parada',
  orfa: 'órfã',
}
type Cat = 'livre' | 'uso' | 'pendente' | 'aguardando'
const CATS: { id: Cat; title: string; theme: 'success' | 'warning' | 'error' | 'suggestion'; hex: string; icon: string }[] = [
  { id: 'livre', title: 'Pode liberar', theme: 'success', hex: '#2da44e', icon: '✓' },
  { id: 'uso', title: 'Em uso', theme: 'warning', hex: '#d4a72c', icon: '●' },
  { id: 'pendente', title: 'Com trabalho', theme: 'error', hex: '#e5534b', icon: '!' },
  { id: 'aguardando', title: 'Aguardando', theme: 'suggestion', hex: '#6e8fd6', icon: '◷' },
]
const CAT_OF: Record<WtStatus, Cat> = {
  'em-uso': 'uso',
  alteracoes: 'pendente',
  'nao-enviado': 'pendente',
  'pr-aberto': 'aguardando',
  recente: 'aguardando',
  concluida: 'livre',
  'pr-fechado': 'livre',
  parada: 'livre',
  orfa: 'livre',
}

function stackedBar(parts: { mb: number; hex: string }[], total: number) {
  let x = 0
  const rects = parts
    .filter(p => p.mb > 0)
    .map(p => {
      const w = (p.mb / total) * 1000
      const r = `<rect x="${x.toFixed(1)}" y="0" width="${Math.max(w - 4, 1).toFixed(1)}" height="14" rx="5" fill="${p.hex}"/>`
      x += w
      return r
    })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="14" viewBox="0 0 1000 14" preserveAspectRatio="none">${rects.join('')}</svg>`
}

function miniBar(frac: number, hex: string) {
  const w = Math.max(2, Math.round(frac * 60))
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 6"><rect width="60" height="6" rx="3" fill="#8b949e" fill-opacity="0.22"/><rect width="${w}" height="6" rx="3" fill="${hex}"/></svg>`
}

let ops:
  | { scan: () => void; remove: (w: Wt) => void; removeAll: () => void; open: (sessionId: string) => void }
  | undefined
let isRunning = false

const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
const key = (p: string) => norm(p).toLowerCase()
const baseName = (p: string) => norm(p).split('/').pop() ?? p
const toWin = (p: string) => norm(p).replace(/\//g, '\\')

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  let i = 0
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++]!
      await fn(item)
    }
  })
  await Promise.all(workers)
}

function ago(ms: number | null, now: number) {
  if (ms === null) return 'nunca'
  const d = now - ms
  if (d < HOUR) return `${Math.max(1, Math.round(d / 60_000))} min`
  if (d < DAY) return `${Math.round(d / HOUR)} h`
  return `${Math.round(d / DAY)} d`
}

function size(mb: number | null, isEstimate = false): string {
  if (mb === null) return '…'
  if (isEstimate) return `~${size(mb)}`
  if (mb >= 1024) return `${(mb / 1024).toFixed(1).replace('.', ',')} GB`
  return `${mb} MB`
}

type Entry = { path: string; head: string; branch: string | null }

function parseWorktrees(text: string): Entry[] {
  const out: Entry[] = []
  for (const block of text.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/)
    const wt = lines.find(l => l.startsWith('worktree '))
    if (!wt) continue
    const head = lines.find(l => l.startsWith('HEAD '))?.slice(5) ?? ''
    const br = lines.find(l => l.startsWith('branch '))?.slice(7) ?? null
    out.push({ path: norm(wt.slice(9)), head, branch: br?.replace(/^refs\/heads\//, '') ?? null })
  }
  return out
}

function classify(w: Omit<Wt, 'status' | 'reason' | 'isRemovable'>, now: number): Pick<Wt, 'status' | 'reason' | 'isRemovable'> {
  const last = Math.max(w.lastSessionMs ?? 0, w.lastCommitMs ?? 0)
  if (w.lastSessionMs !== null && now - w.lastSessionMs < ACTIVE_HOURS * HOUR)
    return { status: 'em-uso', reason: `sessão ativa há ${ago(w.lastSessionMs, now)}`, isRemovable: false }
  if (w.dirty > 0)
    return { status: 'alteracoes', reason: `${w.dirty} arquivo(s) sem commit`, isRemovable: false }
  if (w.lostCommits > 0)
    return { status: 'nao-enviado', reason: `${w.lostCommits} commit(s) só nesta máquina`, isRemovable: false }
  if (w.pr?.state === 'MERGED')
    return { status: 'concluida', reason: `PR #${w.pr.number} merged`, isRemovable: true }
  if (w.pr?.state === 'CLOSED')
    return { status: 'pr-fechado', reason: `PR #${w.pr.number} fechado sem merge`, isRemovable: true }
  if (w.pr?.state === 'OPEN')
    return { status: 'pr-aberto', reason: `PR #${w.pr.number} aberto`, isRemovable: false }
  if (w.isInBase)
    return { status: 'concluida', reason: `tudo já está em ${w.base}`, isRemovable: true }
  if (now - last > STALE_DAYS * DAY)
    return { status: 'parada', reason: `tudo enviado, sem PR, parada há ${ago(last, now)}`, isRemovable: true }
  return { status: 'recente', reason: `sem PR, mexida há ${ago(last, now)}`, isRemovable: false }
}

export const register: Register = (on, options) => {
  const ROOTS = String(options.raizes ?? DEFAULT_ROOTS)
    .split(';')
    .map(r => r.trim())
    .filter(Boolean)
    .map(norm)

  on('session.start', async ($, e, next) => {
    async function git(cwd: string, args: string[], timeoutMs = 60_000) {
      try {
        return await $.process.run(['git', ...args], { cwd, timeoutMs })
      } catch (err) {
        return { exitCode: -1, stdout: '', stderr: String(err), isStdoutTruncated: false, isStderrTruncated: false }
      }
    }

    async function lastSession(projectsDir: string, path: string) {
      const dir = `${projectsDir}/${norm(path).replace(/[^A-Za-z0-9]/g, '-')}`
      try {
        const list = await $.fs.list(dir)
        let max = 0
        for (const f of list) if (f.kind === 'file' && f.mtimeMs > max) max = f.mtimeMs
        return max || null
      } catch {
        return null
      }
    }

    /** Sessões do app desktop, pela pasta em que trabalham: a mais recente, não arquivada primeiro. */
    async function desktopSessions() {
      const map = new Map<string, WtSession>()
      const local = await $.env.get('LOCALAPPDATA')
      const roaming = await $.env.get('APPDATA')
      const bases: string[] = []
      if (local) {
        for (const d of await $.fs.list(`${norm(local)}/Claude-Data`).catch(() => [])) {
          if (d.kind === 'dir') bases.push(`${norm(local)}/Claude-Data/${d.name}/claude-code-sessions`)
        }
      }
      if (roaming) bases.push(`${norm(roaming)}/Claude/claude-code-sessions`)
      const files: string[] = []
      const walk = async (dir: string, depth: number) => {
        for (const f of await $.fs.list(dir).catch(() => [])) {
          if (f.kind === 'dir' && depth > 0) await walk(`${dir}/${f.name}`, depth - 1)
          else if (f.kind === 'file' && /^local_.*\.json$/.test(f.name)) files.push(`${dir}/${f.name}`)
        }
      }
      for (const b of bases) await walk(b, 2)
      await pool(files, 8, async file => {
        try {
          const d = JSON.parse(await $.fs.read(file)) as {
            sessionId?: string
            cwd?: string
            title?: string
            isArchived?: boolean
            lastActivityAt?: number
          }
          if (!d.sessionId || !d.cwd) return
          const s: WtSession = {
            id: d.sessionId,
            title: d.title || 'sessão sem título',
            isArchived: d.isArchived === true,
            lastActivityMs: d.lastActivityAt ?? null,
          }
          const k = key(d.cwd)
          const cur = map.get(k)
          const better =
            !cur ||
            (cur.isArchived && !s.isArchived) ||
            (cur.isArchived === s.isArchived && (s.lastActivityMs ?? 0) > (cur.lastActivityMs ?? 0))
          if (better) map.set(k, s)
        } catch {
          // arquivo em escrita ou formato diferente: ignora
        }
      })
      return map
    }

    async function setStep(step: string) {
      await update($, scanInfo, s => ({ ...s, isScanning: true, step }))
    }

    async function scan() {
      if (isRunning) return
      isRunning = true
      try {
        await update($, scanInfo, s => ({ ...s, isScanning: true, step: 'procurando repositórios', message: null }))
        const now = await $.clock.now()
        const home = norm((await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${(await $.env.get('USERPROFILE')) ?? ''}/.claude`)
        const projectsDir = `${home}/projects`
        const sessions = await desktopSessions()
        const sessionOf = (p: string) => sessions.get(key(p)) ?? null
        const lastOf = async (p: string) => {
          const t = await lastSession(projectsDir, p)
          const s = sessionOf(p)?.lastActivityMs ?? null
          return t === null && s === null ? null : Math.max(t ?? 0, s ?? 0)
        }
        // O arquivo .git de uma worktree é escrito quando ela é criada.
        const createdOf = async (p: string) =>
          (await $.fs.stat(`${p}/.git`).catch(() => undefined))?.mtimeMs || null

        // 1. Repositórios principais nas raízes, e pastas candidatas a worktree.
        const repos = new Set<string>()
        const candidates = new Set<string>()
        for (const root of ROOTS) {
          const entries = await $.fs.list(root).catch(() => [])
          for (const d of entries) {
            if (d.kind !== 'dir') continue
            const p = `${norm(root)}/${d.name}`
            const gitStat = await $.fs.stat(`${p}/.git`).catch(() => undefined)
            if (gitStat?.kind === 'dir') {
              repos.add(p)
              const inner = await $.fs.list(`${p}/.claude/worktrees`).catch(() => [])
              for (const w of inner) if (w.kind === 'dir') candidates.add(`${p}/.claude/worktrees/${w.name}`)
            } else if (d.name === 'worktrees') {
              const inner = await $.fs.list(p).catch(() => [])
              for (const w of inner) if (w.kind === 'dir') candidates.add(`${p}/${w.name}`)
            }
          }
        }

        // 2. Worktrees registradas de cada repositório.
        type Item = Entry & { repo: string; base: string; prs: Map<string, { number: number; state: string; oid: string }> }
        const items: Item[] = []
        const registered = new Set<string>()
        const repoList = [...repos]
        let done = 0
        await pool(repoList, 4, async repo => {
          const list = await git(repo, ['worktree', 'list', '--porcelain'])
          const entries = parseWorktrees(list.stdout)
          for (const e of entries) registered.add(key(e.path))
          const others = entries.slice(1)
          if (others.length > 0) {
            await git(repo, ['fetch', 'origin', '--prune', '--quiet'], 120_000)
            const head = await git(repo, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
            const base = head.exitCode === 0 ? head.stdout.trim() : entries[0]?.branch ?? 'main'
            const prs = new Map<string, { number: number; state: string; oid: string }>()
            try {
              const r = await $.process.run(
                ['gh', 'pr', 'list', '--state', 'all', '--limit', '500', '--json', 'number,state,headRefName,headRefOid'],
                { cwd: repo, timeoutMs: 60_000 },
              )
              if (r.exitCode === 0) {
                for (const pr of JSON.parse(r.stdout) as { number: number; state: string; headRefName: string; headRefOid: string }[]) {
                  if (!prs.has(pr.headRefName)) prs.set(pr.headRefName, { number: pr.number, state: pr.state, oid: pr.headRefOid })
                }
              }
            } catch {
              // sem gh ou sem remoto no GitHub: segue sem PRs
            }
            for (const e of others) items.push({ ...e, repo, base, prs })
          }
          done++
          await setStep(`lendo repositórios (${done}/${repoList.length})`)
        })

        // 3. Detalhes de cada worktree.
        const sizes = ((await $.store.get('sizes')) ?? {}) as Record<string, { mb: number; at: number }>
        const found: Wt[] = []
        done = 0
        await pool(items, 6, async it => {
          const exists = await $.fs.exists(it.path)
          const status = exists ? await git(it.path, ['status', '--porcelain']) : { exitCode: 1, stdout: '' }
          const dirty = status.stdout.split(/\r?\n/).filter(Boolean).length
          const unpushed = exists ? await git(it.path, ['rev-list', 'HEAD', '--not', '--remotes']) : { stdout: '' }
          const pr = it.branch ? it.prs.get(it.branch) ?? null : null
          // Commits fora dos remotos que o PR merged já levou (squash/branch apagada) não contam.
          const unpushedShas = unpushed.stdout.split(/\r?\n/).filter(Boolean)
          const lostCommits = pr && pr.state === 'MERGED' && pr.oid === it.head ? 0 : unpushedShas.length
          const inBase = exists ? (await git(it.path, ['merge-base', '--is-ancestor', 'HEAD', it.base])).exitCode === 0 : false
          const lc = exists ? await git(it.path, ['log', '-1', '--format=%ct']) : { stdout: '' }
          const lastCommitMs = Number(lc.stdout.trim()) * 1000 || null
          const lastSessionMs = await lastOf(it.path)
          const cached = sizes[key(it.path)]
          const base = {
            path: it.path,
            repo: it.repo,
            repoName: baseName(it.repo),
            name: baseName(it.path),
            branch: it.branch,
            dirty: exists ? dirty : 0,
            lostCommits,
            pr: pr ? { number: pr.number, state: pr.state } : null,
            isInBase: inBase,
            base: it.base.replace(/^origin\//, ''),
            lastSessionMs,
            lastCommitMs,
            sizeMb: cached ? cached.mb : null,
            session: sessionOf(it.path),
            cliSessionMs: await lastSession(projectsDir, it.path),
            createdMs: await createdOf(it.path),
          }
          found.push(
            exists
              ? { ...base, ...classify(base, now) }
              : { ...base, status: 'orfa', reason: 'registrada no git, mas a pasta não existe', isRemovable: true },
          )
          done++
          if (done % 5 === 0) await setStep(`verificando worktrees (${done}/${items.length})`)
        })

        // 4. Pastas em diretórios de worktree que nenhum repositório conhece.
        for (const c of candidates) {
          if (registered.has(key(c))) continue
          const r = await git(c, ['rev-parse', '--show-toplevel'])
          if (r.exitCode === 0 && key(r.stdout.trim()) === key(c)) continue // worktree de repo fora das raízes
          const cached = sizes[key(c)]
          found.push({
            path: c,
            repo: c.replace(/\/(\.claude\/)?worktrees\/[^/]+$/, ''),
            repoName: baseName(c.replace(/\/(\.claude\/)?worktrees\/[^/]+$/, '')),
            name: baseName(c),
            branch: null,
            dirty: 0,
            lostCommits: 0,
            pr: null,
            isInBase: false,
            base: '',
            lastSessionMs: await lastOf(c),
            lastCommitMs: null,
            sizeMb: cached ? cached.mb : null,
            session: sessionOf(c),
            cliSessionMs: await lastSession(projectsDir, c),
            createdMs: await createdOf(c),
            status: 'orfa',
            reason: 'pasta que nenhum repositório reconhece como worktree',
            isRemovable: true,
          })
        }

        found.sort((a, b) => a.repoName.localeCompare(b.repoName) || a.name.localeCompare(b.name))

        // Sem medida guardada: estima pela medida de outra worktree do mesmo repositório.
        const known = new Map<string, number>()
        for (const w of found) if (w.sizeMb !== null && !known.has(w.repo)) known.set(w.repo, w.sizeMb)
        const estimated = found.map(w =>
          w.sizeMb === null && known.has(w.repo) ? { ...w, sizeMb: known.get(w.repo) ?? null, isSizeEstimated: true } : w,
        )
        await update($, rows, () => estimated)
        await update($, scanInfo, s => ({ ...s, step: 'medindo tamanho em disco' }))
        await refreshStatus()

        // 5. Tamanho em disco: primeiro uma worktree por repositório (vira a estimativa
        //    das demais), depois o resto; três medições ao mesmo tempo.
        const stale = estimated.filter(w => {
          const c = sizes[key(w.path)]
          return !c || now - c.at > SIZE_TTL_HOURS * HOUR
        })
        const seen = new Set<string>()
        const firstOfRepo: Wt[] = []
        const rest: Wt[] = []
        for (const w of stale) {
          if (seen.has(w.repo)) rest.push(w)
          else {
            seen.add(w.repo)
            firstOfRepo.push(w)
          }
        }
        const queue = [...firstOfRepo, ...rest]
        done = 0
        await pool(queue, 3, async w => {
          if (await $.fs.exists(w.path)) {
            try {
              const r = await $.process.run([DU, '-sm', w.path], { timeoutMs: 600_000 })
              const mb = parseInt(r.stdout, 10)
              if (!Number.isNaN(mb)) {
                sizes[key(w.path)] = { mb, at: await $.clock.now() }
                await $.store.set('sizes', sizes)
                await update($, rows, list =>
                  list.map(x => {
                    if (key(x.path) === key(w.path)) return { ...x, sizeMb: mb, isSizeEstimated: false }
                    if (x.repo === w.repo && (x.sizeMb === null || x.isSizeEstimated))
                      return { ...x, sizeMb: mb, isSizeEstimated: true }
                    return x
                  }),
                )
              }
            } catch {
              // du ausente ou demorou demais: fica sem tamanho
            }
          }
          done++
          await update($, scanInfo, s => ({ ...s, step: `medindo tamanho em disco (${done}/${queue.length})` }))
          await refreshStatus()
        })
        await update($, scanInfo, s => ({ ...s, isScanning: false, step: '', finishedAt: now }))
        await refreshStatus()
      } catch (err) {
        await update($, scanInfo, s => ({ ...s, isScanning: false, step: '', message: `Falha na varredura: ${String(err)}` }))
      } finally {
        isRunning = false
      }
    }

    async function refreshStatus() {
      const list = await read($, rows)
      const rem = list.filter(w => w.isRemovable)
      const mb = rem.reduce((s, w) => s + (w.sizeMb ?? 0), 0)
      $.ui.status(rem.length ? `worktrees: ${rem.length} removíveis · ${size(mb, rem.some(w => w.isSizeEstimated))}` : undefined)
    }

    async function remove(w: Wt) {
      await update($, busy, () => w.path)
      await update($, confirm, () => null)
      let error: string | null = null
      try {
        const registered = w.branch !== null || w.base !== ''
        if (registered) {
          const r = await git(w.repo, ['worktree', 'remove', w.path], 600_000)
          if (r.exitCode !== 0) error = r.stderr.trim() || r.stdout.trim()
          if (!error && w.branch && (w.pr?.state === 'MERGED' || w.isInBase)) {
            await git(w.repo, ['branch', '-D', w.branch])
          }
        } else {
          const r = await $.process.run(['cmd', '/c', 'rmdir', '/s', '/q', toWin(w.path)], { timeoutMs: 600_000 })
          if (await $.fs.exists(w.path)) error = r.stderr.trim() || 'a pasta não pôde ser apagada (arquivo em uso?)'
        }
        if (await $.fs.exists(`${w.repo}/.git`)) await git(w.repo, ['worktree', 'prune'])
      } catch (err) {
        error = String(err)
      }
      if (error) {
        await update($, scanInfo, s => ({ ...s, message: `Não removi ${w.name}: ${error}` }))
      } else {
        await update($, rows, list => list.filter(x => x.path !== w.path))
        await update($, scanInfo, s => ({ ...s, message: `Removida ${w.repoName}/${w.name}${w.sizeMb ? `, liberou ~${size(w.sizeMb)}` : ''}.` }))
        const sizes = ((await $.store.get('sizes')) ?? {}) as Record<string, unknown>
        delete sizes[key(w.path)]
        await $.store.set('sizes', sizes)
      }
      await update($, busy, () => null)
      await refreshStatus()
    }

    async function removeAll() {
      const list = (await read($, rows)).filter(w => w.isRemovable)
      for (const w of list) await remove(w)
      const left = (await read($, rows)).filter(w => w.isRemovable).length
      await update($, scanInfo, s => ({
        ...s,
        message: `Removidas ${list.length - left} de ${list.length}.${left ? ' Veja as que falharam na lista.' : ''}`,
      }))
    }


    const later = (fn: () => Promise<void>) => void $.clock.after(0, () => void fn())
    ops = {
      scan: () => later(scan),
      remove: w => later(() => remove(w)),
      removeAll: () => later(removeAll),
      open: id =>
        later(async () => {
          if (!/^local_[0-9a-f-]+$/.test(id)) return
          await $.process.run(['rundll32', 'url.dll,FileProtocolHandler', `claude://claude.ai/epitaxy/${id}`])
        }),
    }
    await $.command.register({ name: 'worktrees', description: 'Painel das git worktrees: uso, conclusão, tamanho e remoção' })
    $.clock.every(RESCAN_MINUTES * 60_000, () => void scan())
    $.clock.after(2_000, () => void scan())
    return next(e)
  })

  on('command.run', { command: 'worktrees' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Worktrees' })
    ops?.scan()
    return { text: 'Painel de worktrees aberto.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const Svg = 'Svg' in ui ? ui.Svg : undefined
    const list = await read($, rows)
    const info = await read($, scanInfo)
    const pending = await read($, confirm)
    const working = await read($, busy)
    const stored = (await read($, filter)) as string
    const mode: 'todas' | Cat = CATS.some(c => c.id === stored) ? (stored as Cat) : 'todas'
    const pick = (m: 'todas' | Cat) => update($, filter, cur => (cur === m ? 'todas' : m))
    const now = await $.clock.now()
    const cols = e.props.bodyColumns ?? 80
    const isWide = cols >= 70

    const sum = (ws: Wt[]) => ws.reduce((a, w) => a + (w.sizeMb ?? 0), 0)
    const totals = CATS.map(c => {
      const ws = list.filter(w => CAT_OF[w.status] === c.id)
      return { ...c, count: ws.length, mb: sum(ws), est: ws.some(w => w.isSizeEstimated === true) }
    })
    const removable = list.filter(w => w.isRemovable)
    const totalMb = sum(list)
    const freeMb = sum(removable)
    const freeEst = removable.some(w => w.isSizeEstimated === true)
    const shown = mode === 'todas' ? list : list.filter(w => CAT_OF[w.status] === mode)
    const maxMb = Math.max(1, ...list.map(w => w.sizeMb ?? 0))

    const groups = [...new Set(shown.map(w => w.repoName))]
      .map(repo => {
        const ws = shown
          .filter(w => w.repoName === repo)
          .sort((a, b) => Number(b.isRemovable) - Number(a.isRemovable) || (b.sizeMb ?? 0) - (a.sizeMb ?? 0))
        return {
          repo,
          ws,
          mb: sum(ws),
          free: sum(ws.filter(w => w.isRemovable)),
          est: ws.some(w => w.isSizeEstimated === true),
        }
      })
      .sort((a, b) => b.mb - a.mb)

    const statusLine = info.isScanning
      ? `⟳ ${info.step}…${list.some(w => w.isSizeEstimated) ? ' · ~ = estimado por outra worktree do repositório' : ''}`
      : info.finishedAt
        ? `verificado há ${ago(info.finishedAt, now)} · em uso = sessão nas últimas ${ACTIVE_HOURS} h`
        : 'ainda não verificado'

    const barWidth = Math.max(10, Math.min(60, cols - 4))

    return (
      <Box flexDirection="column" gap={1} paddingX={1}>
        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between" alignItems="center" flexWrap="wrap">
            <Text size="title" weight="bold" bold>Worktrees</Text>
            <Text dimColor size="caption">{statusLine}</Text>
          </Box>
          {info.message && (
            <Text color="warning" size="footnote">{info.message}</Text>
          )}
        </Box>

        <Box flexDirection="row" gap={1} flexWrap="wrap">
          {[
            { id: 'todas' as const, title: 'No disco', icon: '▦', theme: 'subtle' as const, mb: totalMb, count: list.length, est: list.some(w => w.isSizeEstimated === true) },
            ...totals,
          ].map(t => {
            const isActive = mode === t.id
            const isFaded = mode !== 'todas' && !isActive && t.id !== 'todas'
            return (
              <Box
                key={`card-box:${t.id}`}
                borderStyle={isActive ? 'bold' : 'round'}
                borderColor={t.id === 'todas' && !isActive ? 'subtle' : t.theme}
                borderDimColor={isFaded}
                paddingX={1}
                minWidth={16}
                flexDirection="column"
                hover={{ borderStyle: 'bold' }}
              >
                <Button key={`card:${t.id}:title`} plain onPress={() => pick(t.id)}>
                  <Text color={t.id === 'todas' ? undefined : t.theme} dimColor={t.id === 'todas' || isFaded} size="caption" bold>
                    {`${t.icon} ${t.title.toUpperCase()}${isActive && t.id !== 'todas' ? '  ✕' : ''}`}
                  </Text>
                </Button>
                <Button key={`card:${t.id}:size`} plain onPress={() => pick(t.id)}>
                  <Text size="heading" weight="bold" bold tabular dimColor={isFaded}>{size(t.mb, t.est)}</Text>
                </Button>
                <Button key={`card:${t.id}:count`} plain onPress={() => pick(t.id)}>
                  <Text dimColor size="footnote">{`${t.count} worktree${t.count === 1 ? '' : 's'}`}</Text>
                </Button>
              </Box>
            )
          })}
        </Box>

        {totalMb > 0 &&
          (Svg ? (
            <Svg
              source={stackedBar(totals, totalMb)}
              alt={totals.map(t => `${t.title}: ${size(t.mb)}`).join(', ')}
              height={14}
            />
          ) : (
            <Box flexDirection="row">
              {totals.map(t => (
                <Text color={t.theme}>{'█'.repeat(Math.round((t.mb / totalMb) * barWidth))}</Text>
              ))}
            </Box>
          ))}

        <Box flexDirection="row" gap={1} flexWrap="wrap" alignItems="center">
          <Button key="rescan" hotkey="r" onPress={() => ops?.scan()}>
            {info.isScanning ? 'Atualizando…' : 'Atualizar'}
          </Button>
          {mode !== 'todas' && (
            <Button key="filter" hotkey="f" onPress={() => pick('todas')}>
              {`Limpar filtro (${CATS.find(c => c.id === mode)?.title ?? ''})`}
            </Button>
          )}
          {removable.length > 0 &&
            (pending === '*' ? (
              <>
                <Button key="all-yes" variant="primary" onPress={() => ops?.removeAll()}>
                  {`Confirmar: remover ${removable.length} (${size(freeMb, freeEst)})`}
                </Button>
                <Button key="all-no" onPress={() => update($, confirm, () => null)}>Cancelar</Button>
              </>
            ) : (
              <Button key="all" variant="primary" onPress={() => update($, confirm, () => '*')}>
                {`Liberar ${size(freeMb, freeEst)}`}
              </Button>
            ))}
        </Box>

        {list.length === 0 && !info.isScanning && <Text dimColor>Nenhuma worktree encontrada.</Text>}
        {shown.length === 0 && list.length > 0 && <Text dimColor>Nada para liberar agora.</Text>}

        {groups.map(g => (
          <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1}>
            <Box flexDirection="row" justifyContent="space-between" alignItems="center">
              <Text weight="semibold" bold color="claude">{g.repo}</Text>
              <Text dimColor size="caption" tabular>
                {`${g.ws.length} · ${size(g.mb, g.est)}${g.free ? ` · ${size(g.free, g.est)} livres` : ''}`}
              </Text>
            </Box>
            {g.ws.map(w => {
              const cat = CATS.find(c => c.id === CAT_OF[w.status]) ?? CATS[0]!
              return (
                <Box flexDirection="column" marginTop={1}>
                  <Box flexDirection="row" gap={1} alignItems="center" justifyContent="space-between">
                    <Box flexDirection="row" gap={1} alignItems="center" flexShrink={1}>
                      <Text backgroundColor={cat.theme} color="inverseText" bold size="caption">
                        {` ${cat.icon} ${LABEL[w.status]} `}
                      </Text>
                      {w.session ? (
                        <Button
                          key={`open:${w.path}`}
                          plain
                          onPress={() => w.session && ops?.open(w.session.id)}
                        >
                          <Text weight="medium" wrap="truncate-middle">{w.name}</Text>
                          <Text color="claude">{' ↗'}</Text>
                        </Button>
                      ) : (
                        <Text weight="medium" wrap="truncate-middle">{w.name}</Text>
                      )}
                    </Box>
                    <Box flexDirection="row" gap={1} alignItems="center">
                      {Svg && w.sizeMb !== null && (
                        <Svg source={miniBar(w.sizeMb / maxMb, cat.hex)} alt={size(w.sizeMb)} width={60} height={6} />
                      )}
                      <Text dimColor tabular italic={w.isSizeEstimated === true}>{size(w.sizeMb, w.isSizeEstimated === true)}</Text>
                      {working === w.path ? (
                        <Text color="warning">removendo…</Text>
                      ) : w.isRemovable ? (
                        pending === w.path ? (
                          <>
                            <Button key={`yes:${w.path}`} variant="primary" onPress={() => ops?.remove(w)}>
                              Confirmar
                            </Button>
                            <Button key={`no:${w.path}`} onPress={() => update($, confirm, () => null)}>
                              Cancelar
                            </Button>
                          </>
                        ) : (
                          <Button key={`rm:${w.path}`} dimColor onPress={() => update($, confirm, () => w.path)}>
                            Remover
                          </Button>
                        )
                      ) : null}
                    </Box>
                  </Box>
                  <Text dimColor size="footnote" wrap="truncate-end">
                    {`${w.reason}${w.branch ? `  ·  ⎇ ${w.branch}` : ''}${
                      w.session
                        ? `  ·  💬 ${w.session.title}${w.session.isArchived ? ' (arquivada)' : ''}${
                            isWide && w.status !== 'em-uso' ? `, ${ago(w.lastSessionMs, now)}` : ''
                          }`
                        : w.cliSessionMs !== null
                          ? `  ·  ⌨ só sessão de terminal, ${ago(w.cliSessionMs, now)}`
                          : `  ·  nenhuma sessão do Claude${
                              w.createdMs !== null ? ` (criada há ${ago(w.createdMs, now)}, fora do app ou sessão apagada)` : ''
                            }`
                    }`}
                  </Text>
                </Box>
              )
            })}
          </Box>
        ))}
      </Box>
    )
  })
}
