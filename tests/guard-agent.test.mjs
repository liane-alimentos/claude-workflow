// CA-8 e §Guarda de comandos da spec da demanda 005.
// Roda a guarda como o Claude Code roda: JSON na entrada padrão, agente no argumento.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(ROOT, 'plugins', 'fluxo', 'hooks', 'guard-agent.mjs');

let sandbox;
let project; // pasta da demanda, com a branch atual em feat/teste
let onMain; // repositório com a branch atual em main
let outside; // repositório fora da pasta da demanda

function git(cwd, ...args) {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function makeRepo(path, branch) {
  mkdirSync(path, { recursive: true });
  git(path, 'init', '-q');
  git(path, 'symbolic-ref', 'HEAD', `refs/heads/${branch}`);
  git(path, 'config', 'user.email', 'teste@example.com');
  git(path, 'config', 'user.name', 'Teste');
  writeFileSync(join(path, 'a.txt'), 'a');
  git(path, 'add', '.');
  git(path, 'commit', '-qm', 'inicial');
}

before(() => {
  sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'guard-')));
  project = join(sandbox, 'demanda');
  onMain = join(sandbox, 'na-main');
  outside = join(sandbox, 'fora');
  makeRepo(project, 'feat/teste');
  makeRepo(onMain, 'main');
  makeRepo(outside, 'feat/outra');
});

after(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function runGuard(agent, stdin, { projectDir = project, env = {} } = {}) {
  const childEnv = { ...process.env, ...env };
  if (projectDir === null) delete childEnv.CLAUDE_PROJECT_DIR;
  else childEnv.CLAUDE_PROJECT_DIR = projectDir;
  const args = agent === null ? [GUARD] : [GUARD, agent];
  return spawnSync(process.execPath, args, { input: stdin, env: childEnv, encoding: 'utf8' });
}

function decisionOf(result) {
  assert.equal(result.status, 0, `a guarda deve sair com 0 e decidir pelo JSON. stderr: ${result.stderr}`);
  if (result.stdout.trim() === '') return { decision: 'allow', reason: '' };
  const parsed = JSON.parse(result.stdout);
  const output = parsed.hookSpecificOutput;
  assert.equal(output.hookEventName, 'PreToolUse');
  return { decision: output.permissionDecision, reason: output.permissionDecisionReason };
}

function bash(agent, command, cwd = project) {
  const stdin = JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd, hook_event_name: 'PreToolUse' });
  return decisionOf(runGuard(agent, stdin));
}

function powershell(agent, command, cwd = project) {
  const stdin = JSON.stringify({ tool_name: 'PowerShell', tool_input: { command }, cwd, hook_event_name: 'PreToolUse' });
  return decisionOf(runGuard(agent, stdin));
}

function edit(agent, tool, target) {
  const key = tool === 'NotebookEdit' ? 'notebook_path' : 'file_path';
  const stdin = JSON.stringify({ tool_name: tool, tool_input: { [key]: target }, cwd: project, hook_event_name: 'PreToolUse' });
  return decisionOf(runGuard(agent, stdin));
}

function assertDenied(result, label) {
  assert.equal(result.decision, 'deny', `deveria negar: ${label}`);
  assert.ok(result.reason.length > 0, `a negação precisa de motivo: ${label}`);
}

function assertAllowed(result, label) {
  assert.equal(result.decision, 'allow', `deveria permitir: ${label} (motivo: ${result.reason})`);
}

// Comandos com push em todas as variações que a spec exige.
const PUSH_VARIATIONS = [
  'git push',
  'git push origin feat/teste',
  'git push --force origin feat/teste',
  'git push origin main',
  'git -C pasta push',
  'git --no-pager push',
  'git -c core.pager=cat push',
  'git status && git push',
  'git status; git push',
  'git status || git push',
  'git log | git push',
  'bash -c "git push"',
  "sh -c 'git status && git push origin main'",
  'bash -lc "git push"',
  'echo $(git push)',
  'FOO=1 git push',
  'env FOO=1 git push',
  'git.exe push',
  'powershell -Command "git push"',
];

const GH_WRITES = [
  'gh pr create --title x --body y',
  'gh pr merge 12 --squash',
  'gh api -X POST repos/o/r/issues',
  'gh api --method DELETE repos/o/r/git/refs/heads/x',
  'gh api repos/o/r/issues -f title=x',
  'gh api repos/o/r/issues --input corpo.json',
  'bash -c "gh pr create --title x"',
];

test('developer: todo git push é negado, em todas as variações', () => {
  for (const command of PUSH_VARIATIONS) assertDenied(bash('developer', command), command);
});

test('developer: git rebase, reset --hard e clean são negados', () => {
  for (const command of [
    'git rebase main',
    'git --no-pager rebase -i main',
    'git reset --hard',
    'git reset --hard HEAD~1',
    'git clean -fd',
    'git status && git clean -fdx',
    'bash -c "git reset --hard"',
  ]) {
    assertDenied(bash('developer', command), command);
  }
});

test('developer: gh pr create, gh pr merge e gh api com escrita são negados', () => {
  for (const command of GH_WRITES) assertDenied(bash('developer', command), command);
});

test('developer: merge e commit são negados com a branch atual em main', () => {
  for (const command of ['git merge feat/x', 'git commit -m teste', 'git --no-pager commit -m teste', 'git status && git commit -m teste']) {
    assertDenied(bash('developer', command, onMain), command);
  }
  assertDenied(bash('developer', `git -C "${onMain}" commit -m teste`), 'git -C com a pasta em main');
  assertDenied(bash('developer', `cd "${onMain}" && git commit -m teste`), 'cd para a pasta em main');
  assertDenied(bash('developer', 'git checkout main && git merge feat/x'), 'checkout para main e merge no mesmo comando');
  assertDenied(bash('developer', 'git switch main; git commit -m teste'), 'switch para main e commit no mesmo comando');
});

test('developer: merge e commit são permitidos fora da main', () => {
  assertAllowed(bash('developer', 'git commit -m teste'), 'commit em feat/teste');
  assertAllowed(bash('developer', 'git merge feat/x'), 'merge em feat/teste');
  assertAllowed(bash('developer', `git -C "${project}" commit -m teste`, onMain), 'git -C para pasta fora da main');
});

test('developer: comandos do dia a dia são permitidos', () => {
  for (const command of [
    'git status',
    'git diff --stat',
    'git log --oneline -5',
    'git add .',
    'git reset HEAD a.txt',
    'git checkout -b feat/y',
    'node --test scripts/tests/',
    'npm run test 2>&1',
    'npm run test > /dev/null',
    'gh pr view 12',
    'gh api repos/o/r/pulls',
    'gh api -X GET repos/o/r/pulls',
    'echo "git push"',
    'grep -rn "git push" docs',
  ]) {
    assertAllowed(bash('developer', command), command);
  }
});

test('developer: a ferramenta PowerShell segue as mesmas regras', () => {
  assertDenied(powershell('developer', 'git push origin main'), 'git push no PowerShell');
  assertDenied(powershell('developer', 'git status; git push'), 'composto no PowerShell');
  assertAllowed(powershell('developer', 'git status'), 'git status no PowerShell');
});

