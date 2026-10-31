#!/usr/bin/env node
// Runs a test-writer or implementor brief on Codex (GPT) instead of a Claude sub-agent.
// Codex runs outside Claude's hooks, so this script supplies the containment: it records every
// file's hash before the run and, when the run ends, classifies every changed file against the
// brief's allowed list and the live territories. It never reverts anything; the architect decides.
//
//   node codex-subagent.cjs start  <test-writer|implementor> <workstream> <brief.md> <allowed.txt> <outdir> [effort]
//   node codex-subagent.cjs wait   <outdir> [seconds=540]     prints the report when done; exit 3 if still running,
//                                                             exit 4 if the run's process died without finishing
//   node codex-subagent.cjs resume <outdir> <message.md>      continues the same Codex session (answers to NEEDS)
//
// start and resume block until codex exits; run them with the Bash tool's run_in_background.
//
// <allowed.txt>: one repo-relative path per line, the only files the brief may create or edit.
// <outdir>: a fresh directory under the scratchpad, one per brief (e.g. .../scratchpad/runtime/codex/I-runtime-3.2/run).
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync, execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..');
// Per-role model, effort and speed from .claude/settings.json `env` (CLAUDE.md, Models).
// CODEX_SUBAGENT_MODEL is the old single knob, read only when the role's _MODEL is empty.
const TIERS = ['default', 'fast', 'ultrafast'];
const roleConfig = (role) => {
  const v = (k) => (process.env[`CODEX_${role.toUpperCase().replace(/-/g, '_')}_${k}`] || '').trim();
  return { model: v('MODEL') || process.env.CODEX_SUBAGENT_MODEL || 'gpt-6-astra', effort: v('EFFORT') || 'medium', tier: v('TIER') };
};
const ALLOWED_MODELS = (process.env.CODEX_ALLOWED_MODELS || '').split(',').map((s) => s.trim()).filter(Boolean);
// Codex accepts an unknown service_tier silently (measured 2026-10-28), so the check is here.
const checkConfig = ({ model, tier }) => {
  if (ALLOWED_MODELS.length && !ALLOWED_MODELS.includes(model)) die(`model ${model} isn't allowed here; CODEX_ALLOWED_MODELS (.claude/settings.json env) is ${ALLOWED_MODELS.join(', ')}`);
  if (tier && !TIERS.includes(tier)) die(`speed ${tier} isn't one of ${TIERS.join(', ')} (the role's *_TIER in .claude/settings.json env)`);
};

// Codex's JS entry, run with this Node so no shell has to quote paths that contain spaces.
const findCodexJs = () => {
  const entry = (dir) => path.join(dir, '@openai', 'codex', 'bin', 'codex.js');
  const quick = [process.env.CODEX_JS, process.env.APPDATA && entry(path.join(process.env.APPDATA, 'npm', 'node_modules'))]
    .find((p) => p && fs.existsSync(p));
  if (quick) return quick;
  try {
    const global = entry(execFileSync('npm', ['root', '-g'], { encoding: 'utf8', shell: true }).trim());
    return fs.existsSync(global) ? global : '';
  } catch { return ''; }
};
const CODEX_JS = findCodexJs();
const territory = require(path.join(ROOT, '.claude', 'hooks', 'territory.cjs'));

const die = (msg) => { process.stderr.write(`codex-subagent: ${msg}\n`); process.exit(2); };
const read = (p) => fs.readFileSync(p, 'utf8');
const stripFrontmatter = (s) => s.replace(/^---\n[\s\S]*?\n---\n/, '');

