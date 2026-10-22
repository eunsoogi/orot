import { basename, extname } from 'node:path';
import {
  emptySelection,
  loadPolicies,
  markAllQuality,
  markQualityPath,
  selectIosTestImpact,
  selectEverything,
} from './changed-paths-core.mjs';
import { selectE2EPath } from './changed-paths-e2e-rules.mjs';
import { selectWorkflowPath } from './changed-paths-workflow-rules.mjs';
import { analyzeRuntimeTestImports, isJestTestOnlyPath } from './runtime-test-imports.mjs';

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
function mobileRuntime(selection, path) {
  selection.typecheck = true;
  selection.unit_tests = true;
  selection.ios_build = true;
  selection.ios_tests = true;
  selectIosTestImpact(path, selection);
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

export function selectChecksForPaths(changedPaths, policies = null, { runtimeRoot } = {}) {
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
  const testOnlyPaths = selection.paths.filter(isJestTestOnlyPath);
  const runtimeTestImportAnalysis = analyzeRuntimeTestImports(
    testOnlyPaths,
    runtimeRoot ? { root: runtimeRoot } : {},
  );
  selection.runtime_test_import_analysis = runtimeTestImportAnalysis;
  const excludedTestPaths = new Set(
    runtimeTestImportAnalysis.status === 'unreferenced'
      ? runtimeTestImportAnalysis.candidatePaths
      : [],
  );
  const selectAll = (reason) => ({
    ...selectEverything(reason),
    paths: selection.paths,
    runtime_test_import_analysis: runtimeTestImportAnalysis,
  });

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
        selectIosTestImpact(path, selection);
      } else if (lower.startsWith('apps/mobile/e2e/')) {
        selectE2EPath(path, selection);
      }
      continue;
    }
    if (SHARED_DEPENDENCIES.has(file)) {
      return selectAll('shared-dependency-change');
    }
    if (file === 'gemfile.lock' || file === 'gemfile') {
      if (lower.startsWith('scripts/quality/')) {
        selection.policy_tests = true;
        markAllQuality(selection);
        continue;
      }
      return selectAll('dependency-change');
    }
    if (lower.startsWith('.github/actions/')) {
      return selectAll('local-action-change');
    }
    if (lower.startsWith('.github/workflows/')) {
      if (!markQualityPath(path, selection, policies) || !selectWorkflowPath(path, selection)) {
        return selectAll('unknown-workflow-change');
      }
      continue;
    }
    if (lower.startsWith('.github/')) {
      return selectAll('unknown-github-configuration');
    }
    if (lower.startsWith('scripts/ci/')) {
      return selectAll('ci-tool-change');
    }
    if (lower.startsWith('scripts/quality/')) {
      selection.policy_tests = true;
      markAllQuality(selection);
      continue;
    }
    if (lower.startsWith('scripts/release/') || lower.startsWith('scripts/version/')) {
      selection.policy_tests = true;
      if (!markQualityPath(path, selection, policies)) {
        return selectAll('unknown-script-change');
      }
      continue;
    }
    if (lower.startsWith('apps/mobile/e2e/')) {
      if (!markQualityPath(path, selection, policies)) {
        return selectAll('unknown-e2e-file');
      }
      selectE2EPath(path, selection);
      continue;
    }
    if (lower === 'apps/mobile/.eslintrc.js') {
      if (!markQualityPath(path, selection, policies)) {
        return selectAll('unknown-mobile-file');
      }
      // The shared workspace ESLint invocation consumes this config for both JavaScript and TypeScript.
      selection.typescript = true;
      continue;
    }
    if (lower.startsWith('apps/mobile/android/')) {
      if (!markQualityPath(path, selection, policies)) {
        return selectAll('unknown-android-file');
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
        return selectAll('unknown-application-file');
      }
      if (excludedTestPaths.has(path)) {
        selection.typecheck = true;
        selection.unit_tests = true;
        continue;
      }
      mobileRuntime(selection, path);
      continue;
    }
    if (lower.startsWith('apps/mobile/')) {
      if (!markQualityPath(path, selection, policies)) {
        return selectAll('unknown-mobile-file');
      }
      mobileRuntime(selection, path);
      continue;
    }
    if (lower.startsWith('scripts/')) {
      if (!markQualityPath(path, selection, policies)) {
        return selectAll('unknown-script-change');
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
        return selectAll('unknown-tool-configuration');
      }
      selection.typecheck = true;
      selection.unit_tests = true;
      if (file !== 'jest.config.js') {
        selection.ios_build = true;
        selection.ios_tests = true;
        selectIosTestImpact(path, selection);
      }
      continue;
    }
    if (markQualityPath(path, selection, policies)) {
      selection.policy_tests = true;
      continue;
    }
    return selectAll('unknown-path');
  }
  return selection;
}
