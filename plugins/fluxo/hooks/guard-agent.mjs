// Guarda dos subagentes (CA-8). Recebe o JSON da ferramenta pela entrada padrão e o agente no argumento.
// Para negar, responde com permissionDecision "deny". O que foge da gramática simples que ela modela é negado.
// Limite conhecido: lê o texto do comando. Scripts e interpretadores (`node x.mjs`, `./x.sh`, `npm run`) não são inspecionados.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

const AGENTS = new Set(['architect', 'developer', 'reviewer']);
const EDIT_TOOLS = { Edit: 'file_path', Write: 'file_path', NotebookEdit: 'notebook_path' };
const SHELL_DIALECTS = { Bash: 'bash', PowerShell: 'powershell' };

const GIT_PURE_READS = [
  '', 'blame', 'cat-file', 'check-ignore', 'count-objects', 'describe', 'diff', 'for-each-ref', 'grep', 'help', 'log', 'ls-files',
  'ls-remote', 'ls-tree', 'merge-base', 'reflog', 'rev-list', 'rev-parse', 'shortlog', 'show', 'show-ref', 'status', 'version',
];
const GIT_READS = new Set([...GIT_PURE_READS, 'branch', 'remote']);
const ARCHITECT_GIT = new Set([...GIT_READS, 'add', 'commit']);
const DEVELOPER_GIT = new Set([
  ...GIT_READS, 'add', 'am', 'apply', 'checkout', 'cherry-pick', 'commit', 'config', 'fetch', 'merge', 'mv', 'notes', 'pull', 'reset',
  'restore', 'revert', 'rm', 'stash', 'switch', 'tag',
]);
const GIT_BOOLEAN_OPTIONS = new Set([
  '-p', '-P', '--paginate', '--no-pager', '--no-replace-objects', '--no-optional-locks', '--bare', '--literal-pathspecs',
  '--glob-pathspecs', '--noglob-pathspecs', '--icase-pathspecs', '--version', '--help', '-v', '-h',
]);
const GIT_VALUE_OPTIONS = new Set(['-C', '-c', '--namespace']);
const GIT_SAFE_CONFIG = /^(color\.|user\.|core\.(longpaths|autocrlf|safecrlf|quotepath)=)/i;
const GH_READS = { pr: new Set(['checks', 'diff', 'list', 'status', 'view']), issue: new Set(['list', 'view']), repo: new Set(['view']) };

// Lista de permissão do Reviewer, que só lê.
const REVIEWER_PROGRAMS = new Set([
  'basename', 'case', 'cat', 'cd', 'cut', 'diff', 'dir', 'dirname', 'echo', 'false', 'file', 'find', 'findstr', 'for', 'foreach',
  'gc', 'gci', 'get-childitem', 'get-content', 'get-item', 'get-location', 'gh', 'git', 'grep', 'head', 'ls', 'measure-object',
  'node', 'npm', 'npx', 'printf', 'pwd', 'resolve-path', 'rg', 'sed', 'select-object', 'select-string', 'set-location', 'sls', 'sort',
  'sort-object', 'stat', 'tail', 'test', 'test-path', 'tr', 'true', 'type', 'uniq', 'wc', 'where', 'where-object', 'which',
  'write-output',
]);

