/* Architecture rules. `pnpm deps` fails on any violation.
 *
 * The model: every directory under src/ is a module and its index.ts is the only door.
 * Modules nest to any depth (MAX_DEPTH directories below src/). Inside a module, files
 * import each other relatively and may reach into a parent's files; nothing outside a
 * module reaches past its index.ts. Rules are generated per depth because the matcher
 * is regex-based; $1 in `to` refers to the capture group in `from.path`.
 */
const MAX_DEPTH = 5;
const dirs = (n) => `src${'/[^/]+'.repeat(n)}`;

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
    from: { path: '^src/', pathNot: `^${dirs(n)}/` },
    to: { path: `^${dirs(n)}/`, pathNot: `^${dirs(n)}/index\\.ts$` },
  },
  {
    name: `no-own-barrel-${n}`,
    comment: 'Inside a module, import relatively; the barrel is for outsiders',
    severity: 'error',
    from: { path: `^(${dirs(n)})/(?!index\\.ts$)` },
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
          '\\.test\\.ts$',
          '\\.test-d\\.ts$',
          '^src/shared/stub\\.ts$',
          '^src/app/main\\.ts$',
        ],
      },
      to: {},
    },
    {
      name: 'max-depth',
      comment: `No module deeper than ${MAX_DEPTH} directories below src/`,
      severity: 'error',
      from: {},
      to: { path: `^${dirs(MAX_DEPTH + 1)}/` },
    },
    {
      name: 'core-is-pure',
      comment: 'core/ may not import shell/ or app/',
      severity: 'error',
      from: { path: '/core/' },
      to: { path: ['/shell/', '^src/app/'] },
    },
    {
      name: 'core-has-no-dependencies',
      comment:
        'Third-party packages and node builtins live behind adapters in shell/; core uses only neverthrow',
      severity: 'error',
      from: { path: '/core/' },
      to: {
        dependencyTypesNot: ['local', 'aliased', 'aliased-subpath-import', 'type-only'],
        pathNot: ['node_modules/neverthrow/', 'node_modules/fast-check/', 'node_modules/vitest/'],
      },
    },
    {
      name: 'shared-is-leaf',
      comment: 'shared/ imports nothing from domains or app',
      severity: 'error',
      from: { path: '^src/shared/' },
      to: { path: '^src/(?!shared/)' },
    },
    {
      name: 'nobody-imports-app',
      severity: 'error',
      from: { path: '^src/(?!app/)' },
      to: { path: '^src/app/' },
    },
    {
      name: 'no-test-imports-in-prod',
      severity: 'error',
      from: { pathNot: '\\.test(-d)?\\.ts$' },
      to: { path: '\\.test(-d)?\\.ts$' },
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
