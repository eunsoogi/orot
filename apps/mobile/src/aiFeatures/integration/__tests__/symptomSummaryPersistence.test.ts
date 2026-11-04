import { createSymptomSummaryPersistence } from '../symptomSummaryPersistence';
import { resolveSelectedAiProvider } from '../provider';
import { apple, localData, selectionStore } from '../featureServiceFixtures';
import {
  healthContextFixture,
  signal,
} from '../testSupport/healthContextPersistenceFixture';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { runMultiAgentWorkflow } from '@orot/agent-runtime';
import { diseaseHypothesisTask } from '../../../diseaseHypotheses/task';
import { workflowOptions } from '../../../diseaseHypotheses/taskTestSupport';
import type { DiseaseHypothesisAnalysis } from '../../../diseaseHypotheses/types';
import type { EvidenceReference } from '@orot/agent-runtime';
import { symptomSummaryTask } from '../../../diseaseHypotheses/symptomSummaryTask';

async function completedOutcome(
  value: DiseaseHypothesisAnalysis,
  citation: EvidenceReference,
) {
  const result = await runMultiAgentWorkflow({
    ...workflowOptions(),
    task: diseaseHypothesisTask,
  });
  if (result.status !== 'result')
    throw new Error('Expected completed workflow');
  return {
    status: 'workflow' as const,
    result: { ...result, value, citations: [citation] },
  };
}

async function selectedModel() {
  const selected = await resolveSelectedAiProvider({
    selectionStore: selectionStore({
      providerId: apple.provider.id,
      modelId: apple.modelId,
    }),
    loadAppleOption: async () => apple,
  });
  if (selected.status !== 'ready') throw new Error('Expected selected model');
  return selected;
}

test('saves a completed summary and reopens its original source in a fresh registry', async () => {
  const f = await healthContextFixture();
  try {
    const section = {
      ...f.saved.analysis.hypotheses[0]!,
      summary: '심박수 72 count/min 기록이 있어요.',
      supportingEvidence: [f.item.evidenceId],
      uncertainty: '일부 기록만 확인했어요.',
    };
    const validation = symptomSummaryTask.validateResult(
      {
        sections: [section, { ...section, supportingEvidence: ['unknown'] }],
      } as never,
      {
        request: '기록 요약',
        evidence: { items: [f.item], coverage: [], conflicts: [] },
      },
    );
    if (validation.status !== 'valid')
      throw new Error(
        `Expected supported section: ${JSON.stringify(validation)}`,
      );
    const value = { ...validation.value, incompleteEvidence: true };
    const outcome = await completedOutcome(value, f.item);
    const data = { ...localData([]).data, readHealthContext: f.read };
    const persistence = createSymptomSummaryPersistence({
      registry: f.registry,
      data: async () => data,
      storage: async () => f.storage,
    });
    const saved = await persistence.save(
      outcome,
      await selectedModel(),
      'save-test',
      signal,
      '2026-10-05T00:00:00Z',
    );
    expect(
      saved.status === 'workflow' &&
        saved.result.status === 'result' &&
        saved.result.value.savedSummary,
    ).toMatchObject({ status: 'saved' });
    const fresh = new LocalEvidenceReferenceRegistry();
    const history = createSymptomSummaryPersistence({
      registry: fresh,
      data: async () => data,
      storage: async () => f.storage,
    }).history;
    const reopened = await history.read('2026-10-05T00:00:00Z-save-test');
    expect(reopened?.hypotheses[0]?.uncertainty).toContain(
      '일부 기록만 확인했어요.',
    );
    expect(reopened?.omittedUnsupportedContent).toBe(true);
    expect(reopened?.incompleteEvidence).toBe(true);
    expect(reopened?.hypotheses).toHaveLength(1);
    expect(reopened?.savedSummary).toMatchObject({
      status: 'saved',
      sourceChanged: false,
    });
    expect(
      (
        await fresh.readSource(
          reopened!.hypotheses[0]!.supportingEvidence[0]!,
          signal,
        )
      ).status,
    ).toBe('available');
  } finally {
    f.close();
  }
});

test('a failed SQLite write retains the generated result and can be retried without regeneration', async () => {
  const f = await healthContextFixture();
  try {
    await f.storage.list();
    await f.database.execute(
      "CREATE TRIGGER fail_summary_write BEFORE INSERT ON symptom_summary_runs BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END",
    );
    const value = {
      ...f.saved.analysis,
      hypotheses: f.saved.analysis.hypotheses.map(section => ({
        ...section,
        supportingEvidence: [f.item],
      })),
    };
    const outcome = await completedOutcome(value, f.item);
    const data = { ...localData([]).data, readHealthContext: f.read };
    const persistence = createSymptomSummaryPersistence({
      registry: f.registry,
      data: async () => data,
      storage: async () => f.storage,
    });
    const failed = await persistence.save(
      outcome,
      await selectedModel(),
      'retry-test',
      signal,
      '2026-10-05T00:00:00Z',
    );
    expect(
      failed.status === 'workflow' &&
        failed.result.status === 'result' &&
        failed.result.value,
    ).toMatchObject({
      hypotheses: value.hypotheses,
      savedSummary: { status: 'failed' },
    });
    expect(await f.storage.list()).toHaveLength(0);
    await f.database.execute('DROP TRIGGER fail_summary_write');
    const retried = await persistence.history.retrySave!();
    expect(retried?.savedSummary).toMatchObject({ status: 'saved' });
    expect(
      await persistence.history.read('2026-10-05T00:00:00Z-retry-test'),
    ).toMatchObject({
      hypotheses: [{ summary: value.hypotheses[0]!.summary }],
    });
  } finally {
    f.close();
  }
});

test.each(['before capture', 'during write'] as const)(
  'does not save or retry when a cited source changes %s',
  async phase => {
    const f = await healthContextFixture();
    try {
      const value = {
        ...f.saved.analysis,
        hypotheses: f.saved.analysis.hypotheses.map(section => ({
          ...section,
          supportingEvidence: [f.item],
        })),
      };
      const outcome = await completedOutcome(value, f.item);
      const data = { ...localData([]).data, readHealthContext: f.read };
      const change = () =>
        f.repository.put('health_observation', {
          ...f.inside,
          value: { kind: 'quantity', amount: 81, unit: 'count/min' },
        });
      const storage = {
        ...f.storage,
        append: async (...args: Parameters<typeof f.storage.append>) => {
          if (phase === 'during write') await change();
          return f.storage.append(...args);
        },
      };
      const persistence = createSymptomSummaryPersistence({
        registry: f.registry,
        data: async () => data,
        storage: async () => storage,
      });
      if (phase === 'before capture') await change();
      const failed = await persistence.save(
        outcome,
        await selectedModel(),
        'changed-source',
        signal,
        '2026-10-05T00:00:00Z',
      );
      expect(
        failed.status === 'workflow' &&
          failed.result.status === 'result' &&
          failed.result.value.savedSummary,
      ).toEqual({
        status: phase === 'before capture' ? 'source_unavailable' : 'failed',
      });
      expect((await persistence.history.retrySave!())?.savedSummary).toEqual({
        status: 'source_unavailable',
      });
      expect(await f.storage.list()).toHaveLength(0);
    } finally {
      f.close();
    }
  },
);
