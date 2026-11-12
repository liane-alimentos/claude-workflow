// Hook SessionStart: diz à sessão se ela é a de coordenação ou a de uma demanda.
// Roda o hook como o Claude Code roda: JSON na entrada padrão, contexto em JSON na saída.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOOK = join(ROOT, 'plugins', 'fluxo', 'hooks', 'session-start.mjs');

let sandbox;

function git(cwd, ...args) {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function makeRepo(name, branch, { fluxo = true, subdir } = {}) {
  const path = join(sandbox, name);
  mkdirSync(path, { recursive: true });
  git(path, 'init', '-q');
  git(path, 'symbolic-ref', 'HEAD', `refs/heads/${branch}`);
  if (fluxo) {
    mkdirSync(join(path, '.claude'), { recursive: true });
    writeFileSync(join(path, '.claude', 'fluxo.json'), '{ "branchPrincipal": "master" }');
  }
  if (subdir) mkdirSync(join(path, subdir), { recursive: true });
  return path;
}

function run(input, env = {}) {
  const stdin = typeof input === 'string' ? input : JSON.stringify(input);
  const result = spawnSync(process.execPath, [HOOK], {
    input: stdin,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: '', ...env },
  });
  return result;
}

function context(result) {
  assert.equal(result.status, 0, result.stderr);
  if (!result.stdout.trim()) return '';
  const out = JSON.parse(result.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
  return out.hookSpecificOutput.additionalContext;
}

before(() => {
  sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'fluxo-session-')));
});

after(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

test('repositório sem .claude/fluxo.json: não acrescenta contexto', () => {
  const repo = makeRepo('sem-fluxo', 'main', { fluxo: false });
  assert.equal(context(run({ cwd: repo, source: 'startup' })), '');
});

test('branch que não é de demanda: sessão de coordenação', () => {
  const repo = makeRepo('coordenacao', 'claude/algum-nome');
  const ctx = context(run({ cwd: repo, source: 'startup' }));
  assert.match(ctx, /sessão de coordenação/);
  assert.match(ctx, /\/fluxo:orquestrar/);
  assert.match(ctx, /claude\/algum-nome/);
});

test('branch principal: sessão de coordenação', () => {
  const repo = makeRepo('principal', 'master');
  assert.match(context(run({ cwd: repo, source: 'startup' })), /sessão de coordenação/);
});

test('branch feat/NNN-slug: sessão da demanda', () => {
  const repo = makeRepo('demanda-feat', 'feat/012-pedidos-aprovacao');
  const ctx = context(run({ cwd: repo, source: 'startup' }));
  assert.match(ctx, /sessão da demanda/);
  assert.match(ctx, /012-pedidos-aprovacao/);
  assert.doesNotMatch(ctx, /sessão de coordenação/);
});

test('branch docs/NNN-slug: sessão da demanda', () => {
  const repo = makeRepo('demanda-docs', 'docs/162-fluxo-plugin');
  assert.match(context(run({ cwd: repo, source: 'resume' })), /sessão da demanda[^.]*162-fluxo-plugin/);
});

test('branch de demanda com sufixo de entrega: sessão da demanda', () => {
  const repo = makeRepo('demanda-sufixo', 'feat/159-gerente-por-uf-etl');
  assert.match(context(run({ cwd: repo })), /159-gerente-por-uf-etl/);
});

test('cwd numa subpasta: usa a raiz do repositório', () => {
  const repo = makeRepo('subpasta', 'feat/003-x', { subdir: 'apps/web' });
  assert.match(context(run({ cwd: join(repo, 'apps', 'web') })), /sessão da demanda/);
});

test('sem cwd na entrada: usa o CLAUDE_PROJECT_DIR', () => {
  const repo = makeRepo('project-dir', 'claude/y');
  assert.match(context(run({ source: 'startup' }, { CLAUDE_PROJECT_DIR: repo })), /sessão de coordenação/);
});

test('fora de um repositório Git e sem fluxo.json: não acrescenta contexto', () => {
  const pasta = join(sandbox, 'nao-git');
  mkdirSync(pasta, { recursive: true });
  assert.equal(context(run({ cwd: pasta })), '');
});

test('entrada inválida: termina sem erro e sem contexto', () => {
  assert.equal(context(run('isto não é json')), '');
});