test('developer: escrita dentro da pasta da demanda é permitida', () => {
  for (const tool of ['Edit', 'Write', 'NotebookEdit']) {
    assertAllowed(edit('developer', tool, join(project, 'src', 'novo.txt')), `${tool} absoluto`);
  }
  assertAllowed(edit('developer', 'Write', 'scripts/novo.mjs'), 'caminho relativo');
  assertAllowed(edit('developer', 'Write', join(project, 'docs', 'development', '999-x', 'tasks.md')), 'docs da demanda');
});

test('developer: escrita fora da pasta da demanda é negada', () => {
  assertDenied(edit('developer', 'Write', join(outside, 'a.txt')), 'outro repositório');
  assertDenied(edit('developer', 'Edit', join(project, '..', 'fora', 'a.txt')), 'subida com ..');
  assertDenied(edit('developer', 'Write', '../fora/a.txt'), 'relativo com ..');
  assertDenied(edit('developer', 'Write', `${project}-irma/a.txt`), 'pasta com o mesmo prefixo');
  assertDenied(bash('developer', `echo x > "${join(outside, 'a.txt')}"`), 'redirecionamento para fora');
  assertDenied(bash('developer', `rm -rf "${outside}"`), 'rm fora da pasta');
});

test('developer: escrita em docs/handoff é negada', () => {
  assertDenied(edit('developer', 'Write', join(project, 'docs', 'handoff', 'NOVO.md')), 'Write no handoff');
  assertDenied(edit('developer', 'Edit', 'docs/handoff/ANTIGO.md'), 'Edit relativo no handoff');
  assertDenied(bash('developer', 'echo x >> docs/handoff/ANTIGO.md'), 'redirecionamento no handoff');
  assertDenied(bash('developer', 'rm docs/handoff/ANTIGO.md'), 'rm no handoff');
});

test('architect: todo git push, git merge e git rebase são negados', () => {
  for (const command of PUSH_VARIATIONS) assertDenied(bash('architect', command), command);
  for (const command of ['git merge feat/x', 'git rebase main', 'git --no-pager merge feat/x', 'bash -c "git rebase main"']) {
    assertDenied(bash('architect', command), command);
  }
});

test('architect: gh pr create, gh pr merge e gh api com escrita são negados', () => {
  for (const command of GH_WRITES) assertDenied(bash('architect', command), command);
});

test('architect: escrita só em docs/development', () => {
  assertAllowed(edit('architect', 'Write', join(project, 'docs', 'development', '999-x', 'us.md')), 'us.md');
  assertAllowed(edit('architect', 'Edit', 'docs/development/readme.md'), 'kanban');
  assertDenied(edit('architect', 'Edit', join(project, 'src', 'codigo.ts')), 'código');
  assertDenied(edit('architect', 'Write', 'AGENT.md'), 'AGENT.md');
  assertDenied(edit('architect', 'Write', join(project, 'docs', 'handoff', 'NOVO.md')), 'handoff');
  assertDenied(edit('architect', 'Write', join(project, 'docs', 'development-falso', 'x.md')), 'pasta com o mesmo prefixo');
  assertDenied(edit('architect', 'Write', join(project, 'docs', 'development', '..', 'x.md')), 'subida com ..');
  assertDenied(edit('architect', 'Write', join(outside, 'x.md')), 'fora da pasta');
  assertDenied(bash('architect', 'echo x > codigo.ts'), 'redirecionamento para código');
  assertAllowed(bash('architect', 'echo x > docs/development/999-x/nota.md'), 'redirecionamento para docs/development');
});

test('architect: commit e leitura são permitidos', () => {
  for (const command of ['git status', 'git add docs/development', 'git commit -m "docs: us"', 'git log -3', 'gh pr view 12']) {
    assertAllowed(bash('architect', command), command);
  }
});

test('reviewer: toda ferramenta de edição é negada, mesmo dentro da pasta', () => {
  for (const tool of ['Edit', 'Write', 'NotebookEdit']) {
    assertDenied(edit('reviewer', tool, join(project, 'a.txt')), tool);
  }
});

test('reviewer: comandos Git e gh que alteram estado são negados', () => {
  for (const command of [
    ...PUSH_VARIATIONS,
    ...GH_WRITES,
    'git add .',
    'git commit -m x',
    'git checkout main',
    'git switch main',
    'git merge x',
    'git rebase x',
    'git reset HEAD~1',
    'git restore a.txt',
    'git rm a.txt',
    'git mv a.txt b.txt',
    'git clean -fd',
    'git stash',
    'git fetch',
    'git pull',
    'git tag v1',
    'git branch nova',
    'git branch -D velha',
    'git cherry-pick abc',
    'git revert abc',
    'git apply p.diff',
    'git worktree add ../x',
    'git config user.name x',
    'git diff --output=saida.txt',
    'gh pr close 12',
    'gh pr comment 12 --body x',
    'gh pr edit 12 --title x',
    'gh pr review 12 --approve',
    'gh issue create --title x',
    'gh repo delete o/r',
  ]) {
    assertDenied(bash('reviewer', command), command);
  }
});

test('reviewer: escrita por redirecionamento é negada', () => {
  assertDenied(bash('reviewer', 'echo x > a.txt'), 'redirecionamento');
  assertDenied(bash('reviewer', 'git log > a.txt'), 'redirecionamento de git log');
  assertDenied(bash('reviewer', 'rm a.txt'), 'rm');
});

test('reviewer: comandos de leitura são permitidos', () => {
  for (const command of [
    'git status --porcelain',
    'git diff origin/main...HEAD',
    'git log --oneline --follow -- a.txt',
    'git show HEAD:a.txt',
    'git blame a.txt',
    'git rev-parse HEAD',
    'git merge-base origin/main HEAD',
    'git ls-files',
    'git grep -n "CA-1"',
    'git branch --show-current',
    'git branch -a',
    'git --no-pager log -3',
    'git -C pasta status',
    'gh pr view 12',
    'gh pr diff 12',
    'gh pr checks 12',
    'gh api repos/o/r/pulls/12',
    'node --test scripts/tests/',
    'node scripts/check-agents.mjs 2>&1',
    'git log 2>/dev/null',
  ]) {
    assertAllowed(bash('reviewer', command), command);
  }
});

test('falha fechada: entrada que a guarda não entende é negada', () => {
  const valid = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git status' }, cwd: project });
  assertDenied(decisionOf(runGuard('developer', 'isto não é json')), 'JSON inválido');
  assertDenied(decisionOf(runGuard('developer', '')), 'entrada vazia');
  assertDenied(decisionOf(runGuard('developer', '[]')), 'JSON sem objeto');
  assertDenied(decisionOf(runGuard('developer', '{}')), 'sem tool_name');
  assertDenied(decisionOf(runGuard('developer', JSON.stringify({ tool_name: 'Bash', tool_input: {}, cwd: project }))), 'Bash sem comando');
  assertDenied(decisionOf(runGuard('developer', JSON.stringify({ tool_name: 'Write', tool_input: {}, cwd: project }))), 'Write sem caminho');
  assertDenied(decisionOf(runGuard('developer', JSON.stringify({ tool_name: 'Desconhecida', tool_input: {}, cwd: project }))), 'ferramenta desconhecida');
  assertDenied(decisionOf(runGuard('developer', valid, { projectDir: null })), 'sem CLAUDE_PROJECT_DIR');
});

