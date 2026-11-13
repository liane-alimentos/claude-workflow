export type WtStatus =
  | 'em-uso'
  | 'alteracoes'
  | 'nao-enviado'
  | 'pr-aberto'
  | 'recente'
  | 'concluida'
  | 'pr-fechado'
  | 'parada'
  | 'orfa'

export type WtSession = {
  id: string
  title: string
  isArchived: boolean
  lastActivityMs: number | null
}

export type Wt = {
  path: string
  repo: string
  repoName: string
  name: string
  branch: string | null
  dirty: number
  lostCommits: number
  pr: { number: number; state: string } | null
  isInBase: boolean
  base: string
  lastSessionMs: number | null
  lastCommitMs: number | null
  sizeMb: number | null
  /** sizeMb copiado de outra worktree do mesmo repositório enquanto a medida real não sai. */
  isSizeEstimated?: boolean
  session: WtSession | null
  /** Última atividade de uma sessão de terminal (histórico em ~/.claude/projects), se houver. */
  cliSessionMs: number | null
  /** Quando a worktree foi criada (data do seu arquivo .git). */
  createdMs: number | null
  status: WtStatus
  reason: string
  isRemovable: boolean
}

export type ScanInfo = {
  isScanning: boolean
  step: string
  finishedAt: number | null
  message: string | null
}

declare module 'claude-code' {
  interface PluginState {
    worktrees: {
      rows: Shaped<Wt[]>
      scan: ScanInfo
      confirm: string | null
      filter: 'todas' | 'livre' | 'uso' | 'pendente' | 'aguardando'
      busy: string | null
    }
  }
}