// Palavras do shell que antecedem um comando, sem mudar qual é o programa.
const RESERVED_WORDS = new Set(['!', 'if', 'then', 'elif', 'else', 'fi', 'do', 'done', 'while', 'until', 'esac', 'function']);
// Prefixos que só executam o comando seguinte. Com opção, o valor da opção não é separável do programa, então nega.
const WRAPPERS = new Set(['command', 'env', 'exec', 'nice', 'nohup', 'sudo', 'time', 'xargs']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'ash', 'powershell', 'pwsh', 'cmd']);
// Executores cujo conteúdo a guarda não consegue ler.
const OPAQUE_EXECUTORS = new Set([
  '.', 'alias', 'busybox', 'csh', 'fish', 'iex', 'invoke-command', 'invoke-expression', 'saps', 'script', 'set-alias', 'source',
  'start-job', 'start-process', 'tcsh', 'trap', 'watch', 'wsl',
]);
const DIRECTORY_COMMANDS = new Set(['cd', 'chdir', 'pushd', 'push-location', 'set-location', 'sl']);
// Programas que recebem `git` como texto, sem executá-lo.
const TEXT_PROGRAMS = new Set([
  'cat', 'echo', 'findstr', 'grep', 'head', 'ls', 'printf', 'rg', 'select-string', 'sls', 'tail', 'type', 'where', 'which', 'write-output',
]);
const DESTRUCTIVE_COMMANDS = new Set([
  'del', 'erase', 'mi', 'move', 'move-item', 'mv', 'rd', 'remove-item', 'ren', 'rename-item', 'ri', 'rm', 'rmdir', 'rni',
]);
const COPY_COMMANDS = new Set(['copy', 'copy-item', 'cp', 'cpi', 'robocopy', 'rsync', 'xcopy']);
const WRITE_COMMANDS = new Set([
  ...DESTRUCTIVE_COMMANDS, ...COPY_COMMANDS, 'ac', 'add-content', 'clear-content', 'ln', 'md', 'mklink', 'mkdir', 'new-item', 'ni',
  'install', 'out-file', 'sc', 'set-content', 'tee', 'tee-object', 'touch', 'truncate', 'unlink',
]);
const NULL_DEVICES = new Set(['/dev/null', 'nul', '$null']);
// Nome de programa com estes caracteres é calculado pelo shell, e a guarda não sabe qual é.
const COMPUTED_WORD = /[$`{},^*?[\]“”‘’]/;
const GROUP_OPEN = Object.freeze(Object.assign([], { group: 'open' }));
const GROUP_CLOSE = Object.freeze(Object.assign([], { group: 'close' }));

class Denied extends Error {}

// Configuração do projeto em .claude/fluxo.json. Sem o arquivo, valem os padrões abaixo.
const DEFAULT_CONFIG = Object.freeze({ branchPrincipal: 'main', pastaDemandas: 'docs/development', pastaHandoff: 'docs/handoff' });
let CONFIG = DEFAULT_CONFIG;
// Comandos extras do Reviewer (reviewerComandos), por programa e subcomando. Ex.: { "dotnet": ["build", "test"] }.
let REVIEWER_EXTRAS = new Map();
// Programas que nunca entram em reviewerComandos: executam outro comando, alteram o Git ou gravam arquivos.
const NEVER_REVIEWER_EXTRA = new Set(['git', 'gh', 'eval', 'node', 'npm', 'npx']);

function loadReviewerExtras(value) {
  if (value === undefined) return new Map();
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Denied('.claude/fluxo.json: reviewerComandos deve ser um objeto { programa: [subcomandos] }.');
  const extras = new Map();
  for (const [program, subcommands] of Object.entries(value)) {
    const name = program.toLowerCase();
    if (!/^[a-z][\w.-]*$/.test(name) || SHELLS.has(name) || OPAQUE_EXECUTORS.has(name) || WRAPPERS.has(name) || WRITE_COMMANDS.has(name)
      || NEVER_REVIEWER_EXTRA.has(name) || DIRECTORY_COMMANDS.has(name)) {
      throw new Denied(`.claude/fluxo.json: ${program} não pode entrar em reviewerComandos.`);
    }
    if (!Array.isArray(subcommands) || !subcommands.length || !subcommands.every((sub) => typeof sub === 'string' && /^[a-z][\w-]*$/i.test(sub))) {
      throw new Denied(`.claude/fluxo.json: reviewerComandos.${program} deve ser uma lista de subcomandos simples.`);
    }
    extras.set(name, new Set(subcommands));
  }
  return extras;
}

function loadConfig(projectDir) {
  const file = join(projectDir, '.claude', 'fluxo.json');
  if (!existsSync(file)) return DEFAULT_CONFIG;
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch {
    throw new Denied('.claude/fluxo.json não é JSON válido.');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Denied('.claude/fluxo.json deve ser um objeto.');
  const config = { ...DEFAULT_CONFIG };
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    if (raw[key] === undefined) continue;
    const value = raw[key];
    if (typeof value !== 'string' || !value.trim()) throw new Denied(`.claude/fluxo.json: ${key} inválido.`);
    if (key === 'branchPrincipal' && !/^[\w./-]+$/.test(value)) throw new Denied('.claude/fluxo.json: branchPrincipal inválida.');
    if (key !== 'branchPrincipal' && (isAbsolute(value) || value.split(/[/\\]/).includes('..'))) {
      throw new Denied(`.claude/fluxo.json: ${key} deve ser um caminho relativo dentro do projeto.`);
    }
    config[key] = value.replace(/[/\\]+$/, '');
  }
  REVIEWER_EXTRAS = loadReviewerExtras(raw.reviewerComandos);
  return Object.freeze(config);
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function deny(reason) {
  process.stdout.write(`${JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `Guarda do agente: ${reason}` },
  })}\n`);
}

// Analisa uma lista de comandos até o fechamento pedido. Cada trecho guarda o operador seguinte e seus comandos aninhados.
function parseLevel(command, dialect, start, closer) {
  const isBash = dialect === 'bash';
  const segments = [];
  const pendingHeredocs = [];
  let nested = [];
  let tokens = [];
  let current = null;
  let quote = null;
  let depth = 0;

  const pushToken = () => {
    if (current !== null) tokens.push(current);
    current = null;
  };
  const pushSegment = (op) => {
    pushToken();
    if (tokens.length || nested.length) {
      tokens.op = op;
      tokens.nested = nested;
      segments.push(tokens);
    }
    tokens = [];
    nested = [];
  };
  const readSubstitution = (position, end) => {
    const inner = parseLevel(command, dialect, position, end);
    nested.push(inner);
    current = `${current ?? ''}$()`;
    return inner.end;
  };
  const skipHeredocs = (newline) => {
    let lineStart = newline + 1;
    for (const { marker, quoted } of pendingHeredocs.splice(0)) {
      const bodyStart = lineStart;
      for (;;) {
        if (lineStart >= command.length) throw new Denied(`heredoc ${marker} sem fechamento.`);
        const lineEnd = command.indexOf('\n', lineStart);
        const line = command.slice(lineStart, lineEnd === -1 ? command.length : lineEnd);
        if (line.trim() === marker) {
          if (!quoted && /\$\(|`/.test(command.slice(bodyStart, lineStart))) {
            throw new Denied(`heredoc ${marker} sem aspas expande comandos; use <<'${marker}'.`);
          }
          lineStart = lineEnd === -1 ? command.length : lineEnd + 1;
          break;
        }
        lineStart = lineEnd === -1 ? command.length : lineEnd + 1;
      }
    }
    return lineStart - 1;
  };

  let i = start;
  for (; i < command.length; i += 1) {
    const char = command[i];
    const next = command[i + 1];

    if (quote === "'") {
      if (char === "'") quote = null;
      else current += char;
      continue;
    }
    if (char === '$' && next === '(') {
      i = readSubstitution(i + 2, ')');
      continue;
    }
    if (char === '$' && next === '{') {
      const expansion = /^\$\{(env:)?[A-Za-z_]\w*\}/.exec(command.slice(i));
      if (!expansion) throw new Denied('expansão ${...} complexa não é analisada; use ${NOME}.');
      current = `${current ?? ''}${expansion[0]}`;
      i += expansion[0].length - 1;
      continue;
    }
    if (char === '`') {
      if (isBash) {
        if (closer === '`') {
          if (quote) throw new Denied('crase dentro de aspas em substituição.');
          pushSegment(null);
          if (pendingHeredocs.length) throw new Denied('heredoc sem fechamento na substituição.');
          return { segments, end: i };
        }
        i = readSubstitution(i + 1, '`');
      } else {
        // No PowerShell, a crase é o escape.
        i += 1;
        if (command[i] === '\r') i += 1;
        if (command[i] !== '\n' && command[i] !== undefined) current = `${current ?? ''}${command[i]}`;
      }
      continue;
    }
    if (quote === '"') {
      if (char === '"') quote = null;
      else if (isBash && char === '\\' && /["\\$`]/.test(next ?? '')) current += command[++i];
      else current += char;
      continue;
    }
    if (isBash && char === '$' && next === "'") {
      const end = command.indexOf("'", i + 2);
      const body = end === -1 ? '' : command.slice(i + 2, end);
      if (end === -1 || body.includes('\\')) throw new Denied("$'...' com escape não é analisado.");
      current = `${current ?? ''}${body}`;
      i = end;
      continue;
    }
    if (isBash && char === '$' && next === '"') continue;
    if (!isBash && char === '@' && (next === "'" || next === '"') && /^\r?\n/.test(command.slice(i + 2))) {
      const end = command.indexOf(`\n${next}@`, i + 2);
      if (end === -1) throw new Denied('here-string sem fechamento.');
      if (next === '"' && command.slice(i + 2, end).includes('$(')) throw new Denied("here-string expansível com $(...); use @'...'@.");
      current = `${current ?? ''}`;
      i = end + 2;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      current ??= '';
      continue;
    }
    if (char === '#' && current === null) {
      while (i + 1 < command.length && command[i + 1] !== '\n') i += 1;
      continue;
    }
    if (isBash && char === '\\') {
      if (closer === '`' && next === '`') throw new Denied('crase escapada em substituição.');
      i += 1;
      if (command[i] === '\r') i += 1;
      if (command[i] !== '\n' && command[i] !== undefined) current = `${current ?? ''}${command[i]}`;
      continue;
    }
    if (char === '{' && (current === null || !isBash)) {
      pushSegment('{');
      continue;
    }
    if (char === '}' && (!isBash || !current?.includes('{'))) {
      pushSegment('}');
      continue;
    }
    if (char === '(') {
      depth += 1;
      pushSegment('(');
      segments.push(GROUP_OPEN);
      continue;
    }
    if (char === ')') {
      if (depth === 0) {
        if (closer !== ')') throw new Denied(') sem abertura no comando.');
        pushSegment(null);
        if (pendingHeredocs.length) throw new Denied('heredoc sem fechamento na substituição.');
        return { segments, end: i };
      }
      depth -= 1;
      pushSegment(')');
      segments.push(GROUP_CLOSE);
      continue;
    }
    if (char === '\n') {
      pushSegment(';');
      if (pendingHeredocs.length) i = skipHeredocs(i);
      continue;
    }
    if (char === ';') {
      pushSegment(';');
      continue;
    }
    if (char === '|') {
      if (next === '|') i += 1;
      pushSegment(next === '|' ? '||' : '|');
      continue;
    }
    if (char === '&') {
      // 2>&1 e &> não separam comandos.
      if (command[i - 1] === '>' || next === '>') {
        current = `${current ?? ''}&`;
      } else if (next === '&') {
        i += 1;
        pushSegment('&&');
      } else {
        if (!isBash && /^&\s*[($]/.test(command.slice(i))) throw new Denied('& com nome calculado não é analisado.');
        pushSegment('&');
      }
      continue;
    }
    if (char === '<' && !isBash && next === '#') throw new Denied('comentário <# #> não é analisado.');
    if (char === '<' && next === '<') {
      pushToken();
      if (command[i + 2] === '<') {
        tokens.push('<');
        i += 2;
        continue;
      }
      const heredoc = /^<<-?[ \t]*(?:'([^'\n]+)'|"([^"\n]+)"|\\?([\w.-]+))/.exec(command.slice(i));
      if (!heredoc) throw new Denied('heredoc sem marcador.');
      pendingHeredocs.push({ marker: heredoc[1] ?? heredoc[2] ?? heredoc[3], quoted: heredoc[3] === undefined });
      i += heredoc[0].length - 1;
      continue;
    }
    if (char === '>' || char === '<') {
      // Redirecionamento vira um token próprio, para ler o destino; o descritor (2>) é descartado.
      if (current !== null && /^\d*&?$/.test(current)) current = null;
      pushToken();
      if (char === '<' && next === '>') {
        i += 1;
        tokens.push('>');
      } else {
        if (char === '>' && next === '>') i += 1;
        tokens.push(char);
      }
      continue;
    }
    if (/\s/.test(char)) {
      pushToken();
      continue;
    }
    current = `${current ?? ''}${char}`;
  }
  if (quote) throw new Denied('aspas sem fechamento no comando.');
  if (closer) throw new Denied(`${closer === ')' ? '$(' : 'crase'} sem fechamento no comando.`);
  if (depth !== 0) throw new Denied('( sem fechamento no comando.');
  if (pendingHeredocs.length) throw new Denied(`heredoc ${pendingHeredocs[0].marker} sem fechamento.`);
  pushSegment(null);
  return { segments, end: i };
}

function programName(token) {
  return basename(token.replace(/\\/g, '/')).replace(/\.(exe|cmd|bat|ps1)$/i, '').toLowerCase();
}

// Variáveis que o Reviewer pode definir antes do comando: só apontam a instalação ou mudam a saída,
// sem trocar o programa que roda (ao contrário de PAGER, NODE_OPTIONS, DOTNET_STARTUP_HOOKS, GIT_*).
const REVIEWER_SAFE_VARIABLES = new Set(['DOTNET_ROOT', 'DOTNET_ROLL_FORWARD', 'DOTNET_NOLOGO', 'DOTNET_CLI_TELEMETRY_OPTOUT', 'CI', 'NO_COLOR', 'FORCE_COLOR']);

function isHarmlessAssignment(token) {
  const eq = token.indexOf('=');
  const name = token.slice(0, eq);
  const value = token.slice(eq + 1);
  // Valor simples: caminho ou palavra, com $VAR permitido; sem $( ), crase, ${ } nem separadores.
  return REVIEWER_SAFE_VARIABLES.has(name) && /^(?:[\w./:\\~+-]|\$[A-Za-z_]\w*)*$/.test(value);
}

// Tira palavras reservadas, atribuições e prefixos como env e sudo.
function stripPrefixes(tokens, agent) {
  let rest = tokens;
  for (;;) {
    for (;;) {
      if (rest.length && RESERVED_WORDS.has(rest[0].toLowerCase())) {
        rest = rest.slice(1);
      } else if (rest.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(rest[0])) {
        if (/^GIT_/i.test(rest[0])) throw new Denied('variáveis GIT_* não são permitidas.');
        if (agent === 'reviewer' && !isHarmlessAssignment(rest[0])) {
          throw new Denied(`o Reviewer só define antes do comando as variáveis ${[...REVIEWER_SAFE_VARIABLES].join(', ')}, com valor simples.`);
        }
        rest = rest.slice(1);
      } else if (rest.length > 1 && /^\$[A-Za-z_]\w*$/.test(rest[0]) && rest[1] === '=') {
        // $x = valor, no PowerShell.
        rest = rest.slice(2);
      } else {
        break;
      }
    }
    if (!rest.length || !WRAPPERS.has(programName(rest[0]))) return rest;
    if (rest[1]?.startsWith('-')) throw new Denied(`${rest[0]} com opção esconde o comando; rode o comando direto.`);
    if (programName(rest[0]) === 'xargs' && ['git', 'gh'].includes(programName(rest[1] ?? ''))) throw new Denied('xargs monta o comando git ou gh na execução; rode o comando direto.');
    if (agent === 'reviewer' && programName(rest[0]) === 'xargs' && programName(rest[1] ?? '') === 'npx') throw new Denied('xargs monta o comando npx na execução; rode o comando direto.');
    rest = rest.slice(1);
  }
}

// Devolve o comando de bash -c e equivalentes. Sem ele, nega: a entrada viria de pipe, arquivo ou forma codificada.
function innerShellCommand(program, args) {
  const usage = `${program} sem comando analisável; use ${program} -c "..." ou rode o comando direto.`;
  for (let i = 0; i < args.length; i += 1) {
    if (program === 'cmd') {
      const slash = /^\/[ck](.*)$/is.exec(args[i]);
      if (slash) {
        const inner = [slash[1], ...args.slice(i + 1)].join(' ').trim();
        if (/[\^%'#]/.test(inner)) throw new Denied('cmd com ^, %, aspas simples ou # não é analisado.');
        if (inner) return inner;
      }
    } else if (program === 'powershell' || program === 'pwsh') {
      if (/^-c(o(m(m(a(n(d)?)?)?)?)?)?$/i.test(args[i])) {
        const inner = args.slice(i + 1).join(' ');
        if (inner && inner.trim() !== '-') return inner;
      }
    } else if (/^-[a-z]*c[a-z]*$/i.test(args[i])) {
      const rest = args.slice(i + 1);
      if (rest[0] === '--') rest.shift();
      if (rest.length > 1) throw new Denied(`${program} -c com argumentos posicionais não é analisado.`);
      if (rest.length === 1) return rest[0];
    }
  }
  throw new Denied(usage);
}

function parseGit(args, cwd, agent) {
  const directories = [];
  let i = 0;
  while (i < args.length && args[i].startsWith('-')) {
    const [name, attached] = args[i].split(/=(.*)/s);
    if (GIT_VALUE_OPTIONS.has(name)) {
      const value = attached ?? args[i + 1];
      if (value === undefined) throw new Denied(`git ${name} sem valor.`);
      if (name === '-C') directories.push(value);
      if (name === '-c') {
        if (agent === 'reviewer') throw new Denied('o Reviewer não usa git -c.');
        if (!GIT_SAFE_CONFIG.test(value)) throw new Denied(`git -c ${value} pode mudar o que o comando faz.`);
      }
      i += attached === undefined ? 2 : 1;
    } else if (GIT_BOOLEAN_OPTIONS.has(name)) {
      i += 1;
    } else {
      throw new Denied(`opção global do git não reconhecida: ${name}.`);
    }
  }
  const subcommand = args[i] ?? '';
  if (!/^[a-z0-9-]*$/.test(subcommand)) throw new Denied(`subcomando do git calculado pelo shell: ${subcommand}.`);
  let directory = cwd;
  for (const value of directories) directory = directory ? resolve(directory, toNativePath(value)) : null;
  return { directory, changedDirectory: directories.length > 0, subcommand, rest: args.slice(i + 1) };
}

function currentBranch(cwd) {
  if (!cwd) throw new Denied('a pasta atual do comando não é conhecida.');
  try {
    return execFileSync('git', ['symbolic-ref', '--short', '-q', 'HEAD'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000 }).trim();
  } catch (error) {
    if (error.status === 1) return ''; // HEAD destacado
    throw new Denied(`não foi possível saber a branch atual em ${cwd}.`);
  }
}

// Ação do gh sem as opções de repositório, que podem vir antes dela.
function ghPositionals(args) {
  const positionals = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '-R' || args[i] === '--repo') i += 1;
    else if (!args[i].startsWith('-')) positionals.push(args[i]);
  }
  return positionals;
}

function checkGhApi(args) {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const shortMethod = /^-[a-zA-Z]*X(.*)$/.exec(arg);
    const method = shortMethod ? shortMethod[1] || args[i + 1] : arg === '--method' ? args[i + 1] : /^--method=(.+)$/.exec(arg)?.[1];
    if (method && method.toUpperCase() !== 'GET') throw new Denied(`gh api com ${method} altera estado.`);
    if (/^-[a-zA-Z]*[fF]/.test(arg) || /^--(field|raw-field|input)(=|$)/.test(arg)) throw new Denied('gh api com campos ou corpo altera estado.');
  }
}

