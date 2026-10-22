import {
  visitHealthFixture,
  periodWindow,
} from '../../../agent/visitQuestions/testing/healthContextFixture';
import { healthObservation } from '../../../../../../packages/storage/__tests__/localQueryTestSupport';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { createLocalHealthEvidenceRepository } from '../../../healthEvidence/localEvidenceRepository';
import { loadSavedVisitQuestionState } from '../savedVisitQuestions';
import { restoreVisitQuestionHealthContext } from '../savedVisitQuestionHealthContext';
import { registerHealthContextEvidence } from '../healthContextEvidence';
import { saveVisitQuestionRoute } from '../visitQuestionsRouteSave';
import type { HealthContextReader } from '../../../healthEvidence/healthContext/reader';

async function fixture() {
  const f = await visitHealthFixture();
  const registry = new LocalEvidenceReferenceRegistry();
  const load = (readHealthContext: HealthContextReader = f.read) =>
    loadSavedVisitQuestionState({
      appointmentId: f.prepared.appointment.id,
      records: f.records,
      sourceReader: createLocalHealthEvidenceRepository(f.database),
      registry,
      readHealthContext,
    });
  const question = {
    ...f.question,
    questionText: '기간 평균 심박수 72회/분을 다음 진료에서 어떻게 확인할까요?',
  };
  await f.save({ questions: [question] });
  return { ...f, load, registry, question };
}

test.each(['addition', 'update'] as const)(
  'keeps reviewed question text after a health %s while its changed citation cannot be reused',
  async change => {
    const f = await fixture();
    try {
      const row = (await f.records.list('visit_question'))[0]!;
      await f.records.put('health_observation', {
        ...f.observation,
        ...(change === 'addition'
          ? { id: 'new-period-sample', effectiveAt: '2026-10-02T01:00:00Z' }
          : {}),
        value: { kind: 'quantity', amount: 81, unit: 'count/min' },
      });
      const restored = await f.load();
      expect(restored.status).toBe('ready');
      if (restored.status !== 'ready')
        throw new Error('The reviewed question was hidden.');
      expect(restored.questions[0]?.questionText).toBe(f.question.questionText);
      expect(restored.restorationNotice).toContain('생성 당시');
      expect(restored.restorationNotice).toContain('바뀌');
      const citation = restored.questions[0]!.citations[0]!;
      expect(
        await f.registry.readSource(citation, new AbortController().signal),
      ).toEqual({ status: 'changed' });
      expect(
        await f.registry.revalidateEvidence(
          [citation],
          new AbortController().signal,
        ),
      ).toBe(false);
      // Displaying history never relaxes the strict original-version path used for fresh evidence.
      await expect(
        restoreVisitQuestionHealthContext(
          row.healthContextSources![0]!,
          f.read,
          new LocalEvidenceReferenceRegistry(),
        ),
      ).rejects.toThrow('health-period');
      await expect(
        saveVisitQuestionRoute(
          {
            appointment: f.prepared.appointment,
            questions: restored.questions,
            caveats: [],
            resolveSource: reference => f.registry.resolve(reference),
          },
          async () => ({
            prepareUpcomingVisitQuestionContext: async () => ({
              ...f.prepared,
              saveReviewedQuestions: questions => f.save({ questions }),
            }),
          }),
        ),
      ).rejects.toThrow('source changed');
      expect(await f.records.list('visit_question')).toEqual([row]);
    } finally {
      f.close();
    }
  },
);

test('retains a working current citation when another question period changes', async () => {
  const f = await fixture();
  try {
    const step = {
      ...healthObservation(
        'activity-sample',
        'step_count',
        '2026-10-01T01:00:00Z',
      ),
      value: { kind: 'quantity' as const, amount: 1200, unit: 'count' },
    };
    await f.records.put('health_observation', step);
    const scope = {
      kind: 'health_context_period' as const,
      version: 1 as const,
      topic: 'activity' as const,
      window: periodWindow,
    };
    const registry = new LocalEvidenceReferenceRegistry();
    const alias = registerHealthContextEvidence({
      registry,
      read: f.read,
      scope,
      report: await f.read(periodWindow, ['activity']),
    });
    const activity = await f.prepared.reloadPersonalEvidence(
      registry.resolve(alias)!,
    );
    if (!activity) throw new Error('Activity period was not captured.');
    const activityQuestion = {
      ...f.question,
      questionText: '걸음 수를 다음 진료에서 어떻게 참고할까요?',
      citations: [activity],
    };
    await f.save({ questions: [f.question, activityQuestion] });
    await f.records.put('health_observation', {
      ...step,
      value: { ...step.value, amount: 1400 },
    });
    const restored = await f.load();
    expect(restored.status).toBe('ready');
    if (restored.status !== 'ready')
      throw new Error('The reviewed list was hidden.');
    expect(restored.questions).toHaveLength(2);
    expect(
      await f.registry.revalidateEvidence(
        restored.questions[0]!.citations,
        new AbortController().signal,
      ),
    ).toBe(true);
    expect(
      await f.registry.revalidateEvidence(
        restored.questions[1]!.citations,
        new AbortController().signal,
      ),
    ).toBe(false);
  } finally {
    f.close();
  }
});

test('does not restore a question whose contributing health record was deleted', async () => {
  const f = await fixture();
  try {
    await f.records.delete('health_observation', f.observation.id);
    expect(await f.load()).toMatchObject({ status: 'ready', questions: [] });
  } finally {
    f.close();
  }
});

test('does not publish a question deleted while its original is loading', async () => {
  const f = await fixture();
  try {
    const read: HealthContextReader = async (...args) => {
      const report = await f.read(...args);
      await f.records.delete('health_observation', f.observation.id);
      return report;
    };
    expect(await f.load(read)).toMatchObject({
      status: 'error',
      questions: [],
    });
    expect(await f.records.list('visit_question')).toEqual([]);
  } finally {
    f.close();
  }
});

test('does not turn an unavailable reader into a changed-but-readable historical result', async () => {
  const f = await fixture();
  try {
    const read: HealthContextReader = async () => {
      throw new Error('Synthetic temporary read failure.');
    };
    expect(await f.load(read)).toMatchObject({
      status: 'error',
      questions: [],
    });
  } finally {
    f.close();
  }
});

test('fails closed when changed facts coincide with an advanced deletion generation', async () => {
  const f = await fixture();
  try {
    const outside = healthObservation(
      'outside-period',
      'heart_rate',
      '2025-10-01T00:00:00Z',
    );
    await f.records.put('health_observation', outside);
    await f.records.delete('health_observation', outside.id);
    await f.records.put('health_observation', {
      ...f.observation,
      value: { kind: 'quantity', amount: 81, unit: 'count/min' },
    });
    expect(await f.load()).toMatchObject({ status: 'error', questions: [] });
    expect(await f.records.list('visit_question')).toHaveLength(1);
  } finally {
    f.close();
  }
});
