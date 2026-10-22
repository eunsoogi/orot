/** Discover maintained source paths, package entries, and aliases without following links. */
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { SOURCE_EXTENSIONS } from './runtime-test-paths.mjs';

const SOURCE_VARIANTS = [...SOURCE_EXTENSIONS];

/** Keep static import proof inside the checked-out tree and reject linked path ancestors. */
export function assertNoSymbolicPath(root, path) {
  const workspace = resolve(root);
  const target = resolve(path);
  const pathFromWorkspace = relative(workspace, target);
  if (
    pathFromWorkspace === '..' ||
    pathFromWorkspace.startsWith('..' + sep) ||
    isAbsolute(pathFromWorkspace)
  )
    throw new Error('runtime path escapes workspace');

  let current = workspace;
  for (const segment of pathFromWorkspace.split(sep)) {
    if (!segment) continue;
    current = join(current, segment);
    if (lstatSync(current).isSymbolicLink()) throw new Error('runtime path is linked');
  }
}

function walkSources(root, directory, output) {
  assertNoSymbolicPath(root, directory);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('runtime source path is linked');
    if (['.git', 'Pods', 'build', 'node_modules'].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walkSources(root, path, output);
    else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name).toLowerCase()))
      output.add(relative(root, path).split('\\').join('/'));
  }
}

export function exportTargets(value, output) {
  if (typeof value === 'string') output.add(value);
  else if (Array.isArray(value)) value.forEach((item) => exportTargets(item, output));
  else if (value && typeof value === 'object')
    Object.values(value).forEach((item) => exportTargets(item, output));
}

export function readRuntimeWorkspace(root) {
  const importers = new Set();
  const packageNames = new Map();
  const aliases = [];
  // E2E modules and Metro-resolved app shims are runtime importers even without entry-file changes.
  walkSources(root, join(root, 'apps/mobile/src'), importers);
  walkSources(root, join(root, 'apps/mobile/e2e'), importers);
  for (const name of ['App', 'index']) {
    for (const extension of SOURCE_VARIANTS) {
      const path = join(root, 'apps/mobile', name + extension);
      if (existsSync(path)) {
        assertNoSymbolicPath(root, path);
        importers.add(relative(root, path).split('\\').join('/'));
      }
    }
  }

  const packagesRoot = join(root, 'packages');
  assertNoSymbolicPath(root, packagesRoot);
  for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('workspace package path is linked');
    if (!entry.isDirectory()) continue;
    const packageRoot = join(packagesRoot, entry.name);
    const sourceRoot = join(packageRoot, 'src');
    if (existsSync(sourceRoot)) walkSources(root, sourceRoot, importers);
    // Package-root Jest helpers are traversable only when a runtime module imports them.
    const testsRoot = join(packageRoot, '__tests__');
    if (existsSync(testsRoot)) walkSources(root, testsRoot, importers);
    const manifestPath = join(packageRoot, 'package.json');
    if (!existsSync(manifestPath)) continue;
    assertNoSymbolicPath(root, manifestPath);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (typeof manifest.name !== 'string') throw new Error('workspace package has no name');
    const targets = new Set();
    for (const field of ['main', 'module', 'react-native']) exportTargets(manifest[field], targets);
    exportTargets(manifest.exports, targets);
    const record = { root: packageRoot, exports: manifest.exports, targets: [...targets] };
    if (packageNames.has(manifest.name)) throw new Error('workspace package name is ambiguous');
    packageNames.set(manifest.name, record);
    for (const target of record.targets) {
      if (target.includes('*')) continue;
      const path = resolve(packageRoot, target);
      if (!existsSync(path)) throw new Error('workspace package entry point is missing');
      assertNoSymbolicPath(root, path);
      const targetInfo = lstatSync(path);
      if (targetInfo.isSymbolicLink()) throw new Error('workspace package entry point is linked');
      if (targetInfo.isFile() && SOURCE_EXTENSIONS.has(extname(path).toLowerCase()))
        importers.add(relative(root, path).split('\\').join('/'));
    }
    const tsconfigPath = join(packageRoot, 'tsconfig.json');
    if (existsSync(tsconfigPath)) {
      assertNoSymbolicPath(root, tsconfigPath);
      readAliases(tsconfigPath, aliases);
    }
  }
  const mobileTsconfig = join(root, 'apps/mobile/tsconfig.json');
  if (existsSync(mobileTsconfig)) {
    assertNoSymbolicPath(root, mobileTsconfig);
    readAliases(mobileTsconfig, aliases);
  }
  return { importers: [...importers].sort(), packageNames, aliases };
}

function readAliases(tsconfigPath, aliases) {
  const config = JSON.parse(readFileSync(tsconfigPath, 'utf8'));
  const compiler = config.compilerOptions ?? {};
  if (compiler.paths === undefined) return;
  if (!compiler.paths || typeof compiler.paths !== 'object' || Array.isArray(compiler.paths))
    throw new Error('TypeScript path aliases are not statically readable');
  const base = resolve(dirname(tsconfigPath), compiler.baseUrl ?? '.');
  for (const [pattern, targets] of Object.entries(compiler.paths)) {
    if (!Array.isArray(targets) || targets.some((target) => typeof target !== 'string'))
      throw new Error('TypeScript path alias target is not static');
    aliases.push({ pattern, base, targets });
  }
}