function checkGh(agent, args) {
  const [group, action] = ghPositionals(args);
  if (group === 'api') {
    checkGhApi(args);
    return;
  }
  if (agent === 'reviewer') {
    if (!Object.hasOwn(GH_READS, group ?? '') || !GH_READS[group].has(action)) {
      throw new Denied(`o Reviewer só lê; gh ${group ?? ''} ${action ?? ''} não está liberado.`);
    }
    return;
  }
  if (group === 'pr' && ['create', 'new', 'merge'].includes(action)) throw new Denied(`gh pr ${action} é da sessão principal e do usuário.`);
}

function checkGitBranchListing(args) {
  const hasList = args.includes('--list') || args.includes('-l');
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (/^(--contains|--no-contains|--merged|--no-merged|--points-at|--sort|--format)$/.test(arg)) {
      i += 1;
    } else if (arg.startsWith('-')) {
      if (!/^(-a|-r|-v|-vv|-l|--all|--remotes|--list|--show-current|--verbose|--no-color|--color(=.*)?|--sort=.*|--format=.*|--contains=.*|--merged=.*|--no-merged=.*)$/.test(arg)) {
        throw new Denied(`este agente só lista branches; ${arg} não está liberado.`);
      }
    } else if (!hasList) {
      throw new Denied('este agente só lista branches.');
    }
  }
}

