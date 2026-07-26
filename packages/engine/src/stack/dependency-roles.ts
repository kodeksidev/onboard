/**
 * @onboard/engine — `DependencyInfo.inferredRole` (Section 7.1: "from the
 * static role table only; null if unknown").
 */
export const DEPENDENCY_ROLE_BY_PACKAGE_NAME: Readonly<Record<string, string>> = {
  express: 'web framework',
  fastify: 'web framework',
  koa: 'web framework',
  next: 'web framework',
  react: 'UI framework',
  'react-dom': 'UI framework',
  vue: 'UI framework',
  '@angular/core': 'UI framework',
  svelte: 'UI framework',
  flask: 'web framework',
  django: 'web framework',
  fastapi: 'web framework',
  zustand: 'state management',
  redux: 'state management',
  '@reduxjs/toolkit': 'state management',
  vuex: 'state management',
  pinia: 'state management',
  prisma: 'ORM',
  sequelize: 'ORM',
  typeorm: 'ORM',
  sqlalchemy: 'ORM',
  mongoose: 'ODM',
  axios: 'HTTP client',
  requests: 'HTTP client',
  httpx: 'HTTP client',
  zod: 'schema validation',
  pydantic: 'schema validation',
  jest: 'test framework',
  vitest: 'test framework',
  mocha: 'test framework',
  pytest: 'test framework',
  eslint: 'linter',
  prettier: 'formatter',
  webpack: 'bundler',
  vite: 'bundler',
  rollup: 'bundler',
  esbuild: 'bundler',
  typescript: 'language toolchain',
  tailwindcss: 'styling',
  bun: 'runtime',
};

/** Looks up a package's role from the static table only — never inferred otherwise. */
export function inferDependencyRole(packageName: string): string | null {
  return DEPENDENCY_ROLE_BY_PACKAGE_NAME[packageName] ?? null;
}
