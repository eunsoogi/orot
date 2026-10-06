import { SleepImportError } from './errors';
import {
  sleepAnalysisTypeIdentifier,
  type SleepDeviceMetadata,
  type SleepObservation,
  type SleepSourceRevision,
  type SleepStage,
} from './types';

const stageByCategoryValue: Readonly<Record<number, SleepStage>> = {
  0: 'inBed',
  1: 'asleepUnspecified',
  2: 'awake',
  3: 'asleepCore',
  4: 'asleepDeep',
  5: 'asleepREM',
};

const deviceFields = [
  'name',
  'manufacturer',
  'model',
  'hardwareVersion',
  'firmwareVersion',
  'softwareVersion',
  'localIdentifier',
  'udiDeviceIdentifier',
] as const;

const isoTimestamp =
  /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00))$/;

export function mapHealthKitSleepSample(value: unknown): SleepObservation {
  // Native bridge payloads are runtime data; reject malformed values before persistence.
  if (!isRecord(value)) {
    throw new SleepImportError(
      'INVALID_SLEEP_SAMPLE',
      'A HealthKit sleep sample is required.',
    );
  }
  if (value.typeIdentifier !== sleepAnalysisTypeIdentifier) {
    throw new SleepImportError(
      'UNSUPPORTED_SLEEP_SAMPLE_TYPE',
      'Only HealthKit sleep-analysis samples can be imported.',
    );
  }
  const id = requiredText(value.id, 'INVALID_SLEEP_SAMPLE');
  const sourceIdentifier = requiredText(
    value.sourceIdentifier,
    'INVALID_SLEEP_SOURCE',
  );
  const sourceName = requiredText(value.sourceName, 'INVALID_SLEEP_SOURCE');
  const startDate = parseInstant(value.startDate);
  const endDate = parseInstant(value.endDate);
  if (endDate.epochMs <= startDate.epochMs) {
    throw new SleepImportError(
      'INVALID_SLEEP_INTERVAL',
      'A sleep interval must end after it starts.',
    );
  }
  if (
    typeof value.categoryValue !== 'number' ||
    !Number.isInteger(value.categoryValue)
  ) {
    throw new SleepImportError(
      'INVALID_SLEEP_CATEGORY',
      'A HealthKit sleep category must be an integer.',
    );
  }
  const revision = copyRevision(value.sourceVersion, value.sourceProductType);
  const source: SleepObservation['source'] = {
    identifier: sourceIdentifier,
    name: sourceName,
    ...(revision === undefined ? {} : { revision }),
  };
  const timeZone = optionalNullableText(
    value.timeZone,
    'INVALID_SLEEP_TIMEZONE',
  );

  return {
    id,
    // Keep unknown integer values visible so they cannot turn an observed day into no-data.
    stage: stageByCategoryValue[value.categoryValue] ?? 'unsupported',
    categoryValue: value.categoryValue,
    startDate: startDate.value,
    endDate: endDate.value,
    source,
    ...(value.device === undefined ? {} : { device: copyDevice(value.device) }),
    ...(timeZone === undefined ? {} : { timeZone }),
  };
}

function parseInstant(value: unknown): { value: string; epochMs: number } {
  if (typeof value !== 'string') {
    throw new SleepImportError(
      'INVALID_SLEEP_INTERVAL',
      'HealthKit sleep timestamps must include a timezone offset.',
    );
  }
  const match = isoTimestamp.exec(value);
  const calendarDay = value.slice(0, 10);
  const calendarStart = new Date(calendarDay + 'T00:00:00.000Z');
  const epochMs = Date.parse(value);
  if (
    !match ||
    !Number.isFinite(epochMs) ||
    !Number.isFinite(calendarStart.getTime()) ||
    calendarStart.toISOString().slice(0, 10) !== calendarDay
  ) {
    throw new SleepImportError(
      'INVALID_SLEEP_INTERVAL',
      'HealthKit sleep timestamps must be valid ISO-8601 instants.',
    );
  }
  return { value, epochMs };
}

function copyDevice(value: unknown): SleepDeviceMetadata | null {
  if (value === null) return null;
  if (!isRecord(value)) {
    throw new SleepImportError(
      'INVALID_SLEEP_DEVICE_METADATA',
      'HealthKit device metadata must be an object or null.',
    );
  }
  const device: Partial<Record<keyof SleepDeviceMetadata, string | null>> = {};
  for (const field of deviceFields) {
    const current = value[field];
    if (current === undefined) continue;
    if (current !== null && typeof current !== 'string') {
      throw new SleepImportError(
        'INVALID_SLEEP_DEVICE_METADATA',
        'HealthKit device metadata fields must be strings or null.',
      );
    }
    device[field] = current;
  }
  return device;
}

function copyRevision(
  versionValue: unknown,
  productTypeValue: unknown,
): SleepSourceRevision | undefined {
  const version = optionalNullableText(versionValue, 'INVALID_SLEEP_SOURCE');
  const productType = optionalNullableText(
    productTypeValue,
    'INVALID_SLEEP_SOURCE',
  );
  if (version === undefined && productType === undefined) return undefined;
  return {
    ...(version === undefined ? {} : { version }),
    ...(productType === undefined ? {} : { productType }),
  };
}

function requiredText(value: unknown, code: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new SleepImportError(
      code,
      'Required HealthKit sleep text is missing.',
    );
  }
  return value;
}

function optionalNullableText(
  value: unknown,
  code: string,
): string | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new SleepImportError(code, 'Optional HealthKit metadata is invalid.');
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