function checkReadOnlyGit(agent, { subcommand, rest }) {
  const allowed = agent === 'reviewer' ? GIT_READS : ARCHITECT_GIT;
  if (!allowed.has(subcommand)) throw new Denied(`git ${subcommand} não está liberado para este agente.`);
  if (subcommand === 'branch') checkGitBranchListing(rest);
  if (subcommand === 'remote' && rest.some((arg) => arg !== '-v' && arg !== '--verbose')) throw new Denied('este agente só lista remotos.');
  if (subcommand === 'reflog' && /^(expire|delete)$/.test(rest[0] ?? '')) throw new Denied('este agente só lê o reflog.');
}

// Operandos de um comando, incluindo o valor colado a uma opção (--x=valor, -X:valor).
function operands(args) {
  return args.flatMap((arg) => {
    if (!arg.startsWith('-')) return [arg];
    const attached = /^--?[A-Za-z][\w-]*[=:](.+)$/s.exec(arg);
    return attached ? [attached[1]] : [];
  });
}

function checkDeveloperGit(parsed, state, projectDir) {
  const { directory, subcommand, rest } = parsed;
  if (!DEVELOPER_GIT.has(subcommand)) throw new Denied(`git ${subcommand} não está liberado para o Developer.`);
  if (subcommand === 'clean') throw new Denied('o Developer não usa git clean.');
  if (subcommand === 'reset' && rest.some((arg) => /^--h(a(r(d)?)?)?$/.test(arg))) throw new Denied('o Developer não usa git reset --hard.');
  if (subcommand === 'pull' && rest.some((arg) => /^(-[a-z]*r[a-z]*|--reb(a(s(e)?)?)?(=.*)?)$/.test(arg))) throw new Denied('o Developer não usa git rebase.');

  const main = CONFIG.branchPrincipal;
  const mainPattern = escapeRegExp(main);
  const movesMain = (subcommand === 'branch' && rest.includes(main) && rest.some((arg) => /^(-[a-zA-Z]*[fdDmMcC]|--(for|del|mov|cop))/.test(arg)))
    || (subcommand === 'fetch' && rest.some((arg) => new RegExp(`:(refs\\/heads\\/)?${mainPattern}$`).test(arg)))
    || ((subcommand === 'checkout' || subcommand === 'switch') && rest.some((arg) => new RegExp(`^(-[BC]|--force-create=?)${mainPattern}$`).test(arg)))
    || ((subcommand === 'checkout' || subcommand === 'switch') && rest.includes(main) && rest.some((arg) => /^(-B|-C|--force-create)$/.test(arg)));
  if (movesMain) throw new Denied(`git ${subcommand} altera a ${main}.`);

  if (subcommand === 'checkout' || subcommand === 'switch') {
    const separator = rest.indexOf('--');
    const before = separator === -1 ? rest : rest.slice(0, separator);
    const paths = separator === -1 ? operands(rest) : rest.slice(separator + 1);
    for (const target of paths) checkShellTarget('developer', target, directory, projectDir, separator !== -1);
    // Só uma branch nova, com nome literal, deixa claro onde o commit seguinte cai.
    const created = before.findIndex((arg) => arg === '-b' || arg === '-c');
    if (created !== -1 && before[created + 1] && before[created + 1] !== main) state.branch = before[created + 1];
    else if (separator === -1 || before.length) state.branch = 'desconhecida';
  }
  if (subcommand === 'rm' || subcommand === 'mv' || subcommand === 'restore') {
    for (const target of operands(rest)) checkShellTarget('developer', target, directory, projectDir, true);
  }
  if (['am', 'cherry-pick', 'commit', 'merge', 'pull', 'revert'].includes(subcommand)) {
    if (state.branch === 'desconhecida') throw new Denied(`este comando muda de branch antes de git ${subcommand}; rode em comandos separados.`);
    const branch = state.branch ?? currentBranch(directory);
    if (branch === main) throw new Denied(`git ${subcommand} com a branch atual em ${main} não é permitido.`);
  }
}