test('falha fechada: agente desconhecido no argumento é negado', () => {
  const valid = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git status' }, cwd: project });
  assertDenied(decisionOf(runGuard('estranho', valid)), 'agente desconhecido');
});

// Modo plugin: sem argumento, o agente vem de agent_type, e fora dos agentes do fluxo a guarda não interfere.
function viaAgentType(agentType, command, { projectDir = project, cwd = project } = {}) {
  const payload = { tool_name: 'Bash', tool_input: { command }, cwd, hook_event_name: 'PreToolUse' };
  if (agentType !== undefined) payload.agent_type = agentType;
  return decisionOf(runGuard(null, JSON.stringify(payload), { projectDir }));
}

test('plugin: sessão principal e outros agentes não passam pela guarda', () => {
  assertAllowed(viaAgentType(undefined, 'git push origin main'), 'sessão principal, sem agent_type');
  assertAllowed(viaAgentType('Explore', 'git push origin main'), 'agente que não é do fluxo');
  assertAllowed(viaAgentType('outro:reviewer', 'touch x'), 'reviewer de outro plugin');
});

test('plugin: agentes do fluxo pelo agent_type, com e sem namespace', () => {
  for (const agentType of ['reviewer', 'fluxo:reviewer']) {
    assertDenied(viaAgentType(agentType, 'touch x'), `${agentType} escrevendo`);
    assertAllowed(viaAgentType(agentType, 'git status'), `${agentType} lendo`);
  }
  for (const agentType of ['developer', 'fluxo:developer']) assertDenied(viaAgentType(agentType, 'git push'), `${agentType} push`);
  for (const agentType of ['architect', 'fluxo:architect']) assertDenied(viaAgentType(agentType, 'touch codigo.ts'), `${agentType} fora da pasta`);
});

test('fluxo.json: branch principal e pastas configuráveis', () => {
  const custom = join(sandbox, 'custom');
  const customMaster = join(sandbox, 'custom-master');
  makeRepo(custom, 'feat/teste');
  makeRepo(customMaster, 'master');
  const config = JSON.stringify({ branchPrincipal: 'master', pastaDemandas: 'docs/demandas', pastaHandoff: 'docs/retomada' });
  for (const dir of [custom, customMaster]) {
    mkdirSync(join(dir, '.claude'), { recursive: true });
    writeFileSync(join(dir, '.claude', 'fluxo.json'), `\uFEFF${config}`);
  }
  const run = (agent, command, projectDir = custom) => decisionOf(runGuard(agent, JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: projectDir }), { projectDir }));
  const write = (agent, file) => decisionOf(runGuard(agent, JSON.stringify({ tool_name: 'Write', tool_input: { file_path: file }, cwd: custom }), { projectDir: custom }));

  assertDenied(run('developer', 'git commit -m x', customMaster), 'commit com a branch atual em master');
  assertAllowed(run('developer', 'git commit -m x', custom), 'commit fora da master');
  assertDenied(run('developer', 'git branch -f master HEAD'), 'mover a master');
  assertDenied(run('developer', 'git checkout -B master'), 'recriar a master');
  assertDenied(run('developer', 'git fetch . HEAD:master'), 'fetch para a master');
  assertAllowed(write('architect', 'docs/demandas/001-x/us.md'), 'arquiteto na pasta configurada');
  assertDenied(write('architect', 'docs/development/001-x/us.md'), 'arquiteto na pasta padrão, que aqui não vale');
  assertDenied(write('developer', 'docs/retomada/H.md'), 'developer no handoff configurado');
  assertAllowed(write('developer', 'docs/handoff/H.md'), 'docs/handoff não é protegido quando a config aponta outra pasta');
});

test('fluxo.json: campos da publicação (pastaReleases e apps) não mudam a guarda', () => {
  const dir = join(sandbox, 'com-releases');
  makeRepo(dir, 'feat/teste');
  mkdirSync(join(dir, '.claude'), { recursive: true });
  writeFileSync(join(dir, '.claude', 'fluxo.json'), JSON.stringify({
    pastaDemandas: 'docs/demandas',
    pastaReleases: 'docs/releases',
    apps: { api: 'apps/api', web: 'apps/web' },
  }));
  const write = (agent, file) => decisionOf(runGuard(agent, JSON.stringify({ tool_name: 'Write', tool_input: { file_path: file }, cwd: dir }), { projectDir: dir }));
  assertAllowed(write('architect', 'docs/demandas/001-x/spec.md'), 'arquiteto na pasta de demandas');
  assertDenied(write('architect', 'docs/releases/pendentes/001-x.md'), 'a nota de implantação é da sessão, não do Arquiteto');
  assertAllowed(write('developer', 'apps/api/x.ts'), 'developer na pasta da demanda');
});

test('worktree: a raiz é o worktree do cwd quando ele é do mesmo repositório', () => {
  // Como no Claude Desktop: CLAUDE_PROJECT_DIR no checkout principal, cwd num worktree dentro dele.
  const main = join(sandbox, 'principal');
  makeRepo(main, 'main');
  mkdirSync(join(main, '.claude'), { recursive: true });
  writeFileSync(join(main, '.claude', 'fluxo.json'), JSON.stringify({ pastaDemandas: 'docs/demandas' }));
  git(main, 'add', '.');
  git(main, 'commit', '-qm', 'fluxo');
  const worktree = join(main, '.claude', 'worktrees', 'wt');
  git(main, 'worktree', 'add', '-q', '-b', 'feat/wt', worktree);
  // A config é lida do worktree: aqui ele muda o handoff sem commit, e o checkout principal não.
  writeFileSync(join(worktree, '.claude', 'fluxo.json'), JSON.stringify({ pastaDemandas: 'docs/demandas', pastaHandoff: 'docs/retomada' }));
  const outsideWorktree = join(sandbox, 'fora-wt');
  git(outside, 'worktree', 'add', '-q', '-b', 'feat/fora-wt', outsideWorktree);

  const write = (agent, file, cwd = worktree, tool = 'Write') =>
    decisionOf(runGuard(agent, JSON.stringify({ tool_name: tool, tool_input: { file_path: file }, cwd }), { projectDir: main }));
  const run = (agent, command, cwd = worktree) =>
    decisionOf(runGuard(agent, JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd }), { projectDir: main }));

  assertAllowed(write('architect', join(worktree, 'docs', 'demandas', '001-x', 'us.md')), 'architect: us.md absoluto no worktree');
  assertAllowed(write('architect', 'docs/demandas/README.md', worktree, 'Edit'), 'architect: kanban relativo no worktree');
  assertAllowed(write('architect', join(worktree, 'docs', 'demandas', 'README.md').replaceAll('\\', '/'), worktree, 'Edit'), 'architect: barras normais');
  assertAllowed(run('architect', 'echo x > docs/demandas/001-x/nota.md'), 'architect: redirecionamento no worktree');
  assertDenied(write('architect', join(worktree, 'src', 'codigo.ts')), 'architect: código no worktree');
  assertDenied(write('architect', join(main, 'docs', 'demandas', '001-x', 'us.md')), 'architect: checkout principal a partir do worktree');

  assertAllowed(write('developer', join(worktree, 'src', 'novo.ts')), 'developer: dentro do worktree');
  assertAllowed(write('developer', 'src/novo.ts'), 'developer: relativo no worktree');
  assertAllowed(run('developer', 'git commit -m x'), 'developer: commit na branch do worktree');
  assertDenied(write('developer', join(main, 'src', 'novo.ts')), 'developer: checkout principal a partir do worktree');
  assertDenied(write('developer', join(main, 'a.txt')), 'developer: arquivo do checkout principal');
  assertDenied(run('developer', `echo x > "${join(main, 'a.txt')}"`), 'developer: redirecionamento para o checkout principal');
  assertDenied(write('developer', join(worktree, 'docs', 'retomada', 'H.md')), 'developer: handoff do fluxo.json do worktree');
  assertAllowed(write('developer', join(worktree, 'docs', 'handoff', 'H.md')), 'developer: o handoff do checkout principal não vale no worktree');

  // Worktree de outro repositório não vira raiz: vale o CLAUDE_PROJECT_DIR, e escrever nele é negado.
  assertDenied(write('architect', join(outsideWorktree, 'docs', 'demandas', 'x.md'), outsideWorktree), 'architect: worktree de outro repositório');
  assertDenied(write('developer', join(outsideWorktree, 'a.txt'), outsideWorktree), 'developer: worktree de outro repositório');
  assertDenied(run('developer', 'git commit -m x', outsideWorktree), 'developer: commit em worktree de outro repositório');

  // Sem worktree, o checkout principal segue como antes.
  assertAllowed(write('architect', join(main, 'docs', 'demandas', '001-x', 'us.md'), main), 'architect: checkout principal com cwd nele');
  // cwd fora de Git: comportamento anterior.
  const plain = join(sandbox, 'sem-git');
  mkdirSync(plain, { recursive: true });
  assertDenied(write('developer', join(plain, 'a.txt'), plain), 'developer: pasta sem Git');
});

