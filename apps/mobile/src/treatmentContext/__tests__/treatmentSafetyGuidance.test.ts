import { t } from '../../i18n';
import { treatmentSafetyGuidance } from '../treatmentSafetyGuidance';
import { evaluateTreatmentOutput } from '../treatmentSafetyBoundary';
import type { TreatmentExplanationRequest } from '../interfaces';

test('offers a bounded clinician discussion when generated claims are withheld', () => {
  const keys = treatmentSafetyGuidance({
    status: 'withheld',
    reason: 'unsafe',
  });
  expect(keys).toEqual(['treatmentSafety.withheld']);
  expect(t('treatmentSafety.withheld')).toContain('의료진');
  expect(
    treatmentSafetyGuidance({ status: 'withheld', reason: 'cancelled' }),
  ).toEqual([]);
});

test('cancelling generation cannot suppress an already established emergency action', async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await evaluateTreatmentOutput(
    null,
    {} as TreatmentExplanationRequest,
    undefined,
    controller.signal,
    ['seek_immediate_emergency_help'],
  );
  expect(treatmentSafetyGuidance(result)).toEqual([
    'treatmentSafety.emergency',
  ]);
});

test('emergency guidance uses app-owned copy and excludes home treatment', () => {
  const keys = treatmentSafetyGuidance({
    status: 'urgent',
    actions: [
      'seek_immediate_emergency_help',
      'recheck_measurement_after_60_seconds',
    ],
  });
  expect(keys).toEqual(['treatmentSafety.emergency']);
  expect(t('treatmentSafety.emergency')).toContain('즉시');
  expect(
    treatmentSafetyGuidance({
      status: 'urgent',
      actions: [
        'seek_immediate_emergency_help_if_warning_signs_are_present',
        'contact_clinician_promptly',
      ],
    }),
  ).toEqual([
    'treatmentSafety.conditionalEmergency',
    'treatmentSafety.clinicianPromptly',
  ]);
});
