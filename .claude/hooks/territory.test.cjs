// Tests for territory.cjs's scratch allowance and refusals. Run: node --test .claude/hooks/territory.test.cjs
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { load, refusal, scratchAllowed, scratchNote } = require('./territory.cjs');

const fwd = (p) => p.split(path.sep).join('/');

// A fake session scratchpad at <tmpdir>/claude/<project>/<session>/scratchpad, the shape the
// guard requires, and a fake repo whose .claude/territories hold the given files.
function setup(t, territoryFiles) {
  const project = `territory-test-${process.pid}-${Math.random().toString(36).slice(2)}`;
  const projectDir = path.join(os.tmpdir(), 'claude', project);
  const pad = path.join(projectDir, 'session-1', 'scratchpad');
  fs.mkdirSync(path.join(pad, 'billing'), { recursive: true });
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'territory-test-repo-'));
  fs.mkdirSync(path.join(repo, '.claude', 'territories'), { recursive: true });
  t.after(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  });
  const files = territoryFiles({ pad, projectDir, project });
  Object.entries(files).forEach(([name, body]) => fs.writeFileSync(path.join(repo, '.claude', 'territories', name), body));
  return { pad, projectDir, repo, territories: load(repo) };
}

const billing = ({ pad }) => ({ billing: `src/billing/*\nscratch ${fwd(path.join(pad, 'billing'))}\nagent a-billing\n` });

test('an architect may write strictly inside its registered scratch folder, in any spelling', (t) => {
  const { pad, territories } = setup(t, billing);
  const inBilling = path.join(pad, 'billing', 'codex', 'T-1', 'in', 'brief.md');
  assert.equal(scratchAllowed(territories, 'a-billing', inBilling), true);
  assert.equal(scratchAllowed(territories, 'a-billing', fwd(inBilling)), true);
  if (process.platform === 'win32') {
    const shell = (p) => fwd(p).replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`);
    assert.equal(scratchAllowed(territories, 'a-billing', path.join(pad, 'BILLING', 'x.md')), true);
    assert.equal(scratchAllowed(territories, 'a-billing', shell(inBilling)), true);
  }
});

test('a scratch line in Git Bash spelling registers the same folder', { skip: process.platform !== 'win32' }, (t) => {
  const shell = (p) => fwd(p).replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`);
  const { pad, territories } = setup(t, ({ pad: p }) => ({ billing: `src/billing/*\nscratch ${shell(path.join(p, 'billing'))}\nagent a-billing\n` }));
  assert.equal(scratchAllowed(territories, 'a-billing', path.join(pad, 'billing', 'x.md')), true);
});

test('a relative file resolves against the base it is given, as repoRelative does', (t) => {
  const { pad, territories } = setup(t, billing);
  assert.equal(scratchAllowed(territories, 'a-billing', 'x.md', path.join(pad, 'billing')), true);
  assert.equal(scratchAllowed(territories, 'a-billing', 'x.md', path.join(pad, 'other')), false);
});

test('the folder itself, its parent, siblings and escapes are refused', (t) => {
  const { pad, territories } = setup(t, billing);
  const refused = [
    path.join(pad, 'billing'),
    path.join(pad, 'x.md'),
    path.join(pad, 'billing-notes.md'),
    path.join(pad, 'billingX', 'x.md'),
    path.join(pad, 'other', 'x.md'),
    `${fwd(path.join(pad, 'billing'))}/../other/x.md`,
  ];
  refused.forEach((p) => assert.equal(scratchAllowed(territories, 'a-billing', p), false, p));
});

test('another session or project with the same workstream name is refused', (t) => {
  const { projectDir, territories } = setup(t, billing);
  const otherSession = path.join(projectDir, 'session-2', 'scratchpad', 'billing', 'x.md');
  const otherProject = path.join(os.tmpdir(), 'claude', 'another-project', 'session-1', 'scratchpad', 'billing', 'x.md');
  assert.equal(scratchAllowed(territories, 'a-billing', otherSession), false);
  assert.equal(scratchAllowed(territories, 'a-billing', otherProject), false);
});

test('a scratch line that is missing, relative, or not shaped like a workstream folder registers nothing', (t) => {
  const { pad, territories } = setup(t, ({ pad: p }) => ({
    none: 'src/none/*\nagent a-none\n',
    relative: 'src/relative/*\nscratch scratchpad/relative\nagent a-relative\n',
    root: `src/root/*\nscratch ${fwd(p)}\nagent a-root\n`,
    tmp: `src/tmp/*\nscratch ${fwd(os.tmpdir())}\nagent a-tmp\n`,
    wrongname: `src/wrongname/*\nscratch ${fwd(path.join(p, 'billing'))}\nagent a-wrongname\n`,
    deep: `src/deep/*\nscratch ${fwd(path.join(p, 'deep', 'sub'))}\nagent a-deep\n`,
  }));
  fs.mkdirSync(path.join(pad, 'deep', 'sub'), { recursive: true });
  assert.equal(scratchAllowed(territories, 'a-none', path.join(pad, 'none', 'x.md')), false);
  assert.equal(scratchAllowed(territories, 'a-relative', path.join(pad, 'relative', 'x.md')), false);
  assert.equal(scratchAllowed(territories, 'a-root', path.join(pad, 'root', 'x.md')), false);
  assert.equal(scratchAllowed(territories, 'a-root', path.join(pad, 'billing', 'x.md')), false);
  assert.equal(scratchAllowed(territories, 'a-tmp', path.join(os.tmpdir(), 'x.md')), false);
  assert.equal(scratchAllowed(territories, 'a-wrongname', path.join(pad, 'billing', 'x.md')), false);
  assert.equal(scratchAllowed(territories, 'a-deep', path.join(pad, 'deep', 'sub', 'x.md')), false);
});

test('an architect no territory names gets no scratch allowance', (t) => {
  const { pad, territories } = setup(t, billing);
  assert.equal(scratchAllowed(territories, 'a-unknown', path.join(pad, 'billing', 'x.md')), false);
});

test('refusal keeps its plain message for git-policy; the write guard CLI adds the scratch note', (t) => {
  const { pad, repo, territories } = setup(t, billing);
  assert.equal(refusal(territories, 'architect', 'a-billing', null), '(a path outside the repository) is outside your territory, billing.');
  assert.match(scratchNote(territories, 'a-billing'), /^ Outside the repo you may write only inside .*billing\.$/);

  const cli = (file) => spawnSync(process.execPath, [path.join(__dirname, 'territory.cjs'), 'a-billing', 'architect', file], {
    env: { ...process.env, CLAUDE_PROJECT_DIR: repo },
    encoding: 'utf8',
  }).stdout.split('\n');
  assert.equal(cli(path.join(pad, 'billing', 'x.md'))[1], 'ok');
  const [, refused] = cli(path.join(pad, 'other', 'x.md'));
  assert.match(refused, /is outside your territory, billing\. Outside the repo you may write only inside /);
});

test('with no valid scratch line, the note says so', (t) => {
  const { territories } = setup(t, () => ({ none: 'src/none/*\nagent a-none\n' }));
  assert.match(scratchNote(territories, 'a-none'), /you may write nothing, because your territory registers no scratch folder/);
});