function checkGit(agent, args, state, projectDir) {
  const parsed = parseGit(args, state.cwd, agent);
  const { directory, subcommand, rest } = parsed;

  if (subcommand === 'push' || subcommand === 'send-pack' || (subcommand === 'subtree' && rest.includes('push'))) {
    throw new Denied('git push é da sessão principal.');
  }
  if (rest.some((arg) => /^(--out|--ext-diff|--open|-O)/.test(arg))) throw new Denied('opção do git que grava arquivo ou executa programa.');
  if (agent !== 'reviewer' && !GIT_PURE_READS.includes(subcommand)) {
    if (!directory) throw new Denied('a pasta atual do comando não é conhecida.');
    if (!isInside(canonical(resolve(projectDir)), canonical(directory))) throw new Denied(`git ${subcommand} fora da pasta da demanda.`);
  }
  if (agent === 'developer') checkDeveloperGit(parsed, state, projectDir);
  else checkReadOnlyGit(agent, parsed);
}

function toNativePath(path) {
  if (process.platform !== 'win32') return path;
  // No Windows, o Git Bash escreve C:\pasta como /c/pasta, e pontos e espaços finais são ignorados em cada parte do caminho.
  const match = /^\/([a-zA-Z])(\/.*)?$/.exec(path);
  const native = match ? `${match[1]}:${match[2] ?? '/'}` : path;
  return native.replace(/(?<=[^./\\:])[. ]+(?=[/\\]|$)/g, '');
}

