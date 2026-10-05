export const bloodPressureSampleTypeIdentifiers = {
  correlation: 'HKCorrelationTypeIdentifierBloodPressure',
  systolic: 'HKQuantityTypeIdentifierBloodPressureSystolic',
  diastolic: 'HKQuantityTypeIdentifierBloodPressureDiastolic',
} as const;

export type BloodPressureComponent = 'systolic' | 'diastolic';
export type BloodPressureUnit = 'mmHg' | 'kPa';

export interface HealthKitDeviceSnapshot {
  readonly name?: string;
  readonly manufacturer?: string;
  readonly model?: string;
  readonly hardwareVersion?: string;
  readonly softwareVersion?: string;
}

export interface BloodPressureQuantitySnapshot {
  readonly id: string;
  readonly typeIdentifier: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly sourceIdentifier: string;
  readonly sourceName: string;
  readonly device?: HealthKitDeviceSnapshot;
  readonly originalValue: number;
  readonly originalUnit: string;
}

export interface BloodPressureCorrelationSnapshot {
  readonly id: string;
  readonly typeIdentifier: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly sourceIdentifier: string;
  readonly sourceName: string;
  readonly device?: HealthKitDeviceSnapshot;
  readonly components?: readonly BloodPressureQuantitySnapshot[];
}

export interface BloodPressureReading {
  readonly sampleId: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly sourceIdentifier: string;
  readonly sourceName: string;
  readonly device?: HealthKitDeviceSnapshot;
  readonly originalValue: number;
  readonly originalUnit: BloodPressureUnit;
  readonly normalizedValue: number;
  readonly normalizedUnit: 'mmHg';
}

export interface BloodPressureObservation {
  /** The HealthKit correlation UUID is the stable upsert and deletion key. */
  readonly id: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly sourceIdentifier: string;
  readonly sourceName: string;
  readonly device?: HealthKitDeviceSnapshot;
  readonly provenance: {
    readonly origin: 'imported';
    readonly sourceSystem: 'HealthKit';
    readonly sourceSampleId: string;
    readonly sourceIdentifier: string;
    readonly sourceName: string;
  };
  readonly systolic: BloodPressureReading | null;
  readonly diastolic: BloodPressureReading | null;
}

export interface BloodPressureChangePage {
  readonly insertedOrUpdated: readonly BloodPressureCorrelationSnapshot[];
  readonly deletedCorrelationIds: readonly string[];
}

export interface BloodPressureTransaction {
  upsert(observation: BloodPressureObservation): Promise<void>;
  delete(correlationId: string): Promise<void>;
}

export interface BloodPressureWriter {
  transaction<T>(
    operation: (transaction: BloodPressureTransaction) => Promise<T>,
  ): Promise<T>;
}
