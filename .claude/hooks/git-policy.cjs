#!/usr/bin/env node
// Which git and gh commands a sub-agent may run. Called by guard-git.sh with the hook's JSON on
// stdin; exit 0 allows, exit 2 blocks with the reason on stderr. Deny by default:
//
//   main session (no agent_id)  anything: the orchestrator, or a solo architect
//   git-manager (a sub-agent)   any git and any gh, except a `git push` that would change main
//                               or master, delete a remote ref, or force without a lease: the
//                               branch, the remote, the PR and CI are its job
//   every other sub-agent       read-only git verbs (READ_ONLY below), `git -C <dir>` and
//                               `--no-pager` only as global options; read-only gh (ghReadOnly)
//   architect (a sub-agent)     also `git add` and `git commit`, with explicit paths, when
//                               every file git reports the command would stage or commit lies
//                               in the architect's own territory and in no other
//
// git and gh must run as plain commands: behind xargs, env, a shell -c string, eval, or a
// command substitution the guard can't read them, so it refuses. It fences mistakes by
// cooperative agents; it is not a sandbox.
'use strict';
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { fromShell, repoRelative, load, refusal } = require('./territory.cjs');

const READ_ONLY = new Set(['status', 'diff', 'log', 'show', 'grep', 'blame', 'rev-parse', 'ls-files',
  'ls-tree', 'cat-file', 'describe', 'shortlog', 'merge-base', 'archive', 'rev-list', 'show-ref',
  'for-each-ref', 'name-rev', 'check-ignore']);
const LISTING = { branch: ['--show-current', '--list', '-l', '-a', '-r', '-v', '-vv', '--all'], remote: ['-v'] };
const WRAPPERS = new Set(['sh', 'bash', 'zsh', 'dash', 'eval', 'exec', 'xargs', 'env', 'command',
  'sudo', 'nice', 'nohup', 'time', 'timeout', 'pwsh', 'powershell', 'cmd', 'cmd.exe', 'find', 'parallel']);

// gh subcommands that only read, in any group (`gh pr view`, `gh run watch`), and groups that
// only read.
const GH_READ = new Set(['view', 'list', 'status', 'diff', 'checks', 'watch']);
const GH_READ_GROUPS = new Set(['search', 'help', 'version', '--version', '--help', '-h']);
// git's global options whose value can come as the next word; without this, `git --work-tree .
// push` would read `.` as the verb.
const GLOBAL_WITH_VALUE = new Set(['-c', '--git-dir', '--work-tree', '--namespace', '--config-env',
  '--super-prefix', '--attr-source', '--list-cmds']);
// A push destination naming the default branch, which changes only by merging the PR.
const PROTECTED = /^\+?(?:[^:]*:)?(?:refs\/heads\/)?(main|master)$/;

const isGit = (w) => /(^|[\\/])git(\.exe)?$/i.test(w);
const isGh = (w) => /(^|[\\/])gh(\.exe)?$/i.test(w);
const isTool = (w) => isGit(w) || isGh(w);

class Refused extends Error {}
const refuse = (why) => { throw new Refused(why); };

