#!/usr/bin/env node
// Hook SessionStart do plugin fluxo: num repositório com .claude/fluxo.json, diz à sessão
// se ela é a sessão de coordenação ou a sessão de uma demanda (pela branch atual).
// Nunca bloqueia a sessão: qualquer falha termina sem contexto e com código 0.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DEMANDA = /^(?:feat|docs)\/(\d{3}[a-z]?-[a-z0-9][a-z0-9-]*)$/;

function gitOut(cwd, ...args) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function contextFor(branch) {
  const match = DEMANDA.exec(branch);
  if (match) {
    return [
      `Fluxo orquestrado (plugin fluxo): você é a sessão da demanda ${match[1]} (branch ${branch}).`,
      'Antes de agir, carregue /fluxo:orquestrar e siga as etapas a partir do status no us.md e no kanban.',
      'Você só orquestra: US, Spec e Tasks vão para fluxo:architect, a implementação para fluxo:developer e a revisão para fluxo:reviewer e o pr-review-toolkit, todos como subagentes nesta pasta; as aprovações são do usuário, nesta sessão.',
    ].join(' ');
  }
  return [
    `Fluxo orquestrado (plugin fluxo): a branch atual (${branch || 'desconhecida'}) não é de uma demanda, então você é a sessão de coordenação.`,
    'Antes de agir num pedido de desenvolvimento, carregue /fluxo:orquestrar (seção "Sessão de coordenação").',
    'Converse com o usuário sobre o backlog, reserve o NNN, crie a branch e o worktree e abra uma sessão filha por demanda; não acione os subagentes do fluxo aqui.',
    'Pedidos que não são demandas (dúvidas, consultas) você atende normalmente.',
  ].join(' ');
}

function main() {
  let input = {};
  try {
    input = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return;
  }
  const cwd = (input && typeof input.cwd === 'string' && input.cwd) || process.env.CLAUDE_PROJECT_DIR || '';
  if (!cwd || !existsSync(cwd)) return;
  const root = gitOut(cwd, 'rev-parse', '--show-toplevel') || cwd;
  if (!existsSync(join(root, '.claude', 'fluxo.json'))) return;
  const branch = gitOut(root, 'branch', '--show-current');
  const output = { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: contextFor(branch) } };
  process.stdout.write(JSON.stringify(output));
}

try {
  main();
} catch {
  // Sem contexto: a sessão segue normalmente.
}