test('worktree: o handoff do worktree continua somente leitura para o developer', () => {
  const main = join(sandbox, 'principal-handoff');
  makeRepo(main, 'main');
  const worktree = join(main, '.claude', 'worktrees', 'wt');
  git(main, 'worktree', 'add', '-q', '-b', 'feat/wt', worktree);
  const write = (file) => decisionOf(runGuard('developer', JSON.stringify({ tool_name: 'Write', tool_input: { file_path: file }, cwd: worktree }), { projectDir: main }));
  const run = (command) => decisionOf(runGuard('developer', JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: worktree }), { projectDir: main }));
  assertDenied(write(join(worktree, 'docs', 'handoff', 'NOVO.md')), 'Write no handoff do worktree');
  assertDenied(write('docs/handoff/NOVO.md'), 'Write relativo no handoff do worktree');
  assertDenied(run('rm -rf docs'), 'rm amplo que apaga o handoff do worktree');
  assertAllowed(write(join(worktree, 'docs', 'development', '001-x', 'tasks.md')), 'docs da demanda no worktree');
});

test('fluxo.json: reviewerComandos libera só os subcomandos listados', () => {
  const dir = join(sandbox, 'reviewer-extra');
  const plain = join(sandbox, 'reviewer-plain');
  makeRepo(dir, 'feat/teste');
  makeRepo(plain, 'feat/teste');
  mkdirSync(join(dir, '.claude'), { recursive: true });
  writeFileSync(join(dir, '.claude', 'fluxo.json'), JSON.stringify({ reviewerComandos: { dotnet: ['build', 'test'] } }));
  const run = (command, projectDir = dir) => decisionOf(runGuard('reviewer', JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: projectDir }), { projectDir }));

  assertAllowed(run('dotnet build apps/api/src/api/Api'), 'dotnet build');
  assertAllowed(run('dotnet test .tmp/testes/T.csproj --no-restore'), 'dotnet test');
  assertAllowed(run('cd apps/api && dotnet test'), 'dotnet test depois de cd');
  assertDenied(run('dotnet ef database update'), 'dotnet ef');
  assertDenied(run('dotnet add package X'), 'dotnet add');
  assertDenied(run('dotnet'), 'dotnet sem subcomando');
  assertDenied(run('dotnet build -o ../fora'), 'dotnet build com saída fora');
  assertDenied(run('dotnet build', plain), 'sem a configuração, dotnet segue negado');
  assertDenied(run('touch x'), 'a configuração não libera escrita');
});

test('reviewer: variáveis de ambiente inofensivas antes do comando são aceitas', () => {
  const dir = join(sandbox, 'reviewer-variaveis');
  makeRepo(dir, 'feat/teste');
  mkdirSync(join(dir, '.claude'), { recursive: true });
  writeFileSync(join(dir, '.claude', 'fluxo.json'), JSON.stringify({ reviewerComandos: { dotnet: ['build', 'test'] } }));
  const run = (command) => decisionOf(runGuard('reviewer', JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: dir }), { projectDir: dir }));

  assertAllowed(run('DOTNET_ROOT=$HOME/.dotnet dotnet test .tmp/testes/T.csproj'), 'DOTNET_ROOT com $HOME');
  assertAllowed(run('DOTNET_ROOT=C:/Users/x/.dotnet DOTNET_ROLL_FORWARD=Major dotnet build apps/api'), 'duas variáveis do dotnet');
  assertAllowed(run('cd apps/api && DOTNET_ROOT="$HOME/.dotnet" dotnet test'), 'DOTNET_ROOT entre aspas depois de cd');
  assertAllowed(run('CI=1 git status'), 'CI=1 com leitura');
  assertAllowed(run('NO_COLOR=1 git diff origin/main...HEAD'), 'NO_COLOR com leitura');

  // A variável liberada não libera o comando: o resto segue as regras do Reviewer.
  assertDenied(run('DOTNET_ROOT=$HOME/.dotnet dotnet ef database update'), 'DOTNET_ROOT com subcomando não liberado');
  assertDenied(run('CI=1 git push'), 'CI=1 com push');
  assertDenied(run('CI=1 touch x'), 'CI=1 com escrita');
  // Variáveis que mudam o que roda continuam negadas.
  for (const command of [
    'FOO=1 git status',
    'PAGER=sh git log',
    'NODE_OPTIONS=--require=x.js npx --no-install tsc --noEmit',
    'DOTNET_STARTUP_HOOKS=x.dll dotnet test',
    'GIT_EXTERNAL_DIFF=x git diff',
    'DOTNET_ROOT=$(curl x) dotnet test',
    'DOTNET_ROOT=`id` dotnet test',
  ]) {
    assertDenied(run(command), command);
  }
});