// Resolve links e nomes curtos até o ancestral que existe, para a comparação valer no disco.
function canonical(path) {
  let existing = path;
  const missing = [];
  while (!existsSync(existing)) {
    let isBrokenLink = false;
    try {
      isBrokenLink = lstatSync(existing).isSymbolicLink();
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw new Denied(`caminho não verificável: ${path}.`);
    }
    if (isBrokenLink) throw new Denied(`link quebrado no caminho: ${path}.`);
    const parent = dirname(existing);
    if (parent === existing) return path;
    missing.unshift(basename(existing));
    existing = parent;
  }
  return join(realpathSync.native(existing), ...missing);
}

function isInside(parent, child) {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function checkWritePath(agent, target, cwd, projectDir, destructive = false) {
  if (agent === 'reviewer') throw new Denied('o Reviewer não escreve arquivos.');
  const native = toNativePath(target);
  if (!cwd && !isAbsolute(native)) throw new Denied(`a pasta atual do comando não é conhecida; negado: ${target}.`);
  const absolute = canonical(resolve(cwd ?? '', native));
  const project = canonical(resolve(projectDir));
  if (agent === 'architect') {
    if (!isInside(join(project, ...CONFIG.pastaDemandas.split(/[/\\]/)), absolute)) {
      throw new Denied(`o Arquiteto só escreve em ${CONFIG.pastaDemandas}/; negado: ${target}.`);
    }
    return;
  }
  if (!isInside(project, absolute)) throw new Denied(`o Developer só escreve na pasta da demanda; negado: ${target}.`);
  const handoff = join(project, ...CONFIG.pastaHandoff.split(/[/\\]/));
  if (isInside(handoff, absolute) || (destructive && isInside(absolute, handoff))) throw new Denied(`${CONFIG.pastaHandoff}/ é somente leitura para o Developer.`);
}

// Destino vindo de um comando de shell: pode ter til, variável ou curinga, que o Edit e o Write não têm.
function checkShellTarget(agent, target, cwd, projectDir, destructive) {
  if (agent === 'reviewer') throw new Denied('o Reviewer não escreve arquivos.');
  if (target.startsWith('~')) throw new Denied(`destino com ~ não é permitido: ${target}.`);
  if (/[$%{}]/.test(target)) throw new Denied(`destino calculado pelo shell não é permitido: ${target}.`);
  const glob = target.search(/[*?[]/);
  if (glob === -1) {
    checkWritePath(agent, target, cwd, projectDir, destructive);
    return;
  }
  if (target.slice(glob).includes('..')) throw new Denied(`destino com .. depois de curinga não é permitido: ${target}.`);
  // Com curinga, vale a pasta literal antes dele, e ela não pode conter o que é protegido.
  const prefix = target.slice(0, glob);
  checkWritePath(agent, prefix.endsWith('/') || prefix.endsWith('\\') ? prefix : dirname(prefix || '.'), cwd, projectDir, true);
}

function outputOptionTargets(args, short) {
  const targets = [];
  args.forEach((arg, i) => {
    const cluster = new RegExp(`^-[a-zA-Z]*[${short}](.*)$`).exec(arg);
    if (arg.startsWith('--output') || /^-outfile/i.test(arg)) {
      const attached = /[=:](.+)$/.exec(arg);
      targets.push(attached ? attached[1] : args[i + 1] ?? '');
    } else if (cluster) {
      targets.push(cluster[1] || (args[i + 1] ?? ''));
    }
  });
  return targets;
}

function writeTargets(program, args) {
  if (program === 'sed' && args.some((arg) => /(^|[\s;}\d/])w\s+\S/.test(arg))) throw new Denied('sed com w grava em arquivo.');
  if (program === 'sed') return args.some((arg) => /^-[A-Za-z]*i/.test(arg) || arg.startsWith('--in-place')) ? args.filter((arg) => !arg.startsWith('-')).slice(1) : [];
  if (program === 'dd') return args.filter((arg) => arg.startsWith('of=')).map((arg) => arg.slice(3));
  if (program === 'curl' || program === 'wget') return outputOptionTargets(args, program === 'curl' ? 'o' : 'OP');
  if (program === 'invoke-webrequest' || program === 'iwr') return outputOptionTargets(args, '').slice(0, 1);
  if (program === 'sort') return outputOptionTargets(args, 'o');
  if (COPY_COMMANDS.has(program)) {
    // A origem pode estar fora, como o .env local; vale o destino.
    const option = args.findIndex((arg) => /^(-t|--target-directory|-d|-de|-des|-dest\w*)$/i.test(arg));
    if (option !== -1) return [args[option + 1] ?? ''];
    const glued = args.find((arg) => /^-t./.test(arg));
    if (glued) return [glued.slice(2)];
    const attached = args.find((arg) => /^(--target-directory=|-dest\w*:)/i.test(arg));
    return attached ? [attached.replace(/^[^=:]*[=:]/, '')] : operands(args).slice(-1);
  }
  return WRITE_COMMANDS.has(program) ? operands(args) : [];
}

// O Reviewer só lê, e alguns programas de leitura gravam ou executam por argumento.
function checkReviewerArguments(program, args) {
  if (REVIEWER_EXTRAS.has(program)) {
    const allowed = REVIEWER_EXTRAS.get(program);
    if (!allowed.has(args[0] ?? '')) throw new Denied(`o Reviewer só usa ${program} ${[...allowed].join(', ')}; ${program} ${args[0] ?? ''} não está liberado.`);
    if (args.some((arg) => /^(-o|--output|--out|-out|--results-directory|--diag)([=:].*)?$/i.test(arg) || /^-o./.test(arg))) {
      throw new Denied(`o Reviewer não usa opções de saída em ${program}.`);
    }
    return;
  }
  if (program === 'npm' && args[0] !== 'test' && args[0] !== 'run') throw new Denied(`o Reviewer só usa npm test e npm run; npm ${args[0] ?? ''} não está liberado.`);
  if (program === 'npx') {
    // Só a checagem de tipos. Sem --no-install, o npx baixaria e executaria um pacote da internet.
    const [flag, tool, noEmit, option, project, ...rest] = args;
    const withProject = (option === '-p' || option === '--project') && project && !project.startsWith('-') && !/[$@`%{}*?[\]]/.test(project) && rest.length === 0;
    const bare = option === undefined && project === undefined;
    if (flag !== '--no-install' || tool !== 'tsc' || noEmit !== '--noEmit' || !(bare || withProject)) {
      throw new Denied('o Reviewer só usa npx --no-install tsc --noEmit, com -p ou --project opcional.');
    }
  }
  if (program === 'sed') {
    const [script] = args.filter((arg) => !arg.startsWith('-'));
    const address = String.raw`(\d+|\$|\/[^/]*\/)`;
    if (!new RegExp(`^(${address}(,${address})?)?p$`).test(script ?? '')) throw new Denied('o Reviewer só usa sed -n com endereço e p.');
  }
  if (program === 'uniq' && args.filter((arg) => !arg.startsWith('-')).length > 1) throw new Denied('uniq com dois arquivos grava no segundo.');
  if (program === 'rg' && args.some((arg) => arg.startsWith('--pre'))) throw new Denied('rg --pre executa um programa.');
}

function checkSegment(agent, rawTokens, state, projectDir, isKnownDirectoryChange) {
  const tokens = [];
  for (let i = 0; i < rawTokens.length; i += 1) {
    if (rawTokens[i] === '<') {
      i += 1;
    } else if (rawTokens[i] === '>') {
      i += 1;
      let target = rawTokens[i];
      if (target === '&') target = rawTokens[++i];
      if (!target) throw new Denied('redirecionamento sem destino.');
      if (/^&\d*-?$/.test(target) || NULL_DEVICES.has(target.toLowerCase())) continue;
      checkShellTarget(agent, target.replace(/^&/, ''), state.cwd, projectDir, false);
    } else {
      tokens.push(rawTokens[i]);
    }
  }

  const words = stripPrefixes(tokens, agent);
  if (!words.length) return;
  if (COMPUTED_WORD.test(words[0])) throw new Denied(`nome de programa calculado pelo shell: ${words[0]}.`);
  const program = programName(words[0]);
  const args = words.slice(1);

  if (/^git-/.test(program)) throw new Denied(`${program} executa o Git sem passar pelas regras; use git.`);
  if (agent === 'reviewer' && !REVIEWER_PROGRAMS.has(program) && !REVIEWER_EXTRAS.has(program)) throw new Denied(`o Reviewer só lê; ${program} não está liberado.`);
  if (agent === 'reviewer') checkReviewerArguments(program, args);
  if (OPAQUE_EXECUTORS.has(program)) throw new Denied(`${program} executa algo que a guarda não consegue ler.`);
  if ((program === 'export' || program === 'declare' || program === 'typeset' || program === 'set') && args.some((arg) => /^GIT_/i.test(arg))) {
    throw new Denied('variáveis GIT_* não são permitidas.');
  }
  if (program === 'find' && args.some((arg) => /^-(exec|execdir|ok|okdir|delete|fprint|fls)/.test(arg))) {
    throw new Denied('find que executa ou apaga não é permitido.');
  }
  if (SHELLS.has(program)) {
    const dialect = program === 'powershell' || program === 'pwsh' || program === 'cmd' ? 'powershell' : 'bash';
    const inner = { ...state, dialect };
    checkCommand(agent, innerShellCommand(program, args), inner, projectDir);
    state.branch = inner.branch;
    return;
  }
  if (program === 'eval') {
    checkCommand(agent, args.join(' '), state, projectDir);
    return;
  }
  if (DIRECTORY_COMMANDS.has(program)) {
    // Só cd seguido de && garante que o resto roda na pasta nova.
    const [target] = args;
    const isLiteral = target && !/^[-~]/.test(target) && !/[$%{}*?[]/.test(target);
    state.cwd = isKnownDirectoryChange && state.cwd && isLiteral ? resolve(state.cwd, toNativePath(target)) : null;
    return;
  }
  if (program === 'popd' || program === 'pop-location') {
    state.cwd = null;
    return;
  }
  if (program === 'git') {
    checkGit(agent, args, state, projectDir);
    return;
  }
  if (program === 'gh') {
    checkGh(agent, args);
    return;
  }
  if (!TEXT_PROGRAMS.has(program) && args.some((arg) => ['git', 'gh'].includes(programName(arg)) || /(^|[^\w./-])(git|gh)(\.exe)?(\s|$)/.test(arg))) {
    throw new Denied(`${program} recebe git ou gh de um jeito que a guarda não analisa; rode o comando direto.`);
  }
  for (const target of writeTargets(program, args)) {
    if (!NULL_DEVICES.has(target.toLowerCase())) checkShellTarget(agent, target, state.cwd, projectDir, DESTRUCTIVE_COMMANDS.has(program));
  }
}

function checkParsed(agent, { segments }, state, projectDir) {
  const groups = [];
  let previousOp = null;
  for (const segment of segments) {
    if (segment === GROUP_OPEN) {
      groups.push(state.cwd);
    } else if (segment === GROUP_CLOSE) {
      state.cwd = groups.pop();
    } else {
      for (const inner of segment.nested) {
        // A subshell não muda a pasta do comando de fora, mas o checkout dela muda a branch.
        const { cwd } = state;
        checkParsed(agent, inner, state, projectDir);
        state.cwd = cwd;
      }
      const startsChain = previousOp === null || previousOp === '&&' || previousOp === '(';
      checkSegment(agent, segment, state, projectDir, startsChain && segment.op === '&&');
      previousOp = segment.op;
    }
  }
}

function checkCommand(agent, command, state, projectDir) {
  checkParsed(agent, parseLevel(command, state.dialect, 0, null), state, projectDir);
}

function evaluate(agent, input, projectDir) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Denied('entrada inválida.');
  const { tool_name: tool, tool_input: toolInput, cwd } = input;
  if (!Object.hasOwn(SHELL_DIALECTS, tool ?? '') && !Object.hasOwn(EDIT_TOOLS, tool ?? '')) throw new Denied(`ferramenta não reconhecida: ${tool ?? 'ausente'}.`);
  if (typeof cwd !== 'string' || !cwd) throw new Denied('cwd ausente ou inválido.');

  if (Object.hasOwn(SHELL_DIALECTS, tool)) {
    if (typeof toolInput?.command !== 'string' || !toolInput.command.trim()) throw new Denied('comando ausente.');
    checkCommand(agent, toolInput.command, { cwd, branch: null, dialect: SHELL_DIALECTS[tool] }, projectDir);
    return;
  }
  const target = toolInput?.[EDIT_TOOLS[tool]];
  if (typeof target !== 'string' || !target) throw new Denied('caminho ausente.');
  checkWritePath(agent, target, cwd, projectDir);
}

function samePath(a, b) {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

// Raiz efetiva do projeto. Numa sessão em git worktree, o CLAUDE_PROJECT_DIR é o checkout principal e o cwd é o worktree.
// Vale o worktree do cwd só se ele for do mesmo repositório (mesmo --git-common-dir); em qualquer dúvida, fica o CLAUDE_PROJECT_DIR.
function effectiveProjectDir(projectDir, cwd) {
  if (typeof cwd !== 'string' || !cwd) return projectDir;
  try {
    const revParse = (dir) => {
      const lines = execFileSync('git', ['rev-parse', '--show-toplevel', '--git-common-dir'], {
        cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000,
      }).split(/\r?\n/).filter(Boolean);
      if (lines.length !== 2) throw new Error('saída inesperada do git rev-parse.');
      return { top: canonical(resolve(lines[0])), common: canonical(resolve(dir, lines[1])) };
    };
    const project = revParse(projectDir);
    const current = revParse(cwd);
    if (!samePath(project.common, current.common) || samePath(project.top, current.top)) return projectDir;
    return current.top;
  } catch {
    return projectDir;
  }
}

// Nome do agente do fluxo, vindo do campo agent_type do hook. Aceita "architect" e o nome com namespace "fluxo:architect".
function fluxoAgent(agentType) {
  if (typeof agentType !== 'string') return null;
  const match = /^(?:fluxo:)?(architect|developer|reviewer)$/.exec(agentType);
  return match ? match[1] : null;
}

function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    throw new Denied('entrada que não é JSON válido.');
  }
  // Com argumento, a guarda vale para aquele agente (uso nos testes e em .claude/agents/ de um projeto).
  // Sem argumento (hook do plugin), vale só dentro dos subagentes do fluxo; na sessão principal e nos outros agentes, libera.
  const explicit = process.argv[2];
  if (explicit !== undefined && !AGENTS.has(explicit)) throw new Denied(`agente desconhecido: ${explicit}.`);
  const agent = explicit ?? fluxoAgent(input?.agent_type);
  // Diagnóstico opcional: FLUXO_GUARD_LOG=<arquivo> registra o agent_type recebido e o agente reconhecido.
  if (process.env.FLUXO_GUARD_LOG) {
    try {
      appendFileSync(process.env.FLUXO_GUARD_LOG, `${JSON.stringify({ agent_type: input?.agent_type ?? null, agent, tool: input?.tool_name ?? null })}\n`);
    } catch {
      // O log não pode mudar a decisão.
    }
  }
  if (!agent) return;
  if (!process.env.CLAUDE_PROJECT_DIR) throw new Denied('CLAUDE_PROJECT_DIR não definido.');
  const projectDir = effectiveProjectDir(process.env.CLAUDE_PROJECT_DIR, input?.cwd);
  CONFIG = loadConfig(projectDir);
  evaluate(agent, input, projectDir);
}

try {
  main();
} catch (error) {
  deny(error instanceof Denied ? error.message : `erro inesperado: ${error.message}`);
}
