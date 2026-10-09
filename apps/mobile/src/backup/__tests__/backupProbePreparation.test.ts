import { isExpectedProtectionMetadataGap } from '../../../e2e/backupProbePreparation';
import type { LegacyRecordingProbeState } from '../../../e2e/backupProbeTypes';

const simulatorReadbackGap: LegacyRecordingProbeState = {
  fileProtection: 'unverified',
  excludedFromBackup: false,
  fileReadable: true,
  legacyExcludedBefore: true,
  preparedCount: 0,
  preparationError: 'protection-not-applied',
  preparationReady: false,
};

describe('legacy recording backup probe classification', () => {
  test('accepts only an unavailable Simulator protection readback as a negative result', () => {
    expect(isExpectedProtectionMetadataGap(simulatorReadbackGap)).toBe(true);
  });

  test.each([
    ['backup exclusion failure', 'backup-eligibility-not-applied'],
    ['other native failure', 'other-native-error'],
    ['unclassified preparation failure', 'recording-preparation-failed'],
  ] as const)(
    'rejects %s even when protection is unverified',
    (_, preparationError) => {
      expect(
        isExpectedProtectionMetadataGap({
          ...simulatorReadbackGap,
          preparationError,
        }),
      ).toBe(false);
    },
  );

  test.each([
    ['a returned non-complete protection value', 'not-complete'],
    ['a complete value with a preparation failure', 'complete'],
  ] as const)('rejects %s as a metadata limitation', (_, fileProtection) => {
    expect(
      isExpectedProtectionMetadataGap({
        ...simulatorReadbackGap,
        fileProtection,
      }),
    ).toBe(false);
  });

  test('rejects inconsistent counts or a ready result as a negative outcome', () => {
    expect(
      isExpectedProtectionMetadataGap({
        ...simulatorReadbackGap,
        preparedCount: 1,
      }),
    ).toBe(false);
    expect(
      isExpectedProtectionMetadataGap({
        ...simulatorReadbackGap,
        preparationReady: true,
      }),
    ).toBe(false);
  });
});