test('fluxo.json: reviewerComandos inválido nega', () => {
  const cases = {
    lista: JSON.stringify({ reviewerComandos: ['dotnet'] }),
    vazio: JSON.stringify({ reviewerComandos: { dotnet: [] } }),
    shell: JSON.stringify({ reviewerComandos: { bash: ['-c'] } }),
    git: JSON.stringify({ reviewerComandos: { git: ['push'] } }),
    subcomando: JSON.stringify({ reviewerComandos: { dotnet: ['build;rm'] } }),
  };
  for (const [name, content] of Object.entries(cases)) {
    const dir = join(sandbox, `rcfg-${name}`);
    makeRepo(dir, 'feat/teste');
    mkdirSync(join(dir, '.claude'), { recursive: true });
    writeFileSync(join(dir, '.claude', 'fluxo.json'), content);
    assertDenied(decisionOf(runGuard('reviewer', JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git status' }, cwd: dir }), { projectDir: dir })), name);
  }
});

test('fluxo.json inválido ou com caminho para fora nega', () => {
  const cases = { invalido: '{', fora: JSON.stringify({ pastaDemandas: '../x' }), absoluto: JSON.stringify({ pastaHandoff: 'C:/x' }), branch: JSON.stringify({ branchPrincipal: 'a b' }) };
  for (const [name, content] of Object.entries(cases)) {
    const dir = join(sandbox, `cfg-${name}`);
    makeRepo(dir, 'feat/teste');
    mkdirSync(join(dir, '.claude'), { recursive: true });
    writeFileSync(join(dir, '.claude', 'fluxo.json'), content);
    assertDenied(decisionOf(runGuard('developer', JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git status' }, cwd: dir }), { projectDir: dir })), name);
  }
});

test('falha fechada: sem saber a branch, merge e commit são negados', () => {
  const semRepositorio = join(sandbox, 'sem-repo');
  mkdirSync(semRepositorio, { recursive: true });
  assertDenied(bash('developer', 'git commit -m x', semRepositorio), 'commit fora de um repositório');
});

test('a negação segue o formato do Claude Code', () => {
  const result = runGuard('developer', JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git push' }, cwd: project }));
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(parsed.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(parsed.hookSpecificOutput.permissionDecisionReason, /push/);
});

test('texto de heredoc e here-string não é lido como comando', () => {
  const commit = `git commit -m "$(cat <<'EOF'\nfix: o valor d'água; git push depois > a.txt\nEOF\n)"`;
  assertAllowed(bash('developer', commit), 'mensagem de commit em heredoc');
  assertAllowed(bash('architect', `cat > docs/development/999-x/us.md <<'EOF'\n# História d'água\ngit push\nEOF`), 'arquivo em heredoc');
  assertAllowed(powershell('developer', `git commit -m @'\nfix: o valor d'água; git push depois\n'@`), 'mensagem em here-string');
  assertDenied(bash('architect', `cat > codigo.ts <<'EOF'\nx\nEOF`), 'heredoc gravando fora de docs/development');
  assertDenied(bash('developer', `git commit -m x <<'EOF'\nx\nEOF\ngit push`), 'comando depois do heredoc');
});

test('heredoc entregue a um shell é lido como comando', () => {
  assertDenied(bash('developer', `bash <<'EOF'\ngit push\nEOF`), 'bash com heredoc');
});

// Rodada 1 da revisão: formas literais que a guarda liberava. Todas estão no texto do comando; não são indireção.
const STRUCTURAL_PUSH = [
  '(git push)',
  'git status && (git push --force origin main)',
  '{ git push; }',
  '! git push',
  'if true; then git push; fi',
  'if git push; then echo x; fi',
  'while true; do git push; done',
  'for x in a; do git push; done',
  'f() { git push; }; f',
  'cat <(git push)',
  'echo "$(git push)"',
  'echo `git push`',
  'g\\it push',
  'git pu\\sh',
  "git $'push'",
  "# it's\ngit push\n# it's",
  '# "\ngit push\n# "',
  "echo \\' ; git push ; echo \\'",
  'git --attr-source HEAD push',
  'git send-pack origin HEAD:refs/heads/main',
  'git subtree push --prefix=x origin main',
  'git -c alias.x=push x origin main',
  "git -c alias.x='!git push' x",
  'env -u FOO git push',
  'env -C pasta git push',
  'nice -n 10 git push',
  'sudo -u root git push',
  'xargs -n 1 git push',
  'timeout 10 git push',
  'find . -exec git push ;',
];

const INDIRECT_SHELLS = [
  'echo git push | bash',
  'bash <<< "git push"',
  "cat <<'EOF' | bash\ngit push\nEOF",
  "env bash <<'EOF'\ngit push\nEOF",
  "git status; bash <<'EOF'\ngit push\nEOF",
  'cat <<EOF\n$(git push)\nEOF',
  'bash -c -- "git push"',
  'bash -ce "git push"',
  'cmd /k git push',
  'cmd.exe /c"git push"',
  'pwsh -Com "git push"',
  'powershell -EncodedCommand ZwBpAHQA',
  'bash script.sh',
  'source ./x.sh',
];

test('todos os agentes: push em agrupamentos, palavras reservadas e prefixos é negado', () => {
  for (const agent of ['developer', 'architect', 'reviewer']) {
    for (const command of STRUCTURAL_PUSH) assertDenied(bash(agent, command), `${agent}: ${command}`);
  }
});

test('todos os agentes: shell sem comando analisável é negado', () => {
  for (const agent of ['developer', 'architect', 'reviewer']) {
    for (const command of INDIRECT_SHELLS) assertDenied(bash(agent, command), `${agent}: ${command}`);
  }
});

test('PowerShell: blocos, invocação e here-string expansível são negados', () => {
  for (const command of [
    'if ($true) { git push }',
    '& { git push }',
    '1 | % { git push }',
    '@(git push)',
    'iex "git push"',
    'Invoke-Expression "git push"',
    'Start-Process git -ArgumentList push',
    'git pu`sh',
    'g`i`t push',
    'echo @"\n$(git push)\n"@',
    "@'\ngit push\n'@ | iex",
  ]) {
    assertDenied(powershell('developer', command), command);
  }
  assertAllowed(powershell('developer', 'Get-Content "C:\\pasta\\a.txt"'), 'caminho do Windows no PowerShell');
});

test('developer: variações dos demais bloqueios da tabela são negadas', () => {
  for (const command of [
    '(git reset --hard)',
    '(git rebase main)',
    '(git clean -fd)',
    'git reset --har HEAD~1',
    'git pull --rebase',
    'git -c pull.rebase=true pull',
    '(gh pr create --title x)',
    '(gh pr merge 12)',
    'gh pr new --title x',
    'gh pr -R o/r merge 12',
    'gh pr --repo o/r create --title x',
    'gh api repos/o/r/issues -ftitle=x',
    'gh api repos/o/r/issues -Ftitle=x',
    'gh api -XPOST repos/o/r/issues',
  ]) {
    assertDenied(bash('developer', command), command);
  }
});

test('developer: mudar a main por outros caminhos é negado', () => {
  for (const command of [
    'git branch -f main HEAD',
    'git checkout -B main',
    'git update-ref refs/heads/main HEAD',
    'git fetch . HEAD:main',
    'git checkout -b main && git commit -m x',
    'git checkout - && git commit -m x',
    '(git checkout main) && git commit -m x',
    'echo $(git checkout main); git commit -m x',
  ]) {
    assertDenied(bash('developer', command), command);
  }
  assertDenied(bash('developer', `git --git-dir="${onMain}/.git" commit -m x`), '--git-dir');
  assertDenied(bash('developer', `GIT_DIR="${onMain}/.git" git commit -m x`), 'GIT_DIR');
  assertDenied(bash('developer', `env GIT_DIR="${onMain}/.git" git commit -m x`), 'env GIT_DIR');
  assertDenied(bash('developer', `(cd "${onMain}" && git commit -m x)`), 'cd em subshell');
  assertDenied(bash('developer', `pushd "${onMain}" && git commit -m x`), 'pushd');
  assertDenied(bash('developer', 'git pull', onMain), 'pull na main');
});

test('developer: checkout que não muda de branch não impede o commit', () => {
  assertDenied(bash('developer', `git checkout main; cd "${project}"; git commit -m x`), 'cd depois do checkout: a branch segue em main');
  assertAllowed(bash('developer', 'git checkout -- a.txt && git commit -m x'), 'checkout de arquivo');
  assertAllowed(bash('developer', 'git checkout -b feat/y && git commit -m x'), 'branch nova');
});

test('developer: escrita fora da pasta por caminhos não literais é negada', () => {
  for (const command of [
    'rm -rf ~',
    'rm -rf ~/x',
    'echo x > ~/a',
    'cd ~ && rm -rf x',
    'cd && rm -rf x',
    'cd - && rm -rf x',
    'cd -P .. && rm -rf fora',
    'pushd .. && rm -rf fora',
    '(cd .. && echo x > fora.txt)',
    'echo x >&../fora/a',
    'echo x >& ../fora/a',
    'echo x &> ../fora/a',
    'echo x <> ../fora/a',
    'cp -t ../fora a.txt',
    'cp --target-directory=../fora a.txt',
    'mv --target-directory=../fora a.txt',
    'Copy-Item -Destination ../fora/a -Path a.txt',
    'Set-Content -Path:../fora/a x',
    'sed --in-place=.bak s/a/b/ ../fora/x',
    'tee ../fora/a',
    'dd if=a of=../fora/b',
    'ln -s a ../fora/b',
    'truncate -s 0 ../fora/a',
    'del ../fora/a',
    'Rename-Item ../fora/a b',
    'curl -o ../fora/a https://example.com',
    'git worktree add ../fora/x',
    'git clone a ../fora/y',
    'git -C ../fora add .',
  ]) {
    assertDenied(bash('developer', command), command);
  }
});

test('developer: docs/handoff é protegida contra rm amplo, curinga e Git', () => {
  for (const command of [
    'if true; then rm docs/handoff/a.md; fi',
    'rm docs/hand*/X',
    'rm docs/handof?/X',
    'rm -rf docs',
    'rm -rf .',
    'rm -rf docs/*',
    'git rm docs/handoff/a.md',
    'git mv docs/handoff/a.md b.md',
    'git restore docs/handoff/a.md',
    'git checkout HEAD~1 -- docs/handoff/a.md',
  ]) {
    assertDenied(bash('developer', command), command);
  }
  for (const command of ['rm -rf dist/*', 'rm src/a.txt', 'mkdir -p docs/development/999-x', 'cp a.txt docs/', 'git rm src/a.txt', 'git mv a.txt b.txt', 'git restore a.txt']) {
    assertAllowed(bash('developer', command), command);
  }
});

test('architect: o Git não serve para alterar código', () => {
  for (const command of [
    'git pull',
    'git rm AGENT.md',
    'git mv AGENT.md X.md',
    'git checkout HEAD~1 -- AGENT.md',
    'git restore AGENT.md',
    'git reset --hard',
    'git clean -fdx',
    'git stash',
    'git apply p.diff',
    'git cherry-pick abc',
    'git am p',
    'git branch -D x',
  ]) {
    assertDenied(bash('architect', command), command);
  }
});

test('reviewer: programas fora da lista de leitura são negados', () => {
  for (const command of [
    'git branch -v nova',
    'git branch -v -fD x',
    'git branch -a -rd x',
    'git branch -v -u origin/x',
    'git branch -v --set-upstream-to=o/x',
    'git branch --list --edit-description',
    'git -c diff.external=x diff',
    'git -c core.pager=x log',
    'git grep -Ox a',
    'git grep --open-files-in-pager=x a',
    'git diff --ext-diff',
    'echo x >& a.txt',
    'echo x <> a.txt',
    'npm install',
    'dd of=a',
    'curl -o a https://example.com',
    'del a',
    'Rename-Item a b',
    'sed -i s/a/b/ a.txt',
    'find . -delete',
    'find . -exec rm {} ;',
    'gh pr -R o/r merge 12',
    'gh pr --repo o/r close 12',
    'gh api graphql -fquery=mutation',
  ]) {
    assertDenied(bash('reviewer', command), command);
  }
  for (const command of [
    'cat a.txt | head -5',
    'grep -rn git docs',
    'sed -n 1,5p a.txt',
    'ls -la',
    'wc -l a.txt',
    'git check-ignore a.txt',
    'git branch --list "feat/*"',
    'git branch --contains HEAD',
    'npm test',
    'npm run test',
    'gh pr --repo o/r view 12',
  ]) {
    assertAllowed(bash('reviewer', command), command);
  }
  assertAllowed(powershell('reviewer', 'Get-Content a.txt | Select-String x'), 'leitura no PowerShell');
});

test('falha fechada: entrada malformada no comando ou no ambiente é negada', () => {
  assertDenied(bash('developer', 'echo $(git status'), '$( sem fechamento');
  assertDenied(bash('developer', 'echo `git status'), 'crase sem fechamento');
  assertDenied(bash('developer', 'echo "a'), 'aspas sem fechamento');
  assertDenied(bash('developer', "cat <<'EOF'\nx"), 'heredoc sem fechamento');
  assertDenied(bash('developer', 'echo x >'), 'redirecionamento sem destino');
  assertDenied(decisionOf(runGuard('developer', JSON.stringify({ tool_name: 'Write', tool_input: { file_path: 'a.txt' } }))), 'sem cwd');
  assertDenied(decisionOf(runGuard('developer', JSON.stringify({ tool_name: 'Write', tool_input: { file_path: 'a.txt' }, cwd: 5 }))), 'cwd inválido');
});

test('a negação vem da regra, e não de um erro inesperado', () => {
  for (const [agent, command] of [['developer', '(git push)'], ['reviewer', 'gh constructor x'], ['reviewer', 'cat x | constructor']]) {
    assert.doesNotMatch(bash(agent, command).reason, /erro inesperado/, command);
  }
});

test('o texto continua livre em aspas, e comandos comuns seguem permitidos', () => {
  for (const command of [
    'echo "(git push)"',
    'echo git push',
    'grep -rn git docs',
    'which git',
    'node -e "console.log(1)"',
    'git log --format=%H | head -3',
    'git commit -m "feat: (rodada 1) não faz push; só commit"',
    'npm run test -- --watch=false',
    'cd docs && ls',
    'echo ${HOME}',
    '# só um comentário\ngit status',
  ]) {
    assertAllowed(bash('developer', command), command);
  }
});

test('developer: commit e merge em outro repositório são negados, mesmo fora da main', () => {
  assertDenied(bash('developer', `git -C "${outside}" commit -m x`), 'commit com -C');
  assertDenied(bash('developer', `git -C "${outside}" merge feat/x`), 'merge com -C');
});

test('developer: copiar de fora para dentro da pasta é permitido; o destino é o que vale', () => {
  assertAllowed(bash('developer', `cp "${join(outside, 'a.txt')}" novo.txt`), 'origem fora');
  assertDenied(bash('developer', `cp a.txt "${join(outside, 'b.txt')}"`), 'destino fora');
  assertDenied(bash('developer', 'cp a.txt docs/handoff/b.txt'), 'destino no handoff');
});

// Rodada 2 da revisão: heredoc em aspas ou comentário, expansões e estado da branch e da pasta.
const HIDDEN_PUSH = [
  'echo "<<EOF"\ngit push --force origin main\nEOF',
  "echo '<<X'\ngit push --force origin main\nX",
  '# <<EOF\ngit push --force origin main\nEOF',
  'echo "@"\ngit push\n"@"',
  'echo ${x:-$(git push)}',
  'echo ${x:-`git push`}',
  "echo $'\\'' ; git push #'",
  'echo "\\`" ; git push ; echo "\\`"',
  "$'\\x67it' push",
  "$'\\147it' push",
  '{git,push}',
  'git {push,}',
  'git pus{h,}',
  'git pu$()sh',
  'git $(echo push)',
  'git ${x:-push}',
  '$(echo git) push',
  'G=git; $G push',
  "sh -c 'git \"$@\"' _ push",
  'timeout 5 bash -c "git push"',
  "trap 'git push' EXIT",
  'watch "git push"',
  'script -c "git push"',
  'ksh -c "git push"',
  'fish -c "git push"',
  'busybox sh -c "git push"',
  'wsl bash -c "git push"',
  'alias x="git push"; x',
  'cmd /c g^it push',
  'cmd /c "echo \' & git push & echo \'"',
  'cmd /c "# & git push"',
  "echo 'git push' | powershell -Command -",
  "git -c core.pager='git push' -p log",
  'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=alias.x GIT_CONFIG_VALUE_0=push git x',
  'perl -e "system(\'git push\')"',
];

test('rodada 2: push escondido em texto, expansão ou shell é negado para os três agentes', () => {
  for (const agent of ['developer', 'architect', 'reviewer']) {
    for (const command of HIDDEN_PUSH) assertDenied(bash(agent, command), `${agent}: ${command}`);
  }
});

test('rodada 2: PowerShell com bloco colado, comentário e aspas tipográficas é negado', () => {
  for (const agent of ['developer', 'architect']) {
    for (const command of [
      '1|%{git push}',
      'try{git push}catch{}',
      'if(1){}else{git push}',
      '1|ForEach-Object{git push}',
      '.{git push}',
      '&("git") push',
      '<# c #> git push',
      'git “push”',
      '# @"\ngit push\n"@ "',
      'powershell -c "1|%{git push}"',
      'powershell -c "<# x #> git push"',
    ]) {
      assertDenied(powershell(agent, command), `${agent}: ${command}`);
    }
  }
  assertDenied(powershell('developer', '$env:GIT_DIR = "x"; git commit -m y'), '$env:GIT_DIR');
  assertDenied(powershell('developer', '$env:GIT_DIR="x"; git commit -m y'), '$env:GIT_DIR colado');
  assertAllowed(powershell('developer', '$x = 1; git status'), 'atribuição simples');
  assertAllowed(powershell('developer', "git commit -m @'\nfix: valor d'água; git push\n'@"), 'here-string literal');
  assertAllowed(bash('developer', "git commit -m \"$(cat <<'EOF'\nfix (parte 1): valor d'água\ngit push\nEOF\n)\""), 'heredoc com parêntese');
});

test('rodada 2: o developer só usa subcomandos conhecidos do Git', () => {
  for (const command of ['git p', 'git co main', 'git worktree add x', 'git init ../fora', 'git clone a b', 'git update-ref --stdin', 'git filter-branch', 'git -C']) {
    assertDenied(bash('developer', command), command);
  }
  for (const command of ['git add .', 'git commit -m x', 'git fetch origin', 'git stash', 'git revert abc', 'git show HEAD', 'git reflog', 'git tag v1', 'git -c color.ui=never log']) {
    assertAllowed(bash('developer', command), command);
  }
});

test('rodada 2: troca de branch no mesmo comando impede o commit', () => {
  for (const command of [
    'git checkout main && cd . && git commit -m x',
    'git -C . checkout main && git -C . commit -m x',
    'git checkout @{-1} && git commit -m x',
    'git switch @{-1} && git commit -m x',
    'git checkout $B && git commit -m x',
    'git checkout $(echo main) && git commit -m x',
    'git checkout feat/x && git commit -m x',
    'git symbolic-ref HEAD refs/heads/main && git commit -m x',
    'git checkout -Bmain && git commit -m x',
    'bash -c "git checkout main" && git commit -m x',
    `export GIT_DIR="${onMain}/.git"; git commit -m x`,
  ]) {
    assertDenied(bash('developer', command), command);
  }
  for (const command of ['git branch --forc main x', 'git pull --reb', 'git diff --outp=../fora/x', 'git diff --output=../fora/x']) {
    assertDenied(bash('developer', command), command);
  }
});

test('rodada 2: a pasta do comando só é conhecida com cd seguido de &&', () => {
  for (const [agent, command] of [
    ['architect', '(cd docs/development/a/b); echo x > AGENT.md'],
    ['architect', 'false && cd docs/development; echo x > AGENT.md'],
    ['developer', '(cd a/b/c/d/e/f/g); rm ../../../../fora.txt'],
    ['developer', 'cd docs | cat; rm -rf ../fora'],
    ['developer', 'cd inexistente; rm -rf ../fora'],
    ['developer', 'sl ../../../..; rm fora.txt'],
    ['developer', 'chdir ../../../.. ; rm fora.txt'],
    ['developer', 'cd .. && echo $(rm -rf demanda/docs/handoff)'],
  ]) {
    assertDenied(bash(agent, command), command);
  }
  assertAllowed(bash('developer', 'cd docs && echo x > a.txt'), 'cd seguido de &&');
  assertAllowed(bash('developer', 'cd docs && cd development && ls'), 'dois cd seguidos de &&');
});

test('rodada 2: destinos de escrita menos óbvios são verificados', () => {
  for (const command of [
    'echo x > docs/hand*/x.md',
    'touch docs/hando?f/x.md',
    'rm -rf scripts/*/../../../fora',
    'touch docs/{handoff,x}/f',
    'del %USERPROFILE%\\x',
    'curl -o../fora/x https://example.com',
    'curl -sSo ../fora/x https://example.com',
    'wget -O../fora/x https://example.com',
    'copy a.txt ../fora.txt',
    'move docs/handoff/a.md b.md',
    'md ../fora',
    'Tee-Object ../fora.txt',
    'Invoke-WebRequest https://example.com -OutFile ../fora.txt',
    'git checkout HEAD docs/handoff/a.md',
    `git -C "${outside}" branch -D x`,
    `git -C "${outside}" remote remove origin`,
  ]) {
    assertDenied(bash('developer', command), command);
  }
  assertDenied(edit('developer', 'Write', join(project, 'docs', 'handoff.', 'x.md')), 'handoff com ponto final');
  assertDenied(bash('architect', 'copy a.txt AGENT.md'), 'copy do Arquiteto');
  assertDenied(bash('architect', 'md src'), 'md do Arquiteto');
});

test('rodada 2: o Reviewer não grava nem executa por argumentos de programas de leitura', () => {
  for (const command of [
    'sort -o saida.txt AGENT.md',
    'sort --output=saida.txt AGENT.md',
    'uniq AGENT.md saida.txt',
    "sed -n 'w saida.txt' AGENT.md",
    "sed '1e git push' AGENT.md",
    'rg --pre ./x.sh foo',
    "GIT_PAGER='rm -rf x' git -p log",
    'GIT_EXTERNAL_DIFF=./x.sh git diff',
    'FOO=1 git status',
    'date -s 2020-01-01',
    'git diff --outp=x',
    'git grep --open-files=./x y',
    'gh api repos/o/r/issues -if title=x',
  ]) {
    assertDenied(bash('reviewer', command), command);
  }
  for (const command of ["sed -n '1,5p' a.txt", "sed -n '/x/,/y/p' a.txt", 'sort a.txt', 'uniq a.txt', 'gh api repos/o/r/pulls -i']) {
    assertAllowed(bash('reviewer', command), command);
  }
});

test('rodada 2: as regras da main valem de verdade, com a pasta da demanda em main', () => {
  for (const command of ['git commit -m x', 'git merge feat/x', 'git pull', 'git revert HEAD', 'git cherry-pick abc', 'git am p.patch']) {
    const stdin = JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: onMain });
    const { decision, reason } = decisionOf(runGuard('developer', stdin, { projectDir: onMain }));
    assert.equal(decision, 'deny', command);
    assert.match(reason, /main/, `${command}: ${reason}`);
  }
});

test('rodada 2: executores e binários diretos do Git são negados', () => {
  for (const agent of ['developer', 'architect', 'reviewer']) {
    for (const command of [
      'echo push | xargs git',
      'echo "pr merge 12" | xargs gh',
      "sed -n '1e git push' a.txt",
      'GIT_EXTERNAL_DIFF="git push" git diff',
      '/mingw64/libexec/git-core/git-push origin main',
      'git-rebase main',
      'git -c diff.external="git push" diff',
      'stdbuf -o0 sh -c "git push"',
    ]) {
      assertDenied(bash(agent, command), `${agent}: ${command}`);
    }
  }
  for (const command of ['git submodule foreach git push', 'git bisect run git push', 'git difftool -y -x "git push"', 'git grep --open-files-in-pager="git push" a', 'git format-patch -o ../fora HEAD~1', 'git archive -o ../fora/x.tar HEAD']) {
    assertDenied(bash('developer', command), command);
  }
});

test('rodada 2: mais formas de branch, rebase, reset e destino são negadas', () => {
  for (const command of [
    'git checkout main -- ; git commit -m x',
    'git pull -rv',
    'git -c branch.feat/teste.rebase=true pull',
    'git reset --h',
    'git checkout -- .',
    'git restore .',
    'git checkout -- docs/hand*',
    'cp -t../fora a.txt',
    'Copy-Item -Dest ../fora/a -Path a.txt',
    'install a.txt ../fora/a',
    'unlink ../fora/a',
    'wget -P ../fora https://example.com',
    "sed -n 'w ../fora/b' a.txt",
    'sed -i s/x/y/ docs/hand*/ANTIGO.md',
    'cp a.txt docs/hand*/',
  ]) {
    assertDenied(bash('developer', command), command);
  }
  assertDenied(bash('architect', 'git -C ../fora add .'), 'add do Arquiteto em outra pasta');
  assertDenied(bash('architect', 'git -C ../fora commit -m x'), 'commit do Arquiteto em outra pasta');
});

test('as conversões de caminho e link são verificadas', { skip: process.platform !== 'win32' }, () => {
  const gitBashPath = `/${outside[0].toLowerCase()}${outside.slice(2).replace(/\\/g, '/')}/a.txt`;
  assertDenied(bash('developer', `echo x > ${gitBashPath}`), 'caminho do Git Bash');
});

test('eval e popd são analisados', () => {
  assertDenied(bash('developer', 'eval "git push"'), 'eval');
  assertDenied(bash('developer', 'popd; rm a.txt'), 'popd deixa a pasta desconhecida');
});

test('reviewer: só pode rodar npx --no-install tsc --noEmit, com -p ou --project opcional', () => {
  for (const command of [
    'npx tsc --noEmit',
    'npx --no-install tsc',
    'npx --no-install tsc --noEmit --watch',
    'npx --no-install tsc --noEmit --outDir x',
    'npx --no-install tsc --build',
    'npx --no-install eslint .',
    'npx prisma generate',
    'npx --yes tsc --noEmit',
    'npx --no-install tsc --noEmit -p',
    'npx --no-install tsc --noEmit -p apps/mobile --watch',
    'npx --no-install tsc --noEmit && npx prisma generate',
    'cd apps/mobile && npx --no-install eslint .',
  ]) {
    assertDenied(bash('reviewer', command), command);
  }
  for (const command of [
    'npx --no-install tsc --noEmit',
    'npx --no-install tsc --noEmit -p apps/mobile',
    'npx --no-install tsc --noEmit --project apps/mobile',
    'cd apps/mobile && npx --no-install tsc --noEmit',
  ]) {
    assertAllowed(bash('reviewer', command), command);
  }
});

test('npx segue liberado para architect e developer', () => {
  for (const agent of ['architect', 'developer']) {
    for (const command of ['npx prisma generate', 'npx --no-install tsc --noEmit']) assertAllowed(bash(agent, command), `${agent}: ${command}`);
  }
});

test('reviewer: o valor de -p é caminho literal e npx sob xargs é negado', () => {
  const both = [
    'npx --no-install tsc --noEmit -p $(echo x --noEmit false --outDir y)',
    'npx --no-install tsc --noEmit -p `echo x --outDir y`',
    'npx --no-install tsc --noEmit -p *',
    'npx --no-install tsc --noEmit -p apps/*',
    'npx --no-install tsc --noEmit -p a?',
    'npx --no-install tsc --noEmit -p a[b]',
    'echo false --outDir y | xargs npx --no-install tsc --noEmit',
    'npx --no-install tsc --noEmit; npx cowsay',
    'npx --no-install tsc --noEmit | npx cowsay',
    'npx --no-install tsc --noEmit --project=x',
    'npx --no-install tsc --noEmit -px',
  ];
  const powershellOnly = [
    'npx --no-install tsc --noEmit -p $(write-output x --outDir y)',
    '$a = write-output x --outDir y; npx --no-install tsc --noEmit -p $a',
    'npx --no-install tsc --noEmit -p @a',
    'npx --no-install tsc --noEmit -p %A%',
    'npx --no-install tsc --noEmit -p {x}',
  ];
  for (const command of [...both, ...powershellOnly]) assertDenied(powershell('reviewer', command), `powershell: ${command}`);
  for (const command of [...both, 'npx --no-install tsc --noEmit -p $a', 'npx --no-install tsc --noEmit -p ${a}', 'npx --no-install tsc --noEmit -p %A%', 'npx --no-install tsc --noEmit -p {x}']) {
    assertDenied(bash('reviewer', command), `bash: ${command}`);
  }
  const allowed = [
    'npx --no-install tsc --noEmit',
    'npx --no-install tsc --noEmit -p apps/mobile',
    'npx --no-install tsc --noEmit --project apps/backoffice/tsconfig.app.json',
    'cd apps/backoffice && npx --no-install tsc --noEmit -p tsconfig.app.json',
    'npx --no-install tsc --noEmit | head -20',
  ];
  for (const command of allowed) {
    assertAllowed(bash('reviewer', command), `bash: ${command}`);
    assertAllowed(powershell('reviewer', command), `powershell: ${command}`);
  }
  for (const agent of ['architect', 'developer']) {
    for (const command of ['npx --no-install tsc --noEmit -p apps/mobile', 'echo x | xargs npx --no-install tsc --noEmit']) {
      assertAllowed(bash(agent, command), `${agent}: ${command}`);
    }
  }
});
