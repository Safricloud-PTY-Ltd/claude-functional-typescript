/* Architecture rules. `pnpm deps` fails on any violation.
 *
 * The model: the repo is a pnpm workspace of packages under packages/, each with its own src/.
 * Every directory under a package's src/ is a module and its index.ts is the only door.
 * Modules nest to any depth (MAX_DEPTH directories below a package's src/). Inside a module,
 * files import each other relatively and may reach into a parent's files; nothing outside a
 * module reaches past its index.ts. Rules are generated per depth because the matcher
 * is regex-based; $1 in `to` refers to the capture group in `from.path`.
 *
 * Across packages, the only import is of packages/shared, through its barrel (as `#shared`):
 * shared imports nothing from the workspace, and no package imports another. A package's
 * src/app/ is its composition root, and nothing outside it imports it.
 */
const MAX_DEPTH = 5;
const SRC = 'packages/[^/]+/src';
const dirs = (n) => `${SRC}${'/[^/]+'.repeat(n)}`;

const perDepth = (n) => [
  {
    name: `module-boundary-${n}`,
    comment: 'From inside one depth-n module into a different depth-n module: only its index.ts',
    severity: 'error',
    from: { path: `^(${dirs(n)})/` },
    to: { path: `^${dirs(n)}/`, pathNot: ['^$1/', `^${dirs(n)}/index\\.ts$`] },
  },
  {
    name: `module-boundary-${n}-from-above`,
    comment: 'From shallower than depth n into a depth-n module: only its index.ts',
    severity: 'error',
    from: { path: `^${SRC}/`, pathNot: `^${dirs(n)}/` },
    to: { path: `^${dirs(n)}/`, pathNot: `^${dirs(n)}/index\\.ts$` },
  },
  {
    name: `no-own-barrel-${n}`,
    comment: 'Inside a module, import relatively; the barrel is for outsiders',
    severity: 'error',
    // The module's own index.test(-d).ts is the one insider that imports the barrel: it is the
    // acceptance test code-standards requires. Exempted in the lookahead, at the module's own
    // level only, so a nested module's test still can't reach a parent barrel (issue #14).
    from: { path: `^(${dirs(n)})/(?!index\\.ts$|index\\.test(-d)?\\.tsx?$)` },
    to: { path: '^$1/index\\.ts$' },
  },
  {
    name: `barrel-only-reexports-${n}`,
    comment: 'A barrel only re-exports from inside its own module',
    severity: 'error',
    from: { path: `^(${dirs(n)})/index\\.ts$` },
    to: { pathNot: '^$1/' },
  },
];

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
    { name: 'not-to-unresolvable', severity: 'error', from: {}, to: { couldNotResolve: true } },
    {
      name: 'no-orphans',
      severity: 'error',
      from: {
        orphan: true,
        pathNot: [
          '\\.test\\.tsx?$',
          '\\.test-d\\.tsx?$',
          '^packages/shared/src/stub\\.ts$',
          '^packages/[^/]+/src/app/main\\.ts$',
          // Each package's own vitest config is read by the root run, not imported.
          '^packages/[^/]+/vitest\\.config\\.ts$',
        ],
      },
      to: {},
    },
    {
      name: 'max-depth',
      comment: `No module deeper than ${MAX_DEPTH} directories below a package's src/`,
      severity: 'error',
      from: {},
      to: { path: `^${dirs(MAX_DEPTH + 1)}/` },
    },
    {
      name: 'core-is-pure',
      comment: 'core/ may not import shell/ or app/',
      severity: 'error',
      from: { path: '/core/' },
      to: { path: ['/shell/', '^packages/[^/]+/src/app/'] },
    },
    {
      name: 'core-has-no-dependencies',
      comment:
        'Third-party packages and node builtins live behind adapters in shell/; core uses only neverthrow and #shared',
      severity: 'error',
      from: { path: '/core/' },
      to: {
        dependencyTypesNot: ['local', 'aliased', 'aliased-subpath-import', 'type-only'],
        pathNot: [
          'node_modules/neverthrow/',
          'node_modules/fast-check/',
          'node_modules/vitest/',
          '^packages/shared/',
        ],
      },
    },
    {
      name: 'shared-is-leaf',
      comment: 'shared imports nothing from the workspace',
      severity: 'error',
      from: { path: '^packages/shared/' },
      to: { path: '^packages/(?!shared/)' },
    },
    {
      name: 'cross-package-only-shared',
      comment: 'A package imports another package only when that package is shared',
      severity: 'error',
      from: { path: '^packages/([^/]+)/' },
      to: { path: '^packages/', pathNot: ['^packages/$1/', '^packages/shared/'] },
    },
    {
      name: 'shared-only-through-its-barrel',
      comment: 'Outside shared, only its index.ts is reachable',
      severity: 'error',
      from: { pathNot: '^packages/shared/' },
      to: { path: '^packages/shared/', pathNot: '^packages/shared/src/index\\.ts$' },
    },
    {
      name: 'nobody-imports-app',
      comment: "A package's src/app/ is its composition root; nothing outside it imports it",
      severity: 'error',
      from: { path: '^packages/', pathNot: '^packages/[^/]+/src/app/' },
      to: { path: '^packages/[^/]+/src/app/' },
    },
    {
      name: 'no-test-imports-in-prod',
      severity: 'error',
      from: { pathNot: '\\.test(-d)?\\.tsx?$' },
      to: { path: '\\.test(-d)?\\.tsx?$' },
    },
    ...Array.from({ length: MAX_DEPTH }, (_, i) => perDepth(i + 1)).flat(),
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'node', 'default', 'types'],
    },
    reporterOptions: { dot: { collapsePattern: 'node_modules/[^/]+' } },
  },
};
