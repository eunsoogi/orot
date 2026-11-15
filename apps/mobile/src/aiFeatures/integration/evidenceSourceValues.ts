import { t } from '../../i18n';

import { fieldLabels } from './evidenceFieldLabels';
export { fieldLabels } from './evidenceFieldLabels';

const enumLabels: Record<string, Record<string, string>> = {
  concept: {
    'blood pressure systolic': t(
      'evidenceValue.enumLabels.concept.blood pressure systolic',
    ),
    'blood pressure diastolic': t(
      'evidenceValue.enumLabels.concept.blood pressure diastolic',
    ),
    blood_pressure_systolic: t(
      'evidenceValue.enumLabels.concept.blood_pressure_systolic',
    ),
    blood_pressure_diastolic: t(
      'evidenceValue.enumLabels.concept.blood_pressure_diastolic',
    ),
    heart_rate: t('evidenceValue.enumLabels.concept.heart_rate'),
    step_count: t('evidenceValue.enumLabels.concept.step_count'),
    body_mass: t('evidenceValue.enumLabels.concept.body_mass'),
    weight: t('evidenceValue.enumLabels.concept.weight'),
    HKCategoryTypeIdentifierSleepAnalysis: t(
      'evidenceValue.enumLabels.concept.HKCategoryTypeIdentifierSleepAnalysis',
    ),
    sleep: t('evidenceValue.enumLabels.concept.sleep'),
  },
  assertionKind: {
    prescribed: t('evidenceValue.enumLabels.assertionKind.prescribed'),
    current_medication_confirmation: t(
      'evidenceValue.enumLabels.assertionKind.current_medication_confirmation',
    ),
  },
  eventKind: {
    taken: t('evidenceValue.enumLabels.eventKind.taken'),
    missed: t('evidenceValue.enumLabels.eventKind.missed'),
    administered: t('evidenceValue.enumLabels.eventKind.administered'),
    observed: t('evidenceValue.enumLabels.eventKind.observed'),
  },
  observationStatus: {
    not_interacted: t(
      'evidenceValue.enumLabels.observationStatus.not_interacted',
    ),
    notification_not_sent: t(
      'evidenceValue.enumLabels.observationStatus.notification_not_sent',
    ),
    snoozed: t('evidenceValue.enumLabels.observationStatus.snoozed'),
    taken: t('evidenceValue.enumLabels.observationStatus.taken'),
    skipped: t('evidenceValue.enumLabels.observationStatus.skipped'),
    not_logged: t('evidenceValue.enumLabels.observationStatus.not_logged'),
    unknown: t('evidenceValue.enumLabels.observationStatus.unknown'),
  },
  scheduleType: {
    as_needed: t('evidenceValue.enumLabels.scheduleType.as_needed'),
    scheduled: t('evidenceValue.enumLabels.scheduleType.scheduled'),
  },
  priority: {
    routine: t('evidenceValue.enumLabels.priority.routine'),
    important: t('evidenceValue.enumLabels.priority.important'),
  },
  encounterKind: {
    outpatient: t('evidenceValue.enumLabels.encounterKind.outpatient'),
    urgent_care: t('evidenceValue.enumLabels.encounterKind.urgent_care'),
    emergency: t('evidenceValue.enumLabels.encounterKind.emergency'),
    inpatient: t('evidenceValue.enumLabels.encounterKind.inpatient'),
    telehealth: t('evidenceValue.enumLabels.encounterKind.telehealth'),
    other: t('evidenceValue.enumLabels.encounterKind.other'),
  },
  kind: {
    boolean: t('evidenceValue.enumLabels.kind.boolean'),
    preference: t('evidenceValue.enumLabels.kind.preference'),
    quantity: t('evidenceValue.enumLabels.kind.quantity'),
    reviewed_interaction: t(
      'evidenceValue.enumLabels.kind.reviewed_interaction',
    ),
    task_context: t('evidenceValue.enumLabels.kind.task_context'),
    text: t('evidenceValue.enumLabels.kind.text'),
  },
  observationKind: {
    allergy: t('evidenceValue.enumLabels.observationKind.allergy'),
    diagnosis: t('evidenceValue.enumLabels.observationKind.diagnosis'),
    measurement: t('evidenceValue.enumLabels.observationKind.measurement'),
    other: t('evidenceValue.enumLabels.observationKind.other'),
    procedure: t('evidenceValue.enumLabels.observationKind.procedure'),
  },
  origin: {
    caregiver_reported: t('evidenceValue.enumLabels.origin.caregiver_reported'),
    clinician_recorded: t('evidenceValue.enumLabels.origin.clinician_recorded'),
    derived: t('evidenceValue.enumLabels.origin.derived'),
    device_recorded: t('evidenceValue.enumLabels.origin.device_recorded'),
    imported: t('evidenceValue.enumLabels.origin.imported'),
    user_reported: t('evidenceValue.enumLabels.origin.user_reported'),
  },
  reviewState: {
    human_reviewed: t('evidenceValue.enumLabels.reviewState.human_reviewed'),
    user_confirmed: t('evidenceValue.enumLabels.reviewState.user_confirmed'),
  },
  sourceKind: {
    audio_recording: t('evidenceValue.enumLabels.sourceKind.audio_recording'),
    caregiver_note: t('evidenceValue.enumLabels.sourceKind.caregiver_note'),
    clinician_note: t('evidenceValue.enumLabels.sourceKind.clinician_note'),
    device_export: t('evidenceValue.enumLabels.sourceKind.device_export'),
    imaging_report: t('evidenceValue.enumLabels.sourceKind.imaging_report'),
    lab_report: t('evidenceValue.enumLabels.sourceKind.lab_report'),
    medical_document: t('evidenceValue.enumLabels.sourceKind.medical_document'),
    other: t('evidenceValue.enumLabels.sourceKind.other'),
    prescription: t('evidenceValue.enumLabels.sourceKind.prescription'),
    user_note: t('evidenceValue.enumLabels.sourceKind.user_note'),
  },
  status: {
    available: t('evidenceValue.enumLabels.status.available'),
    unavailable: t('evidenceValue.enumLabels.status.unavailable'),
    scheduled: t('evidenceValue.enumLabels.status.scheduled'),
    completed: t('evidenceValue.enumLabels.status.completed'),
    cancelled: t('evidenceValue.enumLabels.status.cancelled'),
    needs_review: t('evidenceValue.enumLabels.status.needs_review'),
    reviewed: t('evidenceValue.enumLabels.status.reviewed'),
    unreviewed: t('evidenceValue.enumLabels.status.unreviewed'),
  },
  // Keep the storage/provider identifier internal and show a familiar source name.
  system: { healthkit: t('evidenceValue.enumLabels.system.healthkit') },
};

