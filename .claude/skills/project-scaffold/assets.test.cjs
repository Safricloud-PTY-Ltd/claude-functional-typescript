// Tests for the suite table in the asset vitest configs: which files each `vitest --mode` takes.
// Run: node --test .claude/skills/project-scaffold/assets.test.cjs
//
// This repo doesn't install vitest, so the configs are copied to a temp project whose
// `vitest/config` is a stub (defineConfig returns its argument) and loaded by node, which strips
// their types. That pins the table and its lookup, not vitest: what vitest then collects was
// measured in a scratch project (see SKILL.md, Versions).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const TESTS = 'src/**/*.test.{ts,tsx}';
const SLOW = 'src/**/*.slow.test.{ts,tsx}';
const PERF = 'src/**/*.perf.test.{ts,tsx}';
const DEFAULT_EXCLUDE = '**/stub-default-exclude/**';
const STUB = `export const defineConfig = (config) => config;\nexport const configDefaults = { exclude: ['${DEFAULT_EXCLUDE}'] };\n`;

// What each mode must run: [include, the excludes added to vitest's defaults, type tests on].
const normal = [TESTS, [SLOW, PERF], true];
const EXPECTED = {
  test: normal, // vitest's own default mode
  slow: [SLOW, [], false],
  perf: [PERF, [], false],
  full: [TESTS, [PERF], true],
  // Any other mode is the normal suite: a misspelling, another tool's mode, and the names every
  // object inherits, which a plain table lookup would answer with a function.
  typo: normal,
  development: normal,
  constructor: normal,
  toString: normal,
  ['__proto__']: normal,
};

// The package's config function, loaded from a copy beside a stubbed vitest.
async function load(t, pkg) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assets-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const stub = path.join(dir, 'node_modules', 'vitest');
  fs.mkdirSync(stub, { recursive: true });
  fs.mkdirSync(path.join(dir, 'packages', pkg), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), '{ "type": "module" }\n');
  fs.writeFileSync(path.join(stub, 'package.json'), '{ "name": "vitest", "type": "module", "exports": { "./config": "./config.js" } }\n');
  fs.writeFileSync(path.join(stub, 'config.js'), STUB);
  const config = path.join(dir, 'packages', pkg, 'vitest.config.ts');
  fs.copyFileSync(path.join(__dirname, 'assets', 'packages', pkg, 'vitest.config.ts'), config);
  return (await import(pathToFileURL(config).href)).default;
}

for (const pkg of ['shared', 'app']) {
  test(`packages/${pkg}: each mode runs its suite, and any other mode the normal one`, async (t) => {
    const config = await load(t, pkg);
    for (const mode of Object.getOwnPropertyNames(EXPECTED)) {
      const [include, exclude, typeTests] = EXPECTED[mode];
      const { test: got } = config({ mode });
      assert.equal(got.name, pkg, mode);
      assert.deepEqual(got.include, [include], mode);
      assert.deepEqual(got.exclude, [DEFAULT_EXCLUDE, ...exclude], mode);
      assert.equal(got.typecheck.enabled, typeTests, mode);
      assert.deepEqual(got.typecheck.include, ['src/**/*.test-d.{ts,tsx}'], mode);
    }
  });
}

test('packages/app keeps its #shared alias in every mode', async (t) => {
  const config = await load(t, 'app');
  for (const mode of ['test', 'slow', 'perf', 'full']) {
    assert.match(config({ mode }).resolve.alias['#shared'], /[\\/]packages[\\/]shared[\\/]src[\\/]index\.ts$/, mode);
  }
});