// Shell words and operators. Quotes are honoured; redirections are dropped with their target.
function tokenize(s) {
  const out = [];
  let cur = null;
  let quoted = false;
  // What bash would still expand in the word: `bare` holds its unquoted characters (quoted or
  // escaped ones as \0), and `dollar` notes a $ outside single quotes.
  let bare = '';
  let dollar = false;
  const expands = () => dollar || /[*?[]/.test(bare) || /\{[^{}]*(,|\.\.)[^{}]*\}/.test(bare) || bare.startsWith('~');
  const reset = () => { cur = null; quoted = false; bare = ''; dollar = false; };
  const push = () => { if (cur !== null) out.push({ word: cur, quoted, expands: expands() }); reset(); };
  for (let i = 0; i < s.length;) {
    const c = s[i];
    if (c === "'") {
      const j = s.indexOf("'", i + 1);
      if (j < 0) refuse('an unterminated quote');
      cur = (cur ?? '') + s.slice(i + 1, j); bare += '\0'; quoted = true; i = j + 1; continue;
    }
    if (c === '"') {
      let j = i + 1;
      let buf = '';
      while (j < s.length && s[j] !== '"') {
        if (s[j] === '\\' && s[j + 1] === '\n') { j += 2; continue; }   // a line continuation: bash drops both
        if (s[j] === '\\' && j + 1 < s.length && '"\\$`'.includes(s[j + 1])) { buf += s[j + 1]; j += 2; continue; }
        if (s[j] === '`' || s.startsWith('$(', j)) refuse('a command substitution');
        if (s[j] === '$') dollar = true;
        buf += s[j]; j += 1;
      }
      if (j >= s.length) refuse('an unterminated quote');
      cur = (cur ?? '') + buf; bare += '\0'; quoted = true; i = j + 1; continue;
    }
    if (c === '\\' && s[i + 1] === '\n') { i += 2; continue; }   // a line continuation: the word goes on
    if (c === '\\' && i + 1 < s.length) { cur = (cur ?? '') + s[i + 1]; bare += '\0'; i += 2; continue; }
    if (c === '`' || s.startsWith('$(', i)) refuse('a command substitution');
    if (s.startsWith('<<', i)) refuse('a heredoc');
    if (s.startsWith('<(', i) || s.startsWith('>(', i)) refuse('a process substitution');
    // An unquoted < or > ends the word before it (`HEAD:main>log` is HEAD:main, redirected),
    // unless that word is all digits, which makes it the redirected descriptor.
    if ((c === '<' || c === '>' || (c === '&' && s[i + 1] === '>')) && cur !== null && !/^\d+$/.test(cur)) push();
    if (c === '#' && cur === null) { const j = s.indexOf('\n', i); i = j < 0 ? s.length : j; continue; }
    if (c === '\n') { push(); out.push({ op: ';' }); i += 1; continue; }
    if (/\s/.test(c)) { push(); i += 1; continue; }
    const redirect = cur === null || /^\d+$/.test(cur) ? /^(&>>?|>>?&?|<&?)(\d+|-)?/.exec(s.slice(i)) : null;
    if (redirect) {
      reset();
      out.push({ op: redirect[2] ? 'dup' : 'redirect' });
      i += redirect[0].length; continue;
    }
    const op = ['&&', '||', ';', '|', '&', '(', ')'].find((o) => s.startsWith(o, i));
    if (op) { push(); out.push({ op }); i += op.length; continue; }
    if (c === '$') dollar = true;
    cur = (cur ?? '') + c; bare += c; i += 1;
  }
  push();
  return out;
}

// Every git or gh invocation in the command: { tool, dir, globals, verb, args, assigned }.
// For gh, verb is the group (`pr`) and args start at its subcommand.
function invocations(command, cwd) {
  const tokens = tokenize(command);
  const segments = [[]];
  for (let k = 0; k < tokens.length; k += 1) {
    const t = tokens[k];
    if (t.op === 'redirect') { k += 1; continue; }        // drop the redirection's target
    if (t.op === 'dup') continue;
    if (t.op) { segments.push([]); continue; }
    segments[segments.length - 1].push(t);
  }
  let dir = cwd;
  const found = [];
  for (const seg of segments) {
    let k = 0;
    while (k < seg.length && !seg[k].quoted && /^[A-Za-z_][A-Za-z0-9_]*=/.test(seg[k].word)) k += 1;
    const assigned = k > 0;
    if (k >= seg.length) continue;
    const head = seg[k].word;
    if (head === 'cd') {
      const to = seg[k + 1]?.word;
      if (to && to !== '-') dir = path.resolve(fromShell(dir), fromShell(to));
      continue;
    }
    if (!isTool(head)) {
      const rest = seg.slice(k + 1);
      if (rest.some((t) => !t.quoted && isTool(t.word))) refuse(`git or gh behind \`${head}\` (if the word is only text, quote it)`);
      if (WRAPPERS.has(path.basename(head).toLowerCase()) && rest.some((t) => /\b(git|gh)\b/.test(t.word))) refuse(`git or gh behind \`${head}\``);
      continue;
    }
    // The guard judges the words it sees; bash would hand git something else.
    if (seg.slice(k).some((t) => t.expands)) refuse('a shell expansion ($, a glob, a brace list or ~) in a git or gh command, which the guard can\'t see past; write the value literally (quote a glob meant for git)');
    if (isGh(head)) {
      found.push({ tool: 'gh', dir, globals: [], verb: seg[k + 1]?.word ?? '', args: seg.slice(k + 2).map((t) => t.word), assigned });
      continue;
    }
    let at = dir;
    const globals = [];
    let j = k + 1;
    while (j < seg.length && seg[j].word.startsWith('-')) {
      if (seg[j].word === '-C') { at = path.resolve(fromShell(at), fromShell(seg[j + 1]?.word ?? '.')); j += 2; continue; }
      globals.push(seg[j].word); j += 1;
      if (GLOBAL_WITH_VALUE.has(seg[j - 1].word)) { globals.push(seg[j]?.word ?? ''); j += 1; }
    }
    found.push({ tool: 'git', dir: at, globals, verb: seg[j]?.word ?? '', args: seg.slice(j + 1).map((t) => t.word), assigned });
  }
  return found;
}

// Split args into options and paths; `--` ends the options.
function split(args, takesValue) {
  const options = [];
  const paths = [];
  for (let k = 0; k < args.length; k += 1) {
    const a = args[k];
    if (a === '--') { paths.push(...args.slice(k + 1)); break; }
    if (a.startsWith('-') && a !== '-') {
      options.push(a);
      if (takesValue(a)) k += 1;
    } else paths.push(a);
  }
  return { options, paths };
}

function gitLines(dir, args) {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  if (r.status !== 0) refuse(`the guard could not ask git which files \`git ${args.join(' ')}\` touches (${(r.stderr || '').trim().split('\n')[0]})`);
  return r.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
}

function checkAffected(root, territories, agentId, verb, files) {
  const problems = [...new Set(files)]
    .map((f) => refusal(territories, 'architect', agentId, repoRelative(root, f)))
    .filter(Boolean);
  if (problems.length) {
    refuse(`\`git ${verb}\` would take in files outside your territory:\n  ${problems.slice(0, 5).join('\n  ')}${problems.length > 5 ? `\n  (and ${problems.length - 5} more)` : ''}\nName only your own files.`);
  }
}

// Every file under paths whose working copy, staged copy or untracked state differs from HEAD:
// what `git add -- paths` or `git commit -- paths` would stage, commit or unstage. The staged
// set matters: a file another architect staged, whose working copy now matches HEAD, shows in
// no working-tree diff, yet naming it would overwrite that staged change.
function touched(dir, paths) {
  const unstaged = gitLines(dir, ['diff', '--name-only', 'HEAD', '--', ...paths]);
  const staged = gitLines(dir, ['diff', '--name-only', '--cached', 'HEAD', '--', ...paths]);
  const untracked = gitLines(dir, ['ls-files', '--full-name', '--others', '--exclude-standard', '--', ...paths]);
  return [...unstaged, ...staged, ...untracked];
}

function checkAdd(inv, root, territories, agentId) {
  const { options, paths } = split(inv.args, () => false);
  const bad = options.filter((o) => !['-v', '--verbose'].includes(o));
  if (bad.length) refuse(`\`git add\` takes explicit paths and no ${bad.join(' ')}: -A, -u, -f, -p and the rest reach past your own files.`);
  if (paths.length === 0) refuse('`git add` needs at least one path.');
  checkAffected(root, territories, agentId, 'add', touched(inv.dir, paths).map((f) => path.join(root, f)));
}

function checkCommit(inv, root, territories, agentId) {
  const takesValue = (o) => o === '-m' || o === '--message' || /^-[qsvo]+m$/.test(o);
  const { options, paths } = split(inv.args, takesValue);
  const allowed = (o) => ['-q', '--quiet', '-s', '--signoff', '-v', '--verbose', '-o', '--only', '-m', '--message'].includes(o)
    || o.startsWith('--message=') || /^-[qsvo]*m.*$/.test(o) || /^-[qsvo]+$/.test(o);
  const bad = options.filter((o) => !allowed(o));
  if (bad.length) refuse(`\`git commit\` takes \`-m <msg> -- <paths>\` and no ${bad.join(' ')}: -a, -i, --amend, --fixup, -C and the rest commit more than the files you name, or rewrite history.`);
  if (paths.length === 0) refuse('`git commit` needs at least one path; with none it commits the whole shared index, other architects\' staged files included.');
  checkAffected(root, territories, agentId, 'commit', touched(inv.dir, paths).map((f) => path.join(root, f)));
}

// gh that only reads: a read subcommand in any group, a read-only group, `gh auth status`, and
// `gh api` with no method but GET and no request body.
function ghReadOnly(inv) {
  if (inv.verb === '' || GH_READ_GROUPS.has(inv.verb)) return true;
  if (inv.verb === 'auth') return inv.args[0] === 'status';
  if (inv.verb === 'api') {
    const a = inv.args;
    const body = a.some((x) => /^(-f|-F|--field|--raw-field|--input)(=|$)/.test(x) || /^-[fF]./.test(x));
    const methods = a.flatMap((x, k) => {
      if (x === '-X' || x === '--method') return [a[k + 1] ?? ''];
      if (x.startsWith('--method=')) return [x.slice('--method='.length)];
      if (/^-X./.test(x)) return [x.slice(2)];
      return [];
    });
    return !body && methods.every((m) => m.toUpperCase() === 'GET');
  }
  const sub = inv.args.find((x) => !x.startsWith('-'));
  return GH_READ.has(sub ?? '');
}

// The git manager's one fence: main moves only by merging the PR, no remote ref is deleted,
// and nothing is force-pushed without a lease. An allowlist, because git's push grammar has
// too many spellings to deny one by one (short-option clusters, --repo, globbed refspecs):
// only these options, spelled out; the remote as the first positional; each refspec a plain
// `<src>` or `<src>:<dst>` with no `+`, no `*`, no empty side, and no protected destination.
const PUSH_OPTIONS = new Set(['-u', '--set-upstream', '-q', '--quiet', '-v', '--verbose', '-n',
  '--dry-run', '--porcelain', '--force-with-lease', '--force-if-includes']);
function checkPush(inv) {
  const takesValue = (o) => o === '-o' || o === '--push-option';
  const { options, paths } = split(inv.args, takesValue);
  const allowed = (o) => PUSH_OPTIONS.has(o) || o === '-o' || o === '--push-option'
    || o.startsWith('--push-option=') || o.startsWith('--force-with-lease=');
  const bad = options.filter((o) => !allowed(o));
  if (bad.length) refuse(`\`git push ${bad.join(' ')}\`: the git manager pushes with only ${[...PUSH_OPTIONS].join(', ')} and -o, each spelled out on its own, the remote first, then the branch by name. A force push takes --force-with-lease.`);
  // An explicit remote and refspec, always: with none, push.default or a configured
  // remote.<name>.push decides the destination, and either can name main.
  if (paths.length < 2) refuse('`git push` names its remote and the branch: `git push -u origin <branch>`. Without a refspec, git config decides where it goes.');
  const remote = paths[0];
  const configured = spawnSync('git', ['config', '--get-all', `remote.${remote}.push`], { cwd: inv.dir, encoding: 'utf8' });
  if ((configured.stdout || '').trim()) refuse(`remote.${remote}.push is configured (${configured.stdout.trim().split('\n')[0]}), so it can rewrite where a push lands. The main session decides about that config; the guard won't push through it.`);
  const refspecs = paths.slice(1);
  const own = (r) => r === 'HEAD' || r === '@';
  if (refspecs.some(own)) {
    // `git push origin HEAD` pushes the current branch; refuse it on main.
    const r = spawnSync('git', ['branch', '--show-current'], { cwd: inv.dir, encoding: 'utf8' });
    const current = (r.stdout || '').trim();
    if (r.status !== 0 || current === '' || PROTECTED.test(current)) refuse('`git push` with no refspec from the default branch, or from a detached or unknown HEAD. main changes only by merging the PR; push the effort\'s branch by name.');
  }
  for (const r of refspecs) {
    if (r.startsWith('+')) refuse('a `+` refspec is a force push. Use --force-with-lease.');
    if (r.includes('*')) refuse(`\`${r}\` is a pattern refspec, which can reach main. Push the effort's branch by name.`);
    const sides = r.split(':');
    if (sides.length > 2 || sides.some((x) => x === '')) refuse(`\`${r}\` deletes a remote ref or isn't a plain <src>:<dst>. Push the effort's branch by name.`);
    if (PROTECTED.test(r)) refuse(`\`git push ... ${r}\` would change the default branch. main changes only by merging the PR.`);
  }
}

function decide(input) {
  const agentId = input.agent_id;
  if (!agentId) return;
  const command = input.tool_input?.command ?? '';
  const agentType = input.agent_type ?? '';
  if (/request-review\.sh/.test(command) && agentType !== 'git-manager') {
    refuse('requesting a review round posts to GitHub, so it is the git manager\'s job. Ask the orchestrator in a report.');
  }
  if (!/\b(git|gh)\b/.test(command)) return;
  const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const cwd = input.cwd || root;
  const architect = agentType === 'architect';
  const manager = agentType === 'git-manager';
  const allowedHere = manager
    ? 'The git manager runs any git and gh, but main changes only by merging the PR, no remote ref is deleted, and a force push takes --force-with-lease.'
    : architect
    ? 'An architect runs read-only git and gh, plus `git add -- <paths>` and `git commit -m <msg> -- <paths>` on its own files. The branch, the working tree, the remote, the PR and CI belong to the git manager; ask the orchestrator in a report.'
    : 'Sub-agents edit; the architect commits. Read-only git (status, diff, log, show, grep, blame) and read-only gh (view, list, status, diff, checks) are fine. Put what you changed in your report.';
  let found;
  try {
    found = invocations(command, cwd);
  } catch (e) {
    if (e instanceof Refused) refuse(`${e.message} in a command that mentions git: run git as a plain command so the guard can read it. ${allowedHere}`);
    throw e;
  }
  for (const inv of found) {
    if (inv.tool === 'gh') {
      if (manager || ghReadOnly(inv)) continue;
      refuse(`\`gh ${[inv.verb, inv.args[0]].filter(Boolean).join(' ')}\` changes GitHub state, or the guard can't tell that it doesn't. ${allowedHere}`);
    }
    if (manager) {
      if (inv.verb === 'push') {
        const extra = inv.globals.filter((g) => g !== '--no-pager');
        if (extra.length || inv.assigned) refuse(`\`git push\` runs plainly: no ${extra.length ? extra.join(' ') : 'environment variables'} in front of it, since config set there can redirect the push.`);
        checkPush(inv);
      }
      continue;
    }
    const extra = inv.globals.filter((g) => !['--no-pager'].includes(g));
    if (extra.length) refuse(`\`git ${extra.join(' ')}\`: only -C and --no-pager are allowed before the verb. ${allowedHere}`);
    if (READ_ONLY.has(inv.verb)) continue;
    if (LISTING[inv.verb] && inv.args.every((a) => LISTING[inv.verb].includes(a))) continue;
    if (architect && (inv.verb === 'add' || inv.verb === 'commit')) {
      if (inv.assigned) refuse(`\`git ${inv.verb}\` with environment variables set in front of it: run it plainly.`);
      const territories = load(root);
      const own = refusal(territories, 'architect', agentId, null);
      if (own && own.startsWith('no territory')) refuse(own);
      (inv.verb === 'add' ? checkAdd : checkCommit)(inv, fromShell(root), territories, agentId);
      continue;
    }
    refuse(`\`git ${inv.verb || '(no verb)'}\` is not allowed here. ${allowedHere}`);
  }
}

if (require.main === module) {
  try {
    decide(JSON.parse(fs.readFileSync(0, 'utf8')));
    process.exit(0);
  } catch (e) {
    process.stderr.write(`guard-git: ${e instanceof Refused ? e.message : `could not check this command (${e.message}); blocked`}\n`);
    process.exit(2);
  }
}

module.exports = { tokenize, invocations, decide };
