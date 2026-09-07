/* Architecture rules. `pnpm deps` fails on any violation. */
const DOMAIN = '^src/(?!shared/|app/)([^/]+)/';

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
      name: 'core-is-pure',
      comment: 'core/ may not import shell/ or app/',
      severity: 'error',
      from: { path: '^src/[^/]+/core/' },
      to: { path: ['^src/[^/]+/shell/', '^src/app/'] },
    },
    {
      name: 'shared-is-leaf',
      comment: 'shared/ imports nothing from domains or app',
      severity: 'error',
      from: { path: '^src/shared/' },
      to: { path: '^src/(?!shared/)' },
    },
    {
      name: 'domains-via-barrel',
      comment: 'Another domain is reached only through its index.ts',
      severity: 'error',
      from: { path: DOMAIN, pathNot: '\\.test(-d)?\\.ts$' },
      to: {
        path: '^src/(?!shared/|app/)([^/]+)/(?!index\\.ts$)',
        pathNot: '^src/$1/',
      },
    },
    {
      name: 'no-own-barrel',
      comment: 'Inside a domain, import relatively; the barrel is for other domains',
      severity: 'error',
      from: { path: '^src/([^/]+)/', pathNot: '^src/[^/]+/index\\.ts$' },
      to: { path: '^src/$1/index\\.ts$' },
    },
    {
      name: 'nobody-imports-app',
      severity: 'error',
      from: { path: '^src/(?!app/)' },
      to: { path: '^src/app/' },
    },
    {
      name: 'barrels-only-reexport',
      comment: 'index.ts only re-exports from its own domain',
      severity: 'error',
      from: { path: '^src/([^/]+)/index\\.ts$' },
      to: { pathNot: '^src/$1/' },
    },
    {
      name: 'no-test-imports-in-prod',
      severity: 'error',
      from: { pathNot: '\\.test(-d)?\\.ts$' },
      to: { path: '\\.test(-d)?\\.ts$' },
    },
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
