import type { RecordMap } from '@orot/storage';
import type {
  HealthKitFeature,
  HealthKitNativeModule,
  HealthKitSampleSnapshot,
  HealthKitSampleKind,
} from '../types';
import { commonObservationRecordId } from './mapper';
import type { CommonObservationFeature } from './types';

export interface CommonObservationsProbeModule extends HealthKitNativeModule {
  prepareSyntheticFixture(
    feature: HealthKitFeature,
  ): Promise<{ readonly mode: 'synthetic' }>;
  removeSyntheticFixture(): Promise<void>;
  inspectReadAuthorizationPlan(feature: HealthKitFeature): Promise<{
    readonly availability: 'available' | 'unsupportedFeature';
    readonly readTypeIdentifiers: readonly string[];
    readonly writeTypeIdentifiers: readonly string[];
  }>;
  inspectSampleType(
    feature: HealthKitFeature,
    sampleKind: HealthKitSampleKind,
  ): Promise<string>;
}

export const commonObservationProbeFeatures: readonly CommonObservationFeature[] =
  ['heartRate', 'steps', 'bodyMass'];

export const commonObservationProbeSampleIds = {
  heartRate: 'synthetic-heart-rate',
  steps: 'synthetic-steps',
  bodyMass: 'synthetic-body-mass',
};

const sampleTypes: Readonly<Record<CommonObservationFeature, string>> = {
  heartRate: 'HKQuantityTypeIdentifierHeartRate',
  steps: 'HKQuantityTypeIdentifierStepCount',
  bodyMass: 'HKQuantityTypeIdentifierBodyMass',
};

export async function verifyCommonObservationReadPlans(
  native: CommonObservationsProbeModule,
): Promise<void> {
  for (const feature of commonObservationProbeFeatures) {
    const plan = await native.inspectReadAuthorizationPlan(feature);
    assertProbe(
      plan.availability === 'available',
      `${feature} is unsupported.`,
    );
    assertProbe(
      plan.writeTypeIdentifiers.length === 0,
      `${feature} requested HealthKit write access.`,
    );
    assertProbe(
      JSON.stringify([...plan.readTypeIdentifiers].sort()) ===
        JSON.stringify([sampleTypes[feature]]),
      `${feature} does not have a feature-scoped read plan.`,
    );
    assertProbe(
      (await native.inspectSampleType(feature, feature)) ===
        sampleTypes[feature],
      `${feature} query selected an unexpected sample type.`,
    );
  }
}

export function findCommonObservationRecord(
  records: readonly RecordMap['health_observation'][],
  feature: Exclude<CommonObservationFeature, 'bodyMass'>,
): RecordMap['health_observation'] {
  const record = records.find(
    item =>
      item.id ===
      commonObservationRecordId(
        feature,
        commonObservationProbeSampleIds[feature],
      ),
  );
  assertProbe(record, `${feature} was not persisted in local storage.`);
  return record;
}

export function assertCommonObservationQuantity(
  record: RecordMap['health_observation'],
  concept: string,
  amount: number,
  unit: string,
  feature: Exclude<CommonObservationFeature, 'bodyMass'>,
  sourceSample: HealthKitSampleSnapshot,
): void {
  assertProbe(
    sourceSample.value === amount,
    `${feature} fixture amount changed.`,
  );
  assertProbe(sourceSample.unit === unit, `${feature} fixture unit changed.`);
  assertProbe(
    record.observationKind === 'measurement',
    'Wrong observation kind.',
  );
  assertProbe(record.concept === concept, `${feature} has the wrong concept.`);
  assertProbe(
    record.value.kind === 'quantity',
    `${feature} is not a quantity.`,
  );
  assertProbe(
    record.value.amount === amount,
    `${feature} has the wrong amount.`,
  );
  assertProbe(record.value.unit === unit, `${feature} has the wrong unit.`);
  assertProbe(
    record.value.sourceRepresentation?.status === 'unavailable',
    `${feature} original display unit was not marked unavailable.`,
  );
  assertProbe(
    record.effectiveAt === sourceSample.startDate,
    `${feature} start time changed.`,
  );
  assertProbe(
    record.endedAt === sourceSample.endDate,
    `${feature} end time changed.`,
  );
  assertProbe(
    record.recordedAt === undefined,
    `${feature} gained invented source time.`,
  );
  assertProbe(
    record.provenance.source?.system === 'healthkit',
    'Source system changed.',
  );
  assertProbe(
    record.provenance.source?.sourceIdentifier ===
      sourceSample.sourceIdentifier,
    `${feature} source identifier changed.`,
  );
  assertProbe(
    record.provenance.source?.sourceName === sourceSample.sourceName,
    `${feature} source name changed.`,
  );
  assertProbe(
    record.provenance.sourceRecordIds.includes(sourceSample.id),
    `${feature} sample identifier was not preserved.`,
  );
  assertProbe(
    record.reviewState.status === 'unreviewed',
    `${feature} review state changed.`,
  );
}

export function assertProbe(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new Error(message);
}
