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
const syntheticEvidence = readFileSync(
  join(repositoryRoot, 'apps/mobile/e2e/aiFeatureVisitQuestionsSyntheticEvidence.ts'),
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

  // Bind both disease outputs to the extracted synthetic fixture, not its former local symbol.
  const fixtureBinding = entry.match(
    /import\s*\{\s*(?:[A-Za-z_$][\w$]*\s+as\s+)?([A-Za-z_$][\w$]*)\s*\}\s*from\s*['"]\.\/aiFeatureVisitQuestionsSyntheticEvidence['"];?/,
  )?.[1];
  assert.ok(fixtureBinding, 'disease output imports its dedicated synthetic evidence fixture');
  const supportingEvidenceBinding = runner.match(
    /supportingEvidence:\s*\[\s*([A-Za-z_$][\w$]*)\s*\]/,
  )?.[1];
  const citationBinding = runner.match(/citations:\s*\[\s*([A-Za-z_$][\w$]*)\s*\]/)?.[1];
  assert.equal(supportingEvidenceBinding, fixtureBinding);
  assert.equal(citationBinding, fixtureBinding);
  assert.match(syntheticEvidence, /sourceId:\s*'synthetic-[^']+'/);
  assert.match(syntheticEvidence, /evidenceId:\s*'synthetic-[^']+'/);
  assert.match(syntheticEvidence, /locator:\s*\{\s*kind:\s*'synthetic-span'/);
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
