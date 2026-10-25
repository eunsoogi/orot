import type {
  HealthKitNativeModule,
  HealthKitSampleChangesResult,
} from '../types';

export const observedAt = '2026-10-05T10:00:00.000Z';

export function page(
  values: Partial<
    Extract<HealthKitSampleChangesResult, { status: 'completed' }>
  > = {},
): HealthKitSampleChangesResult {
  return {
    availability: 'available',
    status: 'completed',
    readAuthorization: 'notObservable',
    addedSamples: [],
    deletedSampleIds: [],
    cursor: null,
    hasMore: false,
    ...values,
  };
}

export function healthKit(
  pages: HealthKitSampleChangesResult[],
): Pick<
  HealthKitNativeModule,
  'requestReadAuthorization' | 'querySampleChanges'
> {
  return {
    requestReadAuthorization: jest.fn().mockResolvedValue({
      availability: 'available',
      requestStatus: 'completed',
      readAuthorization: 'notObservable',
    }),
    querySampleChanges: jest.fn().mockImplementation(async () => {
      const next = pages.shift();
      if (!next) throw new Error('Unexpected HealthKit page request.');
      return next;
    }),
  };
}
