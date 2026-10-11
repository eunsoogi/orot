import { basename } from 'node:path';
import { markAllDetox } from './changed-paths-core.mjs';

const RELEASE_E2E_FILES = new Set([
  'ai-feature-visit-questions.e2e.js',
  'aifeaturevisitquestionsprobeentry.tsx',
  'navigation-glass.e2e.js',
  'navigationglasslayoutassertions.js',
]);
// These E2E support inputs are imported by mobile unit tests and need both runners.
const UNIT_CONSUMED_E2E_PATHS = new Set([
  'apps/mobile/e2e/backupcontainersnapshot.js',
  'apps/mobile/e2e/backupprobepreparation.ts',
  'apps/mobile/e2e/backupprobetypes.ts',
  'apps/mobile/e2e/nextvisitprobediagnostics.js',
  'apps/mobile/e2e/providerselectionsystemconsent.js',
  'apps/mobile/e2e/transcription/fixtures/synthetic-korean.json',
  'apps/mobile/e2e/transcription/transcriptdeletiondetoxhelpers.js',
  'apps/mobile/e2e/transcription/transcriptdeletionprobesupport.ts',
  'apps/mobile/e2e/transcription/transcriptevidencedetoxhelpers.js',
  'apps/mobile/e2e/transcription/transcriptevidenceprobesupport.ts',
  'apps/mobile/e2e/transcription/transcriptevidenceprobe.tsx',
  'apps/mobile/e2e/unifiedimportprobemeasurements.ts',
]);

export function selectE2EPath(path, selection) {
  const lower = path.toLowerCase();
  const file = basename(lower);
  // CI policy tests inspect E2E contracts; some app unit tests also import E2E helpers and fixtures.
  selection.policy_tests = true;
  if (UNIT_CONSUMED_E2E_PATHS.has(lower)) selection.unit_tests = true;
  if (RELEASE_E2E_FILES.has(file)) {
    // The Release shard owns these tests and helpers even when their names are not release-specific.
    selection.detox_release = true;
  } else if (lower.includes('/transcription/') || lower.includes('transcription.')) {
    selection.detox_transcription = true;
  } else if (
    lower.includes('openai') ||
    lower.includes('providerselection') ||
    lower.includes('provider-selection')
  ) {
    selection.detox_openai = true;
  } else if (
    lower.includes('nextvisit') ||
    lower.includes('next-visit') ||
    lower.includes('visitquestions') ||
    lower.includes('visit-questions')
  ) {
    selection.detox_next_visit = true;
  } else if (file.startsWith('release-e2e-') || file === 'release-e2e.test.js') {
    selection.detox_release = true;
  } else {
    // Shared fixtures and helpers can feed any profile, so run every dependent E2E leaf.
    markAllDetox(selection);
  }

  // The mobile tsconfig includes every E2E TypeScript file, so Metro-only checks are insufficient.
  if (selection.typescript) selection.typecheck = true;
}
