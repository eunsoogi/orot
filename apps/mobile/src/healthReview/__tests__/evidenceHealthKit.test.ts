import { createHealthReviewPort } from '../../agent/healthReview/port';
import { syntheticHealthReview } from '../../agent/healthReview/syntheticFixture';
import { withFixedDate } from '../../agent/healthReview/testing/currentPeriodEvidenceFixture';
import { mapBloodPressureCorrelation } from '../../healthkit/bloodPressure/mapper';
import { correlation } from '../../healthkit/bloodPressure/testSupport';
import { createHealthReviewInvocation } from '../evidenceInvocation';
import { healthReviewSqlite, instant } from '../testing/sqlite';

/** Seed recent synthetic samples through the same mapper used for HealthKit imports. */
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
  const mapped = mapBloodPressureCorrelation(timed, instant);
  for (const observation of mapped.observations)
    await repository.put('health_observation', observation);
  return mapped.observations;
}

/** Resolve an opaque citation only after reading its current local source document. */
async function findHealthKitPressureReference(
  invocation: ReturnType<typeof createHealthReviewInvocation>,
) {
  const signal = new AbortController().signal;
  for (const reference of invocation.aliases.values()) {
    const result = await invocation.readSource(reference, signal);
    if (
      result.status === 'available' &&
      result.document.sourceKind === 'personal_record' &&
      result.document.records.some(
        entry =>
          entry.kind === 'health_observation' &&
          entry.record.concept === 'blood pressure systolic',
      )
    )
      return reference;
  }
  return undefined;
}

describe('HealthKit blood-pressure evidence freshness', () => {
  let f: Awaited<ReturnType<typeof healthReviewSqlite>>;

  beforeEach(async () => {
    f = await healthReviewSqlite();
    await f.seed();
  });
  afterEach(() => f.close());

  async function collectEvidence() {
    const source = await f.requests.create('검토');
    const invocation = createHealthReviewInvocation(f.data);
    const synthetic = syntheticHealthReview(f.repository, source.id, false);
    // Match the real service's consent-approved access to existing local records.
    const port = createHealthReviewPort({
      sourceId: source.id,
      repository: f.repository,
      model: {
        ...synthetic.model,
        execution: {
          ...synthetic.model.execution,
          allowedScope: { sourceKinds: ['personal_record'] },
        },
      },
      evidence: invocation.evidence,
    });
    const batch = await port.collect(new AbortController().signal);
    return { invocation, batch };
  }

  async function collectReferences() {
    return (await collectEvidence()).invocation;
  }

  it('keeps missing HealthKit pressure absent from evidence', async () =>
    withFixedDate(instant, async () => {
      const invocation = await collectReferences();
      expect(await findHealthKitPressureReference(invocation)).toBeUndefined();
    }));

  it('reads available imported pressure with its original time and source provenance', async () =>
    withFixedDate(instant, async () => {
      await seedHealthKitBloodPressure(f.repository);
      const invocation = await collectReferences();
      const reference = await findHealthKitPressureReference(invocation);
      if (!reference) throw new Error('Missing HealthKit overview evidence');

      expect(
        await invocation.readSource(reference, new AbortController().signal),
      ).toMatchObject({
        status: 'available',
        document: {
          sourceKind: 'personal_record',
          records: expect.arrayContaining([
            expect.objectContaining({
              kind: 'health_observation',
              record: expect.objectContaining({
                concept: 'blood pressure systolic',
                effectiveAt: instant,
                provenance: expect.objectContaining({
                  origin: 'imported',
                  source: expect.objectContaining({
                    system: 'healthkit',
                    sourceIdentifier: 'com.example.device',
                    sourceName: 'Blood pressure monitor',
                  }),
                }),
              }),
            }),
          ]),
        },
      });
    }));

  it('keeps an out-of-window imported reading out of current trends while retaining its original record time', async () =>
    withFixedDate(instant, async () => {
      const observations = await seedHealthKitBloodPressure(f.repository);
      const historicalAt = '2020-01-01T00:00:00.000Z';
      for (const observation of observations)
        await f.repository.put('health_observation', {
          ...observation,
          effectiveAt: historicalAt,
        });

      const { invocation, batch } = await collectEvidence();
      const measurements = batch.items.find(item =>
        item.content.startsWith('health_context: '),
      );
      if (!measurements)
        throw new Error('Missing current-period health context');
      const context = JSON.parse(
        measurements.content.slice('health_context: '.length),
      ) as { quantities: { concept: string }[] };
      expect(
        context.quantities.some(
          quantity => quantity.concept === 'blood pressure systolic',
        ),
      ).toBe(false);

      const reference = await findHealthKitPressureReference(invocation);
      if (!reference) throw new Error('Missing historical HealthKit evidence');
      expect(
        await invocation.readSource(reference, new AbortController().signal),
      ).toMatchObject({
        status: 'available',
        document: {
          records: expect.arrayContaining([
            expect.objectContaining({
              kind: 'health_observation',
              record: expect.objectContaining({ effectiveAt: historicalAt }),
            }),
          ]),
        },
      });
    }));

  it('invalidates stale pressure evidence when its source changes or disappears', async () =>
    withFixedDate(instant, async () => {
      const observations = await seedHealthKitBloodPressure(f.repository);
      const systolic = observations.find(
        observation => observation.concept === 'blood pressure systolic',
      );
      if (!systolic) throw new Error('Missing HealthKit systolic fixture');
      const invocation = await collectReferences();
      const reference = await findHealthKitPressureReference(invocation);
      if (!reference) throw new Error('Missing HealthKit overview evidence');
      const signal = new AbortController().signal;

      expect(await invocation.readSource(reference, signal)).toMatchObject({
        status: 'available',
      });
      await f.repository.put('health_observation', {
        ...systolic,
        value: { kind: 'quantity', amount: 125, unit: 'mmHg' },
      });
      expect(await invocation.readSource(reference, signal)).toEqual({
        status: 'changed',
      });
      await f.repository.delete('health_observation', systolic.id);
      expect(await invocation.readSource(reference, signal)).toEqual({
        status: 'missing',
      });
    }));

  it('keeps imported pressure unavailable when its source record cannot be read', async () =>
    withFixedDate(instant, async () => {
      const observations = await seedHealthKitBloodPressure(f.repository);
      const systolic = observations.find(
        observation => observation.concept === 'blood pressure systolic',
      );
      if (!systolic) throw new Error('Missing HealthKit systolic fixture');
      const invocation = await collectReferences();
      const reference = await findHealthKitPressureReference(invocation);
      if (!reference) throw new Error('Missing HealthKit overview evidence');

      const original = f.data.repository.readRecord.bind(f.data.repository);
      jest.spyOn(f.data.repository, 'readRecord').mockImplementation((async (
        kind: string,
        id: string,
        signal?: AbortSignal,
      ) => {
        if (kind === 'health_observation' && id === systolic.id)
          throw new Error('HealthKit evidence unavailable');
        return original(kind as 'health_observation', id, signal);
      }) as typeof f.data.repository.readRecord);
      expect(
        await invocation.readSource(reference, new AbortController().signal),
      ).toEqual({ status: 'unavailable' });
    }));
});
