#!/usr/bin/env node
// Territories: the files each workstream may write, one file per workstream in
// .claude/territories/, written by the orchestrator. `agent <id>` lines name the architect(s)
// holding it; `scratch <absolute path>` lines name the folders outside the repo it may write
// (its <scratchpad>/<workstream>); every other line that is not blank or a # comment is a glob
// matched against the repo-relative path, where * and ? cross /. Anything in no territory is the orchestrator's
// reserve. Shared by guard-writes.sh (through the CLI at the bottom) and git-policy.cjs.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Git Bash spells C:\a as /c/a. One spelling before any comparison.
function fromShell(p) {
  const m = process.platform === 'win32' && /^\/([a-zA-Z])(\/|$)/.exec(p);
  return m ? `${m[1]}:/${p.slice(3)}` : p;
}

// The real path of p, symlinks followed, whether or not p exists yet.
function real(p) {
  let head = path.resolve(p);
  const tail = [];
  while (!fs.existsSync(head)) {
    const up = path.dirname(head);
    if (up === head) break;
    tail.unshift(path.basename(head));
    head = up;
  }
  let resolved = head;
  try { resolved = fs.realpathSync.native(head); } catch { /* keep the lexical path */ }
  return path.join(resolved, ...tail);
}

// The repo-relative, forward-slash path of p (resolved against base), or null outside root.
function repoRelative(root, p, base = root) {
  const abs = real(path.resolve(fromShell(base), fromShell(p)));
  const rel = path.relative(real(fromShell(root)), abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}

function globToRegExp(glob) {
  const body = glob.split('').map((c) => (c === '*' ? '.*' : c === '?' ? '.' : c.replace(/[.+^${}()|[\]\\/]/g, '\\$&'))).join('');
  return new RegExp(`^${body}$`, process.platform === 'win32' ? 'i' : '');
}

function load(root) {
  const dir = path.join(fromShell(root), '.claude', 'territories');
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names
    .filter((name) => fs.statSync(path.join(dir, name)).isFile())
    .map((name) => {
      const lines = fs.readFileSync(path.join(dir, name), 'utf8').split(/\r?\n/)
        .map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
      const keyed = (l) => l.startsWith('agent ') || l.startsWith('scratch ');
      return {
        name,
        agents: lines.filter((l) => l.startsWith('agent ')).map((l) => l.slice(6).trim()),
        scratch: lines.filter((l) => l.startsWith('scratch ')).map((l) => l.slice(8).trim()),
        globs: lines.filter((l) => !keyed(l)).map(globToRegExp),
      };
    });
}

const holders = (territories, rel) => territories.filter((t) => t.globs.some((g) => g.test(rel)));

// Why this agent may not write rel, or null when it may. Only architects, test-writers and
// implementors are fenced by territories.
function refusal(territories, agentType, agentId, rel) {
  const shown = rel ?? '(a path outside the repository)';
  if (agentType === 'architect') {
    const own = territories.find((t) => t.agents.includes(agentId));
    if (!own) return `no territory names architect ${agentId}. The orchestrator registers each architect after spawning it. Report BLOCKED with this id.`;
    if (rel === null) {
      const roots = scratchRoots(own);
      const where = roots.length
        ? `you may write only inside ${roots.join(' or ')}`
        : 'you may write nothing, because your territory registers no scratch folder shaped <tmpdir>/claude/<project>/<session>/scratchpad/<territory name>; ask the orchestrator for one';
      return `${shown} is outside your territory, ${own.name}. Outside the repo ${where}.`;
    }
    const hs = holders(territories, rel);
    if (!hs.includes(own)) return `${rel} is outside your territory, ${own.name}. A shared file is a NEEDS report and another territory's file is a CROSS report, both to the orchestrator.`;
    if (hs.length > 1) return `${rel} is in territories ${hs.map((t) => t.name).join(' and ')}. Territories overlap; report BLOCKED to the orchestrator.`;
    return null;
  }
  if (agentType === 'implementor' || agentType === 'test-writer') {
    if (territories.length === 0) return null;
    if (rel === null) return `${shown} is in no architect's territory.`;
    const hs = holders(territories, rel);
    if (hs.length === 0) return `${rel} is in no architect's territory. Report it under Blocked on; your architect takes it to the orchestrator.`;
    if (hs.length > 1) return `${rel} is in territories ${hs.map((t) => t.name).join(' and ')}. Territories overlap; report it under Blocked on.`;
    return null;
  }
  return null;
}

// Whether a territory architect may write file outside the repo: only strictly inside a folder
// its territory registers with a `scratch <absolute path>` line. The orchestrator writes that
// line (territory files are reserve, so no architect can) with its own session's
// <scratchpad>/<workstream>, the folder the brief hands the architect and codex-subagents uses.
// The registered path is the trusted session context: no line, no scratch writes. A second
// gate keeps a mistyped line from widening it: the registered folder itself must have the shape
// <tmpdir>/claude/<project>/<session>/scratchpad/<territory name>, so a line naming the
// scratchpad root, the temp directory or any other folder registers nothing. Both paths are
// canonicalised (symlinks, .., and the 8.3 and long spellings of one folder resolve alike).
// Writes only: git-policy.cjs never consults this, so a scratch path is still no commit pathspec.
const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
const inside = (dir, p) => {
  const rel = path.relative(dir, p);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

function scratchShaped(root, name) {
  const pads = real(path.join(require('node:os').tmpdir(), 'claude'));
  if (!inside(pads, root)) return false;
  const shape = path.relative(pads, root).split(path.sep);
  return shape.length === 4 && same(shape[2], 'scratchpad') && same(shape[3], name);
}

// The canonical scratch folders a territory registers that pass the shape gate. The verdict
// (scratchAllowed) and the refusal message both read this, so they can't drift apart.
function scratchRoots(own) {
  return own.scratch
    .filter((dir) => path.isAbsolute(fromShell(dir)))
    .map((dir) => real(path.resolve(fromShell(dir))))
    .filter((root) => scratchShaped(root, own.name));
}

function scratchAllowed(territories, agentId, file) {
  const own = territories.find((t) => t.agents.includes(agentId));
  if (!own) return false;
  const abs = real(path.resolve(fromShell(file)));
  return scratchRoots(own).some((root) => inside(root, abs));
}

module.exports = { fromShell, repoRelative, load, holders, refusal, scratchAllowed };

// CLI for guard-writes.sh: node territory.cjs <agent_id> <agent_type> <path>
// Prints the canonical repo-relative path (empty outside the repo), then `ok` or the refusal.
if (require.main === module) {
  const [agentId, agentType, file] = process.argv.slice(2);
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const rel = repoRelative(root, file);
  const territories = load(root);
  const scratch = agentType === 'architect' && rel === null && scratchAllowed(territories, agentId, file);
  const why = scratch ? null : refusal(territories, agentType, agentId, rel);
  process.stdout.write(`${rel ?? ''}\n${why ?? 'ok'}\n`);
}
