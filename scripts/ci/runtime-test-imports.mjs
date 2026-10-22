import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanModuleSpecifiers } from './runtime-test-import-syntax.mjs';
import { isJestTestOnlyPath, SOURCE_EXTENSIONS } from './runtime-test-paths.mjs';
import {
  assertNoSymbolicPath,
  exportTargets,
  readRuntimeWorkspace,
} from './runtime-test-workspace.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SOURCE_VARIANTS = [...SOURCE_EXTENSIONS];

function unknown(reason, candidatePaths, referencingImporters = []) {
  return { status: 'unknown', reason, candidatePaths, referencingImporters };
}

function resolveFileTargets(basePath, candidatePaths, root) {
  // Include Metro platform and index variants so an extensionless edge cannot hide a test file.
  const targets = [basePath];
  const actualExtension = extname(basePath);
  const extension = actualExtension.toLowerCase();
  if (!SOURCE_EXTENSIONS.has(extension)) {
    for (const suffix of SOURCE_VARIANTS) {
      targets.push(basePath + '.ios' + suffix, basePath + '.native' + suffix, basePath + suffix);
    }
    targets.push(join(basePath, 'index'));
    for (const suffix of SOURCE_VARIANTS) {
      targets.push(
        join(basePath, 'index.ios' + suffix),
        join(basePath, 'index.native' + suffix),
        join(basePath, 'index' + suffix),
      );
    }
  } else {
    const sourcePath = basePath.slice(0, -actualExtension.length);
    targets.push(sourcePath + '.ios' + actualExtension);
    targets.push(sourcePath + '.native' + actualExtension);
  }
  return [...new Set(targets.map((path) => relative(root, path).split('\\').join('/')))].filter(
    (path) => candidatePaths.has(path),
  );
}

function aliasTargets(specifier, aliases, root, candidates) {
  const matches = [];
  for (const alias of aliases) {
    const star = alias.pattern.indexOf('*');
    const capture =
      star < 0
        ? specifier === alias.pattern
          ? ''
          : null
        : specifier.startsWith(alias.pattern.slice(0, star)) &&
            specifier.endsWith(alias.pattern.slice(star + 1))
          ? specifier.slice(star, specifier.length - (alias.pattern.length - star - 1))
          : null;
    if (capture === null) continue;
    for (const target of alias.targets) {
      const mapped = target.replaceAll('*', capture);
      matches.push(...resolveFileTargets(resolve(alias.base, mapped), candidates, root));
    }
  }
  return [...new Set(matches)];
}

function packageTargets(specifier, packages, candidates, root) {
  const packageName = specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0];
  const record = packages.get(packageName);
  if (!record) return [];
  const suffix = specifier.slice(packageName.length);
  let targets = [];
  if (record.exports !== undefined) {
    const subpath = suffix ? '.' + suffix : '.';
    const exported = record.exports;
    if (typeof exported === 'string' || Array.isArray(exported)) {
      const values = new Set();
      if (subpath === '.') exportTargets(exported, values);
      targets = [...values];
    } else if (exported && typeof exported === 'object') {
      const keys = Object.keys(exported);
      if (keys.some((key) => key.startsWith('.'))) {
        for (const [key, value] of Object.entries(exported)) {
          const star = key.indexOf('*');
          let capture = null;
          if (star < 0 && key === subpath) capture = '';
          else if (
            star >= 0 &&
            subpath.startsWith(key.slice(0, star)) &&
            subpath.endsWith(key.slice(star + 1))
          )
            capture = subpath.slice(star, subpath.length - (key.length - star - 1));
          if (capture !== null) {
            const values = new Set();
            exportTargets(value, values);
            targets.push(...[...values].map((target) => target.replaceAll('*', capture)));
          }
        }
      } else if (subpath === '.') {
        const values = new Set();
        exportTargets(exported, values);
        targets = [...values];
      }
    }
  } else if (suffix) targets = [suffix.slice(1)];
  else targets = record.targets;
  return [
    ...new Set(
      targets.flatMap((target) =>
        resolveFileTargets(resolve(record.root, target), candidates, root),
      ),
    ),
  ];
}

function referencedCandidates(specifier, importer, root, workspace, candidates) {
  if (specifier.startsWith('.') || isAbsolute(specifier)) {
    const base = isAbsolute(specifier) ? specifier : resolve(root, dirname(importer), specifier);
    return resolveFileTargets(base, candidates, root);
  }
  const aliases = aliasTargets(specifier, workspace.aliases, root, candidates);
  return [
    ...new Set([
      ...aliases,
      ...packageTargets(specifier, workspace.packageNames, candidates, root),
    ]),
  ];
}

/** Follow app/E2E edges so only runtime-reachable Jest helpers affect selection. */
function reachableTestReferences(candidatePaths, root, workspace) {
  const candidateSet = new Set(candidatePaths);
  const importablePaths = new Set([...workspace.importers, ...candidatePaths]);
  // Non-Jest sources are conservative roots; Jest helpers enter only through static imports.
  const pending = workspace.importers.filter((path) => !isJestTestOnlyPath(path));
  const visited = new Set();
  const referencedBy = new Set();
  while (pending.length) {
    const importer = pending.pop();
    if (visited.has(importer)) continue;
    visited.add(importer);
    const parsed = scanModuleSpecifiers(readFileSync(resolve(root, importer), 'utf8'));
    if (parsed.unknownReason) return { unknownReason: parsed.unknownReason };
    for (const specifier of parsed.specifiers) {
      const targets = referencedCandidates(specifier, importer, root, workspace, importablePaths);
      for (const target of targets) {
        if (candidateSet.has(target)) referencedBy.add(importer);
        else pending.push(target);
      }
    }
  }
  return { referencingImporters: [...referencedBy].sort() };
}

/**
 * Prove that changed Jest tests have no app or E2E importer, including through
 * runtime-reachable Jest helpers. The selector runs before dependency
 * installation, so this uses checked-in workspace metadata and fails closed
 * when reachable source cannot be resolved statically.
 */
export function analyzeRuntimeTestImports(changedPaths, { root = ROOT } = {}) {
  const candidatePaths = [...new Set(changedPaths.filter(isJestTestOnlyPath))].sort();
  if (!candidatePaths.length)
    return {
      status: 'not-applicable',
      reason: 'no-jest-test-only-changes',
      candidatePaths,
      referencingImporters: [],
    };
  try {
    for (const path of candidatePaths) {
      const absolute = resolve(root, path);
      if (!absolute.startsWith(resolve(root) + '/') || !existsSync(absolute))
        return unknown('candidate-missing', candidatePaths);
      try {
        assertNoSymbolicPath(root, absolute);
      } catch {
        return unknown('candidate-not-regular-file', candidatePaths);
      }
      const candidateInfo = lstatSync(absolute);
      if (candidateInfo.isSymbolicLink() || !candidateInfo.isFile())
        return unknown('candidate-not-regular-file', candidatePaths);
    }
    const workspace = readRuntimeWorkspace(root);
    const references = reachableTestReferences(candidatePaths, root, workspace);
    if (references.unknownReason) return unknown(references.unknownReason, candidatePaths);
    const referencingImporters = references.referencingImporters;
    return referencingImporters.length
      ? {
          status: 'referenced',
          reason: 'runtime-import-reference',
          candidatePaths,
          referencingImporters,
        }
      : {
          status: 'unreferenced',
          reason: 'no-runtime-import-reference',
          candidatePaths,
          referencingImporters,
        };
  } catch {
    return unknown('source-read-or-parse-failed', candidatePaths);
  }
}

export { isJestTestOnlyPath } from './runtime-test-paths.mjs';
