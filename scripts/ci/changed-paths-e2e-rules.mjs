import { basename } from 'node:path';
import { markAllDetox } from './changed-paths-core.mjs';

const RELEASE_E2E_FILES = new Set([
  'ai-feature-visit-questions.e2e.js',
  'aifeaturevisitquestionsprobeentry.tsx',
  'navigation-glass.e2e.js',
  'navigationglasslayoutassertions.js',
]);

export function selectE2EPath(path, selection) {
  const lower = path.toLowerCase();
  const file = basename(lower);
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
