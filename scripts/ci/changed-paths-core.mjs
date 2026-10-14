import { readFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHECK_KEYS = Object.freeze([
  'quality_inventory',
  'source_loc',
  'format_check',
  'javascript',
  'typescript',
  'swift',
  'objective_c',
  'shell',
  'ruby',
  'yaml',
  'json',
  'xml',
  'properties',
  'typecheck',
  'unit_tests',
  'policy_tests',
  'ios_build',
  'ios_tests',
]);
const QUALITY_KEYS = Object.freeze([
  'javascript',
  'typescript',
  'swift',
  'objective_c',
  'shell',
  'ruby',
  'yaml',
  'json',
  'xml',
  'properties',
]);
const SURFACE_OUTPUTS = Object.freeze({
  javascript: 'javascript',
  typescript: 'typescript',
  swift: 'swift',
  'objective-c': 'objective_c',
  shell: 'shell',
  ruby: 'ruby',
  yaml: 'yaml',
  json: 'json',
  xml: 'xml',
  properties: 'properties',
});
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

export function emptySelection(reason = 'no-relevant-paths') {
  return {
    all: false,
    reason,
    paths: [],
    ...Object.fromEntries(CHECK_KEYS.map((key) => [key, false])),
  };
}

export function selectEverything(reason) {
  return {
    all: true,
    reason,
    paths: [],
    ...Object.fromEntries(CHECK_KEYS.map((key) => [key, true])),
  };
}

export function loadPolicies(root = ROOT) {
  const readJson = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
  return {
    quality: readJson('scripts/quality/surface-policy.json'),
    loc: readJson('scripts/ci/loc-policy.json'),
  };
}

function isPathExcluded(path, pathMap = {}) {
  return Object.hasOwn(pathMap, path);
}

function isLocPath(path, policy) {
  const file = basename(path);
  const extension = extname(path).toLowerCase();
  const segments = path.toLowerCase().split('/');
  if (
    isPathExcluded(path, policy.excludedPaths) ||
    Object.hasOwn(policy.excludedFilenames ?? {}, file) ||
    Object.hasOwn(policy.excludedExtensions ?? {}, extension) ||
    segments.some((segment) => Object.hasOwn(policy.excludedPathSegments ?? {}, segment))
  )
    return false;
  return policy.includedExtensions.includes(extension) || policy.includedFilenames.includes(file);
}

function qualitySurface(path, policy) {
  const file = basename(path);
  const extension = extname(path).toLowerCase();
  if (
    isPathExcluded(path, policy.excludedPaths) ||
    Object.hasOwn(policy.nonCodeExtensions ?? {}, extension) ||
    Object.hasOwn(policy.nonCodeBasenames ?? {}, file) ||
    Object.keys(policy.projectMetadataSuffixes ?? {}).some((suffix) => path.endsWith(suffix))
  )
    return { recognized: true, surface: null };
  for (const [surface, definition] of Object.entries(policy.surfaces)) {
    if (definition.extensions.includes(extension) || definition.specialFiles?.includes(path))
      return { recognized: true, surface };
  }
  return { recognized: false, surface: null };
}

export function markQualityPath(path, selection, policies) {
  // Keep formatter/linter selection separate from LOC policy because their include and exclusion rules differ.
  const match = qualitySurface(path, policies.quality);
  if (!match.recognized) return false;
  if (match.surface) {
    selection[SURFACE_OUTPUTS[match.surface]] = true;
    selection.quality_inventory = true;
    selection.format_check = true;
  }
  if (isLocPath(path, policies.loc)) selection.source_loc = true;
  return true;
}

export function markAllQuality(selection) {
  selection.quality_inventory = true;
  selection.source_loc = true;
  selection.format_check = true;
  for (const key of QUALITY_KEYS) selection[key] = true;
}
