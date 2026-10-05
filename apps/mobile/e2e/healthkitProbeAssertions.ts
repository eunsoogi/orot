import type {
  HealthKitFeature,
  HealthKitNativeModule,
  HealthKitSampleKind,
} from '../src/healthkit/types';

export interface AuthorizationPlan {
  readonly availability: 'available' | 'unsupportedFeature';
  readonly readTypeIdentifiers: readonly string[];
  readonly writeTypeIdentifiers: readonly string[];
}

export interface HealthKitProbeModule extends HealthKitNativeModule {
  prepareSyntheticFixture(
    feature: HealthKitFeature,
  ): Promise<{ readonly mode: 'synthetic' }>;
  removeSyntheticFixture(): Promise<void>;
  inspectReadAuthorizationPlan(
    feature: HealthKitFeature,
  ): Promise<AuthorizationPlan>;
  inspectSampleType(
    feature: HealthKitFeature,
    sampleKind: HealthKitSampleKind,
  ): Promise<string>;
}

const expectedReadTypes: Record<
  Exclude<HealthKitFeature, 'medications'>,
  readonly string[]
> = {
  bloodPressure: [
    'HKQuantityTypeIdentifierBloodPressureDiastolic',
    'HKQuantityTypeIdentifierBloodPressureSystolic',
  ],
  sleep: ['HKCategoryTypeIdentifierSleepAnalysis'],
  heartRate: ['HKQuantityTypeIdentifierHeartRate'],
  steps: ['HKQuantityTypeIdentifierStepCount'],
  bodyMass: ['HKQuantityTypeIdentifierBodyMass'],
};

const sampleTypeCases: ReadonlyArray<{
  feature: HealthKitFeature;
  sampleKind: HealthKitSampleKind;
  expected: string;
}> = [
  {
    feature: 'medications',
    sampleKind: 'medicationDoseEvents',
    expected: 'HKMedicationDoseEventTypeIdentifierMedicationDoseEvent',
  },
  {
    feature: 'bloodPressure',
    sampleKind: 'bloodPressure',
    expected: 'HKCorrelationTypeIdentifierBloodPressure',
  },
  {
    feature: 'sleep',
    sampleKind: 'sleep',
    expected: 'HKCategoryTypeIdentifierSleepAnalysis',
  },
  {
    feature: 'heartRate',
    sampleKind: 'heartRate',
    expected: 'HKQuantityTypeIdentifierHeartRate',
  },
  {
    feature: 'steps',
    sampleKind: 'steps',
    expected: 'HKQuantityTypeIdentifierStepCount',
  },
  {
    feature: 'bodyMass',
    sampleKind: 'bodyMass',
    expected: 'HKQuantityTypeIdentifierBodyMass',
  },
];

export function assertAuthorizationPlan(
  feature: HealthKitFeature,
  plan: AuthorizationPlan,
): void {
  if (plan.writeTypeIdentifiers.length !== 0) {
    throw new Error(`${feature} authorization plan includes write types.`);
  }
  if (plan.availability === 'unsupportedFeature') return;

  const actual = [...plan.readTypeIdentifiers].sort();
  const expected =
    feature === 'medications'
      ? [
          // The runtime ID omits "Identifier" from its SDK constant's symbol name.
          'HKDataTypeUserAnnotatedMedicationConcept',
          'HKMedicationDoseEventTypeIdentifierMedicationDoseEvent',
        ]
      : [...expectedReadTypes[feature]];
  if (JSON.stringify(actual) !== JSON.stringify(expected.sort())) {
    throw new Error(
      `${feature} requested unexpected HealthKit types: ${JSON.stringify(actual)}`,
    );
  }
}

export async function assertSampleTypeMappings(
  plans: ReadonlyMap<HealthKitFeature, AuthorizationPlan>,
  native: Pick<HealthKitProbeModule, 'inspectSampleType'>,
): Promise<void> {
  for (const item of sampleTypeCases) {
    if (plans.get(item.feature)?.availability === 'unsupportedFeature')
      continue;
    const actual = await native.inspectSampleType(
      item.feature,
      item.sampleKind,
    );
    if (actual !== item.expected) {
      throw new Error(
        `${item.feature} query selected ${actual}, expected ${item.expected}.`,
      );
    }
  }
  console.log('HEALTHKIT_SAMPLE_TYPES passed');
}
