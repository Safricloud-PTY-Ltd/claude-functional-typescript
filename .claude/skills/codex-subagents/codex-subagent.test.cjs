// Tests for codex-subagent.cjs's sibling lookup (issue #10). Run: node --test .claude/skills/codex-subagents/codex-subagent.test.cjs
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { findSiblings } = require('./codex-subagent.cjs');

const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'codex-subagent-test-'));
const writeMeta = (dir, meta) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta));
};
// The skill's layout: <scratch>/<ws>/codex/<brief id>/{in,run}.
const runDir = (root, id) => path.join(root, 'billing', 'codex', id, 'run');
const brief = (root, id, allowed) => {
  fs.mkdirSync(path.join(root, 'billing', 'codex', id, 'in'), { recursive: true });
  writeMeta(runDir(root, id), { briefId: id, allowed });
};
const ids = (siblings) => siblings.map((s) => s.briefId).sort();

test('two concurrent briefs in the skill layout find each other', (t) => {
  const root = scratch();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  brief(root, 'T-billing-2.1', ['a.test.ts']);
  brief(root, 'T-billing-2.2', ['b.test.ts']);

  const fromFirst = findSiblings(runDir(root, 'T-billing-2.1'));
  const fromSecond = findSiblings(runDir(root, 'T-billing-2.2'));

  assert.deepEqual(ids(fromFirst), ['T-billing-2.2']);
  assert.equal(fromFirst.find((s) => s.allowed.includes('b.test.ts'))?.briefId, 'T-billing-2.2');
  assert.deepEqual(ids(fromSecond), ['T-billing-2.1']);
});

test('a brief never counts itself as a sibling', (t) => {
  const root = scratch();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  brief(root, 'I-billing-3.1', ['src/x.ts']);

  assert.deepEqual(findSiblings(runDir(root, 'I-billing-3.1')), []);
});

test('the older flat layout (codex/<brief id>) still finds siblings', (t) => {
  const root = scratch();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const codex = path.join(root, 'runtime', 'codex');
  writeMeta(path.join(codex, 'I-runtime-3.1'), { briefId: 'I-runtime-3.1', allowed: ['a.ts'] });
  writeMeta(path.join(codex, 'I-runtime-3.2'), { briefId: 'I-runtime-3.2', allowed: ['b.ts'] });

  assert.deepEqual(ids(findSiblings(path.join(codex, 'I-runtime-3.1'))), ['I-runtime-3.2']);
});

test('a sibling meta.json caught mid-write is skipped, not fatal', (t) => {
  const root = scratch();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  brief(root, 'T-billing-2.1', ['a.test.ts']);
  brief(root, 'T-billing-2.3', ['c.test.ts']);
  fs.mkdirSync(runDir(root, 'T-billing-2.2'), { recursive: true });
  fs.writeFileSync(path.join(runDir(root, 'T-billing-2.2'), 'meta.json'), '{"briefId": "T-bil');

  assert.deepEqual(ids(findSiblings(runDir(root, 'T-billing-2.1'))), ['T-billing-2.3']);
});
