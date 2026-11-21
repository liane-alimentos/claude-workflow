export type Aba = 'us' | 'spec' | 'tasks' | 'bug'

export type Task = {
  n: string
  /** A primeira linha da célula (até o primeiro `<br>`), sem marcação. */
  titulo: string
  /** O resto da célula, em markdown, com os `<br>` virados em quebras de linha. */
  detalhe: string
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
  /** Funcionalidade (us, spec e tasks) ou correção (bug.md). */
  tipo: 'funcionalidade' | 'correcao'
  titulo: string
  status: string
  branch: string
  us: string | null
  spec: string | null
  tasks: string | null
  bug: string | null
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
      /** Números das tasks com o detalhe aberto. */
      abertas: string[]
    }
  }
}
