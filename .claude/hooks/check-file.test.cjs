// Tests for check-file.sh: which vitest run an edited file gets. A slow or perf test gets none,
// because the normal run excludes it. Run from a shell whose `bash` is the one the hooks use
// (Git Bash on Windows):
//   node --test .claude/hooks/check-file.test.cjs
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ORDERS = ['packages', 'app', 'src', 'orders'];
const REL = ORDERS.join('/');
// Stubs for node_modules/.bin, which the hook prefers over pnpm exec. tsgo is absent, so the
// hook falls back to tsc; vitest records its arguments, one run per line.
const BIN = {
  tsc: '#!/bin/sh\nexit 0\n',
  eslint: '#!/bin/sh\nexit 0\n',
  vitest: '#!/bin/sh\nprintf \'%s\\n\' "$*" >> vitest-args.log\nexit 0\n',
};

// A fake project: the hook under .claude/hooks, stub tools, and the given files in
// packages/app/src/orders/. Returns a function that runs the hook for one edited file and
// reports its exit status and the vitest runs it made.
function setup(t, files) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'check-file-test-'));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const hooks = path.join(repo, '.claude', 'hooks');
  const bin = path.join(repo, 'node_modules', '.bin');
  [hooks, bin, path.join(repo, ...ORDERS)].forEach((d) => fs.mkdirSync(d, { recursive: true }));
  ['check-file.sh', 'hook-input.cjs'].forEach((f) => fs.copyFileSync(path.join(__dirname, f), path.join(hooks, f)));
  Object.entries(BIN).forEach(([name, body]) => fs.writeFileSync(path.join(bin, name), body, { mode: 0o755 }));
  files.forEach((f) => fs.writeFileSync(path.join(repo, ...ORDERS, f), 'export {};\n'));
  const log = path.join(repo, 'vitest-args.log');
  return (file, agentType = 'architect') => {
    fs.rmSync(log, { force: true });
    // The hook's own input shape: an absolute path in the platform's spelling (backslashes on Windows).
    const r = spawnSync('bash', [path.join(hooks, 'check-file.sh')], {
      input: JSON.stringify({ agent_id: 'a-1', agent_type: agentType, tool_input: { file_path: path.join(repo, ...ORDERS, file) } }),
      env: { ...process.env, CLAUDE_PROJECT_DIR: repo },
      encoding: 'utf8',
    });
    const runs = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [];
    return { status: r.status, stderr: r.stderr, runs };
  };
}

const FILES = ['probe.ts', 'probe.test.ts', 'probe.slow.test.ts', 'probe.perf.test.ts', 'View.slow.test.tsx', 'View.perf.test.tsx'];

test('an edited normal test is run by file', (t) => {
  const edit = setup(t, FILES);
  const r = edit('probe.test.ts');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.runs, [`run ${REL}/probe.test.ts`]);
});

test('an edited slow or perf test gets no vitest run', (t) => {
  const edit = setup(t, FILES);
  for (const file of ['probe.slow.test.ts', 'probe.perf.test.ts', 'View.slow.test.tsx', 'View.perf.test.tsx']) {
    const r = edit(file);
    assert.equal(r.status, 0, `${file}: ${r.stderr}`);
    assert.deepEqual(r.runs, [], file);
  }
});

test('an edited contract runs its normal test, never its slow or perf sibling', (t) => {
  const edit = setup(t, FILES);
  const r = edit('probe.ts', 'implementor');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.runs, [`run ${REL}/probe.test.ts`]);
});
