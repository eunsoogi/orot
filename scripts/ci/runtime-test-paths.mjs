import { basename, extname } from 'node:path';

export const SOURCE_EXTENSIONS = new Set([
  '.cjs',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
]);

/** Only maintained Jest-style source tests can be removed from the macOS impact path. */
export function isJestTestOnlyPath(value) {
  if (typeof value !== 'string') return false;
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '').toLowerCase();
  if (
    !(normalized.startsWith('apps/mobile/src/') || normalized.startsWith('packages/')) ||
    !SOURCE_EXTENSIONS.has(extname(normalized))
  )
    return false;
  return (
    normalized.split('/').includes('__tests__') ||
    /\.(?:test|spec)\.(?:[cm]?[jt]s|[jt]sx)$/.test(basename(normalized))
  );
}