export function visibleValue(value: unknown, key?: string): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') {
    if (key?.endsWith('At') && Number.isFinite(Date.parse(value))) {
      // Show the device's local time and zone, rather than silently presenting UTC as local.
      return new Intl.DateTimeFormat('ko-KR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
      }).format(new Date(value));
    }
    return enumLabels[key ?? '']?.[value] ?? value;
  }
  if (typeof value === 'number') {
    if (key === 'recordingDurationMs') {
      const seconds = Math.floor(value / 1000);
      return t('evidenceValue.duration', {
        minutes: Math.floor(seconds / 60),
        seconds: seconds % 60,
      });
    }
    return String(value);
  }
  if (typeof value === 'boolean')
    return value ? t('evidenceValue.yes') : t('evidenceValue.no');
  if (Array.isArray(value)) {
    const items = value
      .map(item => visibleValue(item))
      .filter((item): item is string => item !== undefined);
    return items.length ? items.join(', ') : undefined;
  }
  if (typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  if (
    record.status === 'unavailable' &&
    record.reason === 'healthkit_does_not_expose_original_display_unit'
  ) {
    // A source-display limitation is import bookkeeping, not missing normalized measurement data.
    return undefined;
  }
  if (record.kind === 'text') return visibleValue(record.text);
  if (record.kind === 'boolean') return visibleValue(record.value);
  if (typeof record.amount === 'number' && typeof record.unit === 'string') {
    const original = visibleValue(record.sourceRepresentation);
    return `${record.amount} ${record.unit}${original ? t('evidenceValue.sourceRepresentation', { original }) : ''}`;
  }
  // Record IDs support local linkage but do not belong in user-facing summaries.
  const rows = Object.entries(value as Record<string, unknown>)
    .filter(
      ([fieldKey]) => !isPrivateIdentifier(fieldKey) && fieldLabels[fieldKey],
    )
    .map(([fieldKey, item]) => {
      const rendered = visibleValue(item, fieldKey);
      return rendered
        ? `${fieldLabels[fieldKey] ?? fieldKey}: ${rendered}`
        : undefined;
    })
    .filter((item): item is string => item !== undefined);
  return rows.length ? rows.join(' · ') : undefined;
}

export function isPrivateIdentifier(key: string): boolean {
  if (key === 'timeZoneIdentifier') return false;
  return (
    key === 'id' ||
    key.endsWith('Id') ||
    key.endsWith('Ids') ||
    key.endsWith('Identifier') ||
    key === 'contentHash' ||
    key === 'externalReference'
  );
}
