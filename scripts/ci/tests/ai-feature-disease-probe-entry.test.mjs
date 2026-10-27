import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const entry = readFileSync(
  join(repositoryRoot, 'apps/mobile/e2e/aiFeatureVisitQuestionsProbeEntry.tsx'),
  'utf8',
);

test('disease visual output stays opt-in, synthetic, and isolated', () => {
  assert.match(entry, /launchSettings\.OROT_DISEASE_HYPOTHESES_VISUAL_STATE === 'synthetic'/);
  assert.match(
    entry,
    /syntheticDiseaseFixtureEnabled\s*\?\s*syntheticAiFeatureDependencies\s*:\s*undefined/,
  );

  const runnerStart = entry.indexOf('const syntheticDiseaseRunner:');
  const dependenciesStart = entry.indexOf('const syntheticAiFeatureDependencies:', runnerStart);
  assert.ok(runnerStart >= 0 && dependenciesStart > runnerStart);
  const runner = entry.slice(runnerStart, dependenciesStart);
  assert.match(runner, /status: 'result'/);
  assert.match(runner, /syntheticCitation/);
  assert.doesNotMatch(runner, /\bfetch\b|\.provider\b|\.tools\b|\.search\b|readRecord|listRecords/);

  const dependenciesEnd = entry.indexOf(
    'const syntheticDiseaseFixtureEnabled =',
    dependenciesStart,
  );
  const dependencies = entry.slice(dependenciesStart, dependenciesEnd);
  assert.match(
    dependencies,
    /rag: \{ index: async \(\) => undefined, search: async \(\) => \[\] \}/,
  );
  assert.doesNotMatch(dependencies, /repository|memoryStorage|loadMemoryRecords/);
  assert.match(dependencies, /status: 'unavailable'/);
  assert.match(dependencies, /append: async/);
});
