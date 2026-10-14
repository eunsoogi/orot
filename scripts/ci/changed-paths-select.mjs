import { basename, extname } from 'node:path';
import {
  emptySelection,
  loadPolicies,
  markAllQuality,
  markQualityPath,
  selectEverything,
} from './changed-paths-core.mjs';
import { selectE2EPath } from './changed-paths-e2e-rules.mjs';
import { selectWorkflowPath } from './changed-paths-workflow-rules.mjs';

const IMAGES = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.heic',
  '.avif',
  '.icns',
]);
const SHARED_DEPENDENCIES = new Set([
  '.npmrc',
  '.nvmrc',
  '.node-version',
  '.ruby-version',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'package.json',
  'gradle.lockfile',
  'gradlew',
  'Package.resolved',
  'Podfile.lock',
]);
const ROOT_QUALITY_CONFIG = new Set([
  '.clang-format',
  '.editorconfig',
  '.prettierignore',
  '.prettierrc',
  '.swiftformat',
  'eslint.config.js',
]);
function mobileRuntime(selection) {
  selection.typecheck = true;
  selection.unit_tests = true;
  selection.ios_build = true;
  selection.ios_tests = true;
}

function normalizePath(value) {
  if (typeof value !== 'string' || !value || /[\0\r\n]/.test(value)) return null;
  const path = value.replaceAll('\\', '/').replace(/^\.\//, '');
  return path.startsWith('/') || path.split('/').includes('..') ? null : path;
}

function mobileAsset(path) {
  return (
    path.startsWith('apps/mobile/ios/') ||
    path.startsWith('apps/mobile/assets/') ||
    path.startsWith('apps/mobile/src/assets/')
  );
}

export function selectChecksForPaths(changedPaths, policies = null) {
  // Map paths to affected required-check families; unknown boundaries select the full verification set.
  if (!Array.isArray(changedPaths)) return selectEverything('incomplete-path-list');
  if (!changedPaths.length) return emptySelection();
  try {
    policies ??= loadPolicies();
    if (!policies.quality?.surfaces || !policies.loc?.includedExtensions) {
      return selectEverything('missing-policy');
    }
  } catch {
    return selectEverything('missing-policy');
  }

  const paths = changedPaths.map(normalizePath);
  if (paths.some((path) => !path)) return selectEverything('invalid-path');
  const selection = emptySelection('matched-paths');
  selection.paths = [...new Set(paths)].sort();

  for (const path of selection.paths) {
    const lower = path.toLowerCase();
    const file = basename(lower);
    if (extname(path).toLowerCase() === '.md') {
      // Markdown is outside the formatter; CI guidance changes retain policy regression checks.
      selection.policy_tests = true;
      continue;
    }
    if (IMAGES.has(extname(path).toLowerCase())) {
      if (mobileAsset(path)) {
        selection.ios_build = true;
        selection.ios_tests = true;
      } else if (lower.startsWith('apps/mobile/e2e/')) {
        selectE2EPath(path, selection);
      }
      continue;
    }
    if (SHARED_DEPENDENCIES.has(file)) {
      return { ...selectEverything('shared-dependency-change'), paths: selection.paths };
    }
    if (file === 'gemfile.lock' || file === 'gemfile') {
      if (lower.startsWith('scripts/quality/')) {
        selection.policy_tests = true;
        markAllQuality(selection);
        continue;
      }
      return { ...selectEverything('dependency-change'), paths: selection.paths };
    }
    if (lower.startsWith('.github/actions/')) {
      return { ...selectEverything('local-action-change'), paths: selection.paths };
    }
    if (lower.startsWith('.github/workflows/')) {
      if (!markQualityPath(path, selection, policies) || !selectWorkflowPath(path, selection)) {
        return { ...selectEverything('unknown-workflow-change'), paths: selection.paths };
      }
      continue;
    }
    if (lower.startsWith('.github/')) {
      return { ...selectEverything('unknown-github-configuration'), paths: selection.paths };
    }
    if (lower.startsWith('scripts/ci/')) {
      return { ...selectEverything('ci-tool-change'), paths: selection.paths };
    }
    if (lower.startsWith('scripts/quality/')) {
      selection.policy_tests = true;
      markAllQuality(selection);
      continue;
    }
    if (lower.startsWith('scripts/release/') || lower.startsWith('scripts/version/')) {
      selection.policy_tests = true;
      if (!markQualityPath(path, selection, policies)) {
        return { ...selectEverything('unknown-script-change'), paths: selection.paths };
      }
      continue;
    }
    if (lower.startsWith('apps/mobile/e2e/')) {
      if (!markQualityPath(path, selection, policies)) {
        return { ...selectEverything('unknown-e2e-file'), paths: selection.paths };
      }
      selectE2EPath(path, selection);
      continue;
    }
    if (lower === 'apps/mobile/.eslintrc.js') {
      if (!markQualityPath(path, selection, policies)) {
        return { ...selectEverything('unknown-mobile-file'), paths: selection.paths };
      }
      // The shared workspace ESLint invocation consumes this config for both JavaScript and TypeScript.
      selection.typescript = true;
      continue;
    }
    if (lower.startsWith('apps/mobile/android/')) {
      if (!markQualityPath(path, selection, policies)) {
        return { ...selectEverything('unknown-android-file'), paths: selection.paths };
      }
      selection.typecheck = true;
      selection.unit_tests = true;
      continue;
    }
    if (
      lower.startsWith('apps/mobile/ios/') ||
      lower.startsWith('apps/mobile/src/') ||
      lower.startsWith('apps/mobile/assets/') ||
      lower.startsWith('packages/')
    ) {
      if (!markQualityPath(path, selection, policies)) {
        return { ...selectEverything('unknown-application-file'), paths: selection.paths };
      }
      mobileRuntime(selection);
      continue;
    }
    if (lower.startsWith('apps/mobile/')) {
      if (!markQualityPath(path, selection, policies)) {
        return { ...selectEverything('unknown-mobile-file'), paths: selection.paths };
      }
      mobileRuntime(selection);
      continue;
    }
    if (lower.startsWith('scripts/')) {
      if (!markQualityPath(path, selection, policies)) {
        return { ...selectEverything('unknown-script-change'), paths: selection.paths };
      }
      selection.policy_tests = true;
      continue;
    }
    if (ROOT_QUALITY_CONFIG.has(file)) {
      markAllQuality(selection);
      continue;
    }
    if (
      file.startsWith('tsconfig') ||
      file.startsWith('jest.config') ||
      file === 'metro.config.js' ||
      file === 'babel.config.js'
    ) {
      if (!markQualityPath(path, selection, policies)) {
        return { ...selectEverything('unknown-tool-configuration'), paths: selection.paths };
      }
      selection.typecheck = true;
      selection.unit_tests = true;
      if (file !== 'jest.config.js') {
        selection.ios_build = true;
        selection.ios_tests = true;
      }
      continue;
    }
    if (markQualityPath(path, selection, policies)) {
      selection.policy_tests = true;
      continue;
    }
    return { ...selectEverything('unknown-path'), paths: selection.paths };
  }
  return selection;
}
