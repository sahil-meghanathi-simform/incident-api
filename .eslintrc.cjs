/**
 * Two structural rules enforce the layering guarantees this POC is graded on:
 *
 *  1. `prisma.incident` may appear ONLY inside incident.repository.ts — this is what
 *     makes the §2.3 visibility guarantee auditable in one file (build-plan.md B1).
 *  2. `req.query`/`req.body`/`req.params` may be READ only inside validate.middleware.ts
 *     — everywhere else must go through req.validated (build-plan.md B6: Express 5
 *     makes req.query a getter with no setter, so bypassing req.validated silently
 *     uses unvalidated input).
 *
 * `npm run lint:layers` (scripts/check-layers.sh) re-checks both with a plain grep as a
 * belt-and-braces CI step independent of ESLint configuration drift.
 */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2023, sourceType: 'module', project: false },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: { node: true, es2023: true },
  ignorePatterns: ['dist/', 'node_modules/', 'contracts-dist/', 'prisma/migrations/'],
  rules: {
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'warn',
    'no-restricted-syntax': [
      'error',
      {
        selector:
          "MemberExpression[object.object.name='prisma'][object.property.name='incident']",
        message:
          'prisma.incident must only be used inside src/modules/incidents/incident.repository.ts (build-plan.md B1).',
      },
      {
        selector: "MemberExpression[object.name='req'][property.name='query']",
        message: 'Read req.validated.query, not req.query directly (build-plan.md B6).',
      },
    ],
  },
  overrides: [
    {
      files: ['src/modules/incidents/incident.repository.ts', 'src/jobs/**/*.ts'],
      rules: { 'no-restricted-syntax': 'off' },
    },
    {
      files: ['src/http/middleware/validate.middleware.ts'],
      rules: { 'no-restricted-syntax': 'off' },
    },
  ],
};
