export type Aba = 'us' | 'spec' | 'tasks'

export type Task = {
  n: string
  texto: string
  spec: string
  verificacao: string
  estado: 'feita' | 'andamento' | 'pendente'
}

export type Demanda = {
  /** Pasta da demanda (absoluta), `<pastaDemandas>/NNN-slug`. */
  dir: string
  id: string
  /** Como a demanda foi achada: pela branch, por um arquivo tocado na sessão ou escolhida no painel. */
  origem: 'branch' | 'arquivo' | 'escolha'
  titulo: string
  status: string
  branch: string
  us: string | null
  spec: string | null
  tasks: string | null
  lista: Task[]
  lidoEm: number
}

export type Contexto = {
  /** Raiz do repositório, quando tem `.claude/fluxo.json`. */
  raiz: string | null
  pastaDemandas: string | null
  branch: string
  /** Demandas que existem na pasta, para escolher quando nada foi detectado. */
  disponiveis: string[]
}

declare module 'claude-code' {
  interface PluginState {
    demanda: {
      atual: Shaped<Demanda | null>
      contexto: Shaped<Contexto>
      aba: Aba
    }
  }
}
