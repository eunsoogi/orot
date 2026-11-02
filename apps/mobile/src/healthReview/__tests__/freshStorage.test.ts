import { runHealthReviewGraph } from '@orot/agent-runtime';
import { createHealthReviewPort } from '../../agent/healthReview/port';
import { syntheticHealthReview } from '../../agent/healthReview/syntheticFixture';
import { mapBloodPressureCorrelation } from '../../healthkit/bloodPressure/mapper';
import { correlation } from '../../healthkit/bloodPressure/testSupport';
import { withFixedDate } from '../../agent/healthReview/testing/currentPeriodEvidenceFixture';
import { createHealthReviewInvocation } from '../evidenceInvocation';
import { healthReviewSqlite, instant, safety } from '../testing/sqlite';

const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

/** Seed imported observations so the resumed evidence snapshot has durable references. */
async function seedHealthKitBloodPressure(
  repository: Awaited<ReturnType<typeof healthReviewSqlite>>['repository'],
) {
  const sample = correlation('healthkit-pressure-correlation');
  const timed = {
    ...sample,
    startDate: instant,
    endDate: instant,
    components: sample.components?.map(component => ({
      ...component,
      startDate: instant,
      endDate: instant,
    })),
  };
  for (const observation of mapBloodPressureCorrelation(timed, instant)
    .observations)
    await repository.put('health_observation', observation);
}

it('reopens a real SQLite file and discovers exact pending without automatically running any workflow', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'health-review-storage-'));
  let connection: Awaited<ReturnType<typeof healthReviewSqlite>> | undefined;
  try {
    connection = await healthReviewSqlite(join(directory, 'records.sqlite'));
    const source = await connection.requests.create('다시 열 검토');
    const synthetic = syntheticHealthReview(
      connection.repository,
      source.id,
      false,
    );
    const port = createHealthReviewPort({
      sourceId: source.id,
      repository: connection.repository,
      model: synthetic.model,
      evidence: createHealthReviewInvocation(connection.data).evidence,
    });
    const pending = await runHealthReviewGraph({
      sourceId: source.id,
      threadId: source.id,
      safetyInput: {},
      port,
      checkpointer: connection.saver(source.id),
    });
    if (pending.status !== 'needs_clarification')
      throw new Error('Missing pending snapshot');
    connection.close();
    connection = undefined;
    connection = await healthReviewSqlite(join(directory, 'records.sqlite'));
    expect(await connection.requests.pending(source.id)).toEqual(
      pending.pending,
    );
    expect((await connection.requests.list())[0].pending).toEqual(
      pending.pending,
    );
    expect(synthetic.modelCalls()).toBe(0);
    expect(synthetic.toolCalls()).toBe(0);
  } finally {
    connection?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it('reopens observation mode and checks a new safety answer before restoring saved evidence', async () =>
  withFixedDate(instant, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'health-review-mode-resume-'));
    const databasePath = join(directory, 'records.sqlite');
    let connection: Awaited<ReturnType<typeof healthReviewSqlite>> | undefined;
    try {
      connection = await healthReviewSqlite(databasePath);
      const source = await connection.requests.create('다시 열 관찰 검토');
      await seedHealthKitBloodPressure(connection.repository);
      const synthetic = syntheticHealthReview(
        connection.repository,
        source.id,
        false,
      );
      // Imported HealthKit observations have independent IDs, so scope this fixture to personal records.
      const model = {
        ...synthetic.model,
        execution: {
          ...synthetic.model.execution,
          allowedScope: { sourceKinds: ['personal_record'] as const },
        },
      };
      const port = createHealthReviewPort({
        sourceId: source.id,
        repository: connection.repository,
        model,
        evidence: createHealthReviewInvocation(connection.data).evidence,
      });
      const collect = jest.spyOn(port, 'collect');
      const first = await runHealthReviewGraph({
        sourceId: source.id,
        threadId: source.id,
        safetyInput: safety,
        mode: 'record_observation',
        port,
        checkpointer: connection.saver(source.id),
      });
      if (first.status !== 'needs_clarification')
        throw new Error('Missing observation evidence interrupt');
      expect(first.pending.reason).toBe('evidence');
      expect(first.pending.mode).toBe('record_observation');
      expect(first.pending.references.length).toBeGreaterThan(0);
      expect(collect).toHaveBeenCalledTimes(1);
      const saved = await connection.requests.pending(source.id);
      expect(saved).toEqual(first.pending);

      connection.close();
      connection = undefined;
      connection = await healthReviewSqlite(databasePath);
      const restored = await connection.requests.pending(source.id);
      if (!restored) throw new Error('Missing restored observation snapshot');
      expect(restored).toEqual(first.pending);

      const resumedSynthetic = syntheticHealthReview(
        connection.repository,
        source.id,
        false,
      );
      const resumedModel = {
        ...resumedSynthetic.model,
        execution: {
          ...resumedSynthetic.model.execution,
          allowedScope: { sourceKinds: ['personal_record'] as const },
        },
      };
      const resumedPort = createHealthReviewPort({
        sourceId: source.id,
        repository: connection.repository,
        model: resumedModel,
        evidence: createHealthReviewInvocation(connection.data).evidence,
      });
      const resumedCollect = jest.spyOn(resumedPort, 'collect');
      const warningSymptoms = {
        ...safety,
        symptomAssessment: { status: 'warning_signs', signs: ['chest_pain'] },
      };
      const resumed = await runHealthReviewGraph({
        sourceId: source.id,
        threadId: source.id,
        safetyInput: warningSymptoms,
        mode: 'record_observation',
        port: resumedPort,
        checkpointer: connection.saver(source.id),
        clarification: { pending: restored, safetyInput: warningSymptoms },
      });

      expect(resumed).toMatchObject({
        status: 'needs_clarification',
        pending: {
          reason: 'safety_context',
          mode: 'record_observation',
          safety: {
            category: 'insufficient_information',
            missingInputs: ['explicit_symptom_assessment'],
          },
        },
      });
      expect(resumedCollect).not.toHaveBeenCalled();
      expect(resumedSynthetic.modelCalls()).toBe(0);
    } finally {
      connection?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }));
