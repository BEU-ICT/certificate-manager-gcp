// Architecture rules (ports and adapters). See "Architecture boundaries" in README.md.
// Run with `npm run depcruise`. Rule names are asserted by test/architecture.

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      comment: '(e) No circular dependencies.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'modules-only-via-public-index',
      comment:
        '(a) A module may import another module only through modules/<name>/index.ts ' +
        '(its public service interface), never its internals.',
      severity: 'error',
      from: { path: '^src/modules/([^/]+)/' },
      to: {
        path: '^src/modules/[^/]+/',
        pathNot: ['^src/modules/$1/', '^src/modules/[^/]+/index\\.ts$'],
      },
    },
    {
      name: 'modules-and-ports-not-to-adapters-or-http',
      comment: '(b) modules/** and ports/** must not import adapters/** or http/**.',
      severity: 'error',
      from: { path: '^src/(modules|ports)/' },
      to: { path: '^src/(adapters|http)/' },
    },
    {
      name: 'ports-only-ports-and-shared',
      comment: '(c) ports/** may import only ports/** and shared/**.',
      severity: 'error',
      from: { path: '^src/ports/' },
      to: { path: '^src/', pathNot: '^src/(ports|shared)/' },
    },
    {
      name: 'adapters-not-to-module-internals',
      comment:
        '(d) adapters/** may import ports/** and shared/**, never modules/** internals ' +
        '(a module public index.ts is the only allowed exception).',
      severity: 'error',
      from: { path: '^src/adapters/' },
      to: { path: '^src/modules/', pathNot: '^src/modules/[^/]+/index\\.ts$' },
    },
    {
      name: 'testing-not-from-production-code',
      comment: '(f) testing/** (fakes, test helpers) must not be imported by non-test code.',
      severity: 'error',
      from: { path: '^src/', pathNot: '^src/testing/' },
      to: { path: '^src/testing/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    // Only first-party code matters for the rules; keep node_modules out of the graph.
    exclude: { path: 'node_modules' },
  },
};