function snapshot() {
  const out = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
  const hashes = {};
  for (const rel of out.split('\0').filter(Boolean)) {
    try { hashes[rel] = crypto.createHash('sha1').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex'); } catch { /* deleted mid-scan */ }
  }
  return hashes;
}

function buildPrompt(role, workstream, brief, allowed) {
  return [
    `You are the ${role} sub-agent for architect ${workstream}, running on Codex in this repository (${ROOT}).`,
    `Follow your role file below. Differences because you run on Codex, not Claude Code:`,
    `- This repository's AGENTS.md describes Codex working alone as the owner of a whole task. You are not that here: you are a sub-agent with one brief. Where AGENTS.md and this prompt differ (scope, git, commits, PRs, asking the owner), this prompt and your role file win.`,
    `- Edit files only with apply_patch. Create or edit ONLY the files listed under "Allowed files"; any other write is a violation the architect will see.`,
    `- Never run git commands that change state (add, commit, checkout, restore, stash, reset). Read-only git is fine.`,
    `- Run exactly the validation commands your brief names (pnpm exec vitest/tsgo/eslint/prettier on your paths). Never pnpm check, never the full suite.`,
    `- Your final message is your report, in the format your role file gives. Start each text block with your brief id.`,
    '',
    '===== ROLE FILE =====',
    stripFrontmatter(read(path.join(ROOT, '.claude', 'agents', `${role}.md`))),
    '===== REPOSITORY INSTRUCTIONS (CLAUDE.md) =====',
    read(path.join(ROOT, 'CLAUDE.md')),
    '===== CODE STANDARDS (the rulebook you are checked against) =====',
    stripFrontmatter(read(path.join(ROOT, '.claude', 'skills', 'code-standards', 'SKILL.md'))),
    '===== YOUR BRIEF =====',
    brief,
    '===== ALLOWED FILES (the only files you may create or edit) =====',
    allowed.join('\n'),
  ].join('\n');
}

const codexArgs = (meta, lastFile) => [
  // `exec resume` accepts neither -s nor -C, so the sandbox is a config override and the working
  // directory comes from the spawn's cwd; both forms then work for start and resume alike.
  CODEX_JS, 'exec', '--json', '-m', meta.model, '-c', `model_reasoning_effort=${meta.effort}`,
  ...(meta.tier ? ['-c', `service_tier=${meta.tier}`] : []),
  '-c', 'sandbox_mode=workspace-write',
  '-c', 'shell_environment_policy.inherit=all', '-c', 'shell_environment_policy.ignore_default_excludes=true',
  '-o', lastFile,
];

// Runs codex synchronously, then writes the exit code and the report.
function run(outdir, mode) {
  const saved = JSON.parse(read(path.join(outdir, 'meta.json')));
  // Runs started before the per-role settings existed carry no model or tier; fill from the role.
  const meta = { ...roleConfig(saved.role), ...saved };
  const n = mode === 'resume' ? meta.turns : 0;
  const prompt = mode === 'resume' ? read(path.join(outdir, `message-${n}.md`)) : read(path.join(outdir, 'prompt.md'));
  const last = path.join(outdir, `last-${n}.md`);
  let args = codexArgs(meta, last);
  if (mode === 'resume') args = [CODEX_JS, 'exec', 'resume', meta.threadId, ...args.slice(2)];
  const r = spawnSync(process.execPath, [...args, '-'], {
    input: prompt, cwd: ROOT, maxBuffer: 1 << 28, encoding: 'utf8',
  });
  fs.writeFileSync(path.join(outdir, `events-${n}.jsonl`), r.stdout || '');
  fs.writeFileSync(path.join(outdir, `stderr-${n}.log`), (r.stderr || '') + (r.error ? `\n${r.error}` : ''));
  const thread = (r.stdout || '').split('\n').map((l) => { try { return JSON.parse(l); } catch { return undefined; } })
    .find((e) => e && (e.type === 'thread.started' || e.thread_id));
  if (thread && !meta.threadId) meta.threadId = thread.thread_id || thread.id;
  fs.writeFileSync(path.join(outdir, 'meta.json'), JSON.stringify(meta, null, 2));
  fs.writeFileSync(path.join(outdir, 'report.md'), report(outdir, meta, n, r.status));
  fs.writeFileSync(path.join(outdir, `exit-${n}`), String(r.status ?? 1));
}

// The other briefs' meta.json files next to this one, so the report can attribute a file to the
// concurrent brief that was allowed it. The skill's layout is <scratch>/<ws>/codex/<brief id>/run,
// so siblings are codex/*/run/meta.json; an outdir not named `run` is the older flat layout,
// codex/<brief id>, whose siblings are codex/*/meta.json. A meta.json caught mid-write is skipped.
function findSiblings(outdir) {
  const self = path.resolve(outdir);
  const nested = path.basename(self) === 'run';
  const root = nested ? path.dirname(path.dirname(self)) : path.dirname(self);
  const metaOf = (d) => (nested ? path.join(root, d, 'run', 'meta.json') : path.join(root, d, 'meta.json'));
  const parse = (p) => { try { return JSON.parse(read(p)); } catch { return undefined; } };
  return fs.readdirSync(root).map(metaOf)
    .filter((p) => path.dirname(p) !== self && fs.existsSync(p))
    .map(parse).filter((m) => m && Array.isArray(m.allowed));
}

function report(outdir, meta, n, status) {
  const before = JSON.parse(read(path.join(outdir, 'before.json')));
  const after = snapshot();
  const allowed = new Set(meta.allowed);
  const territories = territory.load(ROOT);
  const siblings = findSiblings(outdir);
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((f) => before[f] !== after[f]).sort();
  const lines = changed.map((f) => {
    const kind = !(f in after) ? 'deleted' : !(f in before) ? 'created' : 'modified';
    if (allowed.has(f)) return `- ok      ${kind} ${f}`;
    const owners = territory.holders(territories, f).map((t) => t.name);
    const brief = siblings.find((s) => s.allowed.includes(f));
    const why = brief ? `allowed to concurrent brief ${brief.briefId} (probably that one)`
      : owners.length === 0 ? 'RESERVE — no territory: a stray write unless the orchestrator made it'
      : owners.includes(meta.workstream) ? `STRAY — in ${meta.workstream}'s territory but not in this brief's allowed list`
      : `in ${owners.join(', ')}'s territory (probably a sibling architect's agent)`;
    return `- CHECK   ${kind} ${f} — ${why}`;
  });
  const lastFile = path.join(outdir, `last-${n}.md`);
  return [
    `# ${meta.briefId} (${meta.role}, ${meta.model}, ${meta.effort}${meta.tier ? `, ${meta.tier}` : ''}) — turn ${n}, codex exit ${status}`,
    `Thread: ${meta.threadId || 'unknown'}`,
    '',
    '## Files changed since the brief started',
    lines.length ? lines.join('\n') : '- none',
    '',
    '## Codex report',
    fs.existsSync(lastFile) ? read(lastFile) : `(no final message; see ${path.join(outdir, `stderr-${n}.log`)})`,
  ].join('\n');
}

// Runs codex in this process. The architect starts `start` and `resume` with the Bash tool's
// run_in_background, as a shell script would, so codex.exe shares Claude Code's own console.
// The earlier detached runner had no console to hand down (Windows ignores CREATE_NO_WINDOW
// next to DETACHED_PROCESS), and a windowsHide child gets a console of its own rather than
// sharing one. With the detached runner a console window flashed on every brief on Windows;
// with this foreground launcher a real brief ran with no window (owner-observed, 2026-10-28).
// The pid lets `wait` tell a killed run from a slow one.
function launch(outdir, mode) {
  const metaFile = path.join(outdir, 'meta.json');
  fs.writeFileSync(metaFile, JSON.stringify({ ...JSON.parse(read(metaFile)), pid: process.pid }, null, 2));
  run(outdir, mode);
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

function wait(outdir, seconds) {
  const meta = JSON.parse(read(path.join(outdir, 'meta.json')));
  const exitFile = path.join(outdir, `exit-${meta.turns}`);
  const deadline = Date.now() + seconds * 1000;
  while (!fs.existsSync(exitFile) && Date.now() < deadline) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);
  if (!fs.existsSync(exitFile)) {
    if (meta.pid && !alive(meta.pid)) { process.stdout.write(`${meta.briefId}: died (turn ${meta.turns}; pid ${meta.pid} gone, no exit file). Its Bash task was killed; start a fresh brief or resume if it has a thread id.\n`); process.exit(4); }
    process.stdout.write(`${meta.briefId}: still running (turn ${meta.turns})\n`); process.exit(3);
  }
  process.stdout.write(read(path.join(outdir, 'report.md')) + '\n');
}

module.exports = { findSiblings };

const [cmd, ...a] = require.main === module ? process.argv.slice(2) : ['--required'];
if (cmd === '--required') {
  // Loaded by a test: no CLI.
} else if (cmd === 'start') {
  const [role, workstream, briefFile, allowedFile, outdir, effortArg] = a;
  if (!['test-writer', 'implementor'].includes(role) || !outdir) die('usage: start <test-writer|implementor> <workstream> <brief.md> <allowed.txt> <outdir> [effort]');
  if (!CODEX_JS) die('codex CLI not found (npm i -g @openai/codex, or set CODEX_JS to its bin/codex.js)');
  // The role's settings, with the brief's own effort as a one-off override. Checked before any
  // directory exists, so a refusal leaves nothing behind.
  const cfg = roleConfig(role);
  const { model, tier } = cfg;
  const effort = effortArg || cfg.effort;
  checkConfig({ model, tier });
  if (fs.existsSync(path.join(outdir, 'meta.json'))) die(`${outdir} already holds a brief; use a fresh directory or resume`);
  fs.mkdirSync(outdir, { recursive: true });
  const brief = read(briefFile);
  const allowed = read(allowedFile).split(/\r?\n/).map((s) => s.trim().replace(/\\/g, '/')).filter(Boolean);
  const briefId = (brief.match(/Brief\s+([TI]-[\w.-]+)/) || [])[1] || path.basename(outdir);
  fs.writeFileSync(path.join(outdir, 'meta.json'), JSON.stringify({ briefId, role, workstream, model, effort, tier, allowed, turns: 0 }, null, 2));
  fs.writeFileSync(path.join(outdir, 'before.json'), JSON.stringify(snapshot()));
  fs.writeFileSync(path.join(outdir, 'prompt.md'), buildPrompt(role, workstream, brief, allowed));
  process.stdout.write(`${briefId}: started on ${model} (${effort}${tier ? `, ${tier}` : ''}); wait with: node ${path.relative(ROOT, __filename)} wait "${outdir}"\n`);
  launch(outdir, 'start');
} else if (cmd === 'resume') {
  const [outdir, messageFile] = a;
  const meta = JSON.parse(read(path.join(outdir, 'meta.json')));
  if (!fs.existsSync(path.join(outdir, `exit-${meta.turns}`)) && !(meta.pid && !alive(meta.pid))) die(`${meta.briefId} is still running`);
  if (!meta.threadId) die(`${meta.briefId} has no Codex thread id to resume; start a fresh brief`);
  checkConfig({ ...roleConfig(meta.role), ...meta });
  meta.turns += 1;
  fs.writeFileSync(path.join(outdir, `message-${meta.turns}.md`), read(messageFile));
  fs.writeFileSync(path.join(outdir, 'meta.json'), JSON.stringify(meta, null, 2));
  process.stdout.write(`${meta.briefId}: resumed (turn ${meta.turns})\n`);
  launch(outdir, 'resume');
} else if (cmd === 'wait') {
  wait(a[0], Number(a[1] || 540));
} else {
  die('usage: start | wait | resume (see the header of this file)');
}
