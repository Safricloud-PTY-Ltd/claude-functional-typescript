// Tests for guard-writes.sh: which test files a test-writer may write, slow and perf tests
// included. Run from a shell whose `bash` is the one the hooks use (Git Bash on Windows):
//   node --test .claude/hooks/guard-writes.test.cjs
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOOKS = ['guard-writes.sh', 'hook-input.cjs', 'territory.cjs'];
const ORDERS = ['packages', 'app', 'src', 'orders'];

// A fake repo: the guard and what it calls under .claude/hooks (it runs them from
// CLAUDE_PROJECT_DIR), and the given files, empty, in packages/app/src/orders/.
function setup(t, files) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-writes-test-'));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const hooks = path.join(repo, '.claude', 'hooks');
  fs.mkdirSync(hooks, { recursive: true });
  HOOKS.forEach((f) => fs.copyFileSync(path.join(__dirname, f), path.join(hooks, f)));
  fs.mkdirSync(path.join(repo, ...ORDERS), { recursive: true });
  files.forEach((f) => fs.writeFileSync(path.join(repo, ...ORDERS, f), ''));
  // The hook's own input shape: an absolute path in the platform's spelling (backslashes on Windows).
  const run = (agentType, absolute) => spawnSync('bash', [path.join(hooks, 'guard-writes.sh')], {
    input: JSON.stringify({ agent_id: `a-${agentType}`, agent_type: agentType, tool_input: { file_path: absolute } }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: repo },
    encoding: 'utf8',
  });
  const guard = (agentType, file) => run(agentType, path.join(repo, ...ORDERS, file));
  // A path given from the repo root, or outside it, rather than inside packages/app/src/orders/.
  guard.at = (agentType, ...segments) => run(agentType, path.join(repo, ...segments));
  // The path exactly as given, unresolved.
  guard.raw = run;
  guard.repo = repo;
  return guard;
}

const DESIGN = ['contributions', 'in-progress', '2026-10-01-invoicing', 'design'];

test('a test-writer may write a normal, slow or perf test beside its contract', (t) => {
  const guard = setup(t, ['lineTotal.ts', 'Row.tsx']);
  for (const file of ['lineTotal.test.ts', 'lineTotal.test-d.ts', 'lineTotal.slow.test.ts', 'lineTotal.perf.test.ts', 'Row.slow.test.tsx', 'Row.perf.test.tsx']) {
    const r = guard('test-writer', file);
    assert.equal(r.status, 0, `${file}: ${r.stderr}`);
  }
});

test('a slow or perf test with no contract is refused, naming the contract it looked for', (t) => {
  const guard = setup(t, ['lineTotal.ts']);
  for (const file of ['missing.slow.test.ts', 'missing.perf.test.tsx']) {
    const r = guard('test-writer', file);
    assert.equal(r.status, 2, file);
    assert.match(r.stderr, /no contract at packages\/app\/src\/orders\/missing\.ts or packages\/app\/src\/orders\/missing\.tsx/);
  }
});

test('an implementor may not edit a slow or perf test', (t) => {
  const guard = setup(t, ['lineTotal.ts', 'lineTotal.slow.test.ts', 'lineTotal.perf.test.ts']);
  for (const file of ['lineTotal.slow.test.ts', 'lineTotal.perf.test.ts']) {
    const r = guard('implementor', file);
    assert.equal(r.status, 2, file);
    assert.match(r.stderr, /implementor does not edit tests/);
  }
});

test('a designer may write inside its effort design folder, whether or not the file exists yet', (t) => {
  const guard = setup(t, []);
  for (const file of ['design.md', 'option-a.html', path.join('assets', 'logo.svg')]) {
    const r = guard.at('designer', ...DESIGN, file);
    assert.equal(r.status, 0, `${file}: ${r.stderr}`);
  }
});

test('a designer is refused everywhere else, product code and the rest of its effort folder included', (t) => {
  const guard = setup(t, ['lineTotal.ts']);
  const elsewhere = [
    ['packages', 'app', 'src', 'orders', 'lineTotal.ts'],
    ['packages', 'web', 'src', 'theme', 'tokens.css'],
    ['contributions', 'in-progress', '2026-10-01-invoicing', 'review.md'],
    ['contributions', 'in-progress', '2026-10-01-invoicing', 'billing', 'plan.md'],
    ['contributions', 'complete', '2026-09-05-order-totals', 'design', 'design.md'],
    ['contributions', 'in-progress', 'design', 'design.md'],
    ['.claude', 'agents', 'designer.md'],
    ['CLAUDE.md'],
  ];
  for (const segments of elsewhere) {
    const r = guard.at('designer', ...segments);
    assert.equal(r.status, 2, segments.join('/'));
    assert.match(r.stderr, /the designer writes only inside contributions\/in-progress\/<id>\/design\//, segments.join('/'));
  }
});

test('a designer cannot climb out of its folder with .. in the path it gives', (t) => {
  const guard = setup(t, []);
  // Raw strings: path.join would resolve the .. before the hook ever saw it.
  const design = [guard.repo, ...DESIGN].join(path.sep);
  const climbs = [
    [design, '..', 'review.md'],
    [design, '..', '..', '..', '..', 'CLAUDE.md'],
    [guard.repo, '..', 'outside-the-repo.html'],
  ];
  for (const segments of climbs) {
    const file = segments.join(path.sep);
    const r = guard.raw('designer', file);
    assert.equal(r.status, 2, file);
    assert.match(r.stderr, /the designer writes only inside/, file);
  }
  // The same shape that stays inside is still allowed.
  const inside = [design, 'drafts', '..', 'option-a.html'].join(path.sep);
  assert.equal(guard.raw('designer', inside).status, 0, inside);
});
