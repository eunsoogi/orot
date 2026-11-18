import type { SettingsConsentPermission } from './settingsConsentGrant';

/** Changing a declared boundary requires explicit settings consent again. This catalog
 * describes possible permissions; it does not enable a recipient or create a grant. */
export const SETTINGS_CONSENT_CATALOG_VERSION = 'model-settings-v1';
export type SettingsConsentFeature = 'conversation' | 'calendar' | 'voice';

const permission = (
  purpose: string,
  policyVersion: string,
  dataCategories: readonly string[],
  sourceKinds: readonly string[],
): SettingsConsentPermission => ({
  purpose,
  policyVersion,
  dataCategories,
  sourceKinds,
});

const evidenceCategories = [
  'health_records',
  'reviewed_memory',
  'conversation',
  'medical_literature',
  'public_web_results',
  'photo_ocr',
];
const evidenceKinds = [
  'personal_record',
  'reviewed_memory',
  'external_medical',
];
const conversation: readonly SettingsConsentPermission[] = [
  ...['record_conversation', 'symptom_summary', 'disease_hypotheses'].flatMap(
    purpose => [
      permission(
        purpose,
        'local-records-v1',
        evidenceCategories,
        evidenceKinds,
      ),
      permission(
        purpose,
        'local-artifacts-v1',
        [...evidenceCategories, 'generated_artifacts'],
        [...evidenceKinds, 'generated_artifact'],
      ),
    ],
  ),
  permission(
    'visit_questions',
    'local-records-v1',
    ['health_records', 'reviewed_memory', 'visit_title_time'],
    ['personal_record', 'reviewed_memory'],
  ),
  permission(
    'visit_questions',
    'local-artifacts-v1',
    [
      'health_records',
      'reviewed_memory',
      'visit_title_time',
      'generated_artifacts',
    ],
    ['personal_record', 'reviewed_memory', 'generated_artifact'],
  ),
  permission(
    'daily_report',
    'daily-report-analysis-v2',
    ['health_records'],
    ['personal_record'],
  ),
  permission(
    'daily_report',
    'daily-report-calendar-analysis-v2',
    ['health_records', 'calendar_plans'],
    ['personal_record'],
  ),
  permission(
    'encounter_transcript_review',
    'single-recording-v1',
    ['selected_recording_transcript'],
    ['personal_record'],
  ),
  permission(
    'visit_recap',
    'transcript-recap-v1',
    ['selected_recording_transcript', 'prepared_visit_questions'],
    ['personal_record'],
  ),
];
const calendar = [
  permission(
    'calendar_classification',
    'upcoming-year-v1',
    ['calendar_title_time'],
    ['personal_record'],
  ),
];
const voice = [
  permission(
    'realtime_audio',
    'selected-realtime-v1',
    ['live_voice_audio', 'voice_conversation'],
    ['personal_record'],
  ),
  permission(
    'realtime_result',
    'selected-result-relay-v1',
    ['generated_answer'],
    ['personal_record', 'generated_artifact'],
  ),
];

/** Public search is deliberately separate: approving a text model does not grant
 * either the selected search recipient or Europe PMC access. */
export const publicSearchSettingsPermissions = {
  web: permission(
    'public_web_search',
    'controlled-public-topics-v2',
    ['public_web_search_terms'],
    ['external_medical'],
  ),
  medical: permission(
    'public_medical_search',
    'public-query-v1',
    ['medical_search_terms'],
    ['external_medical'],
  ),
} as const;

export function settingsPermissionsForFeature(
  feature: SettingsConsentFeature,
): readonly SettingsConsentPermission[] {
  const values =
    feature === 'conversation'
      ? conversation
      : feature === 'calendar'
        ? calendar
        : feature === 'voice'
          ? voice
          : null;
  if (!values) throw new Error('Unknown settings consent feature');
  return values.map(value => ({
    ...value,
    dataCategories: [...value.dataCategories],
    sourceKinds: [...value.sourceKinds],
  }));
}

/** A durable row cannot introduce arbitrary purpose/category names under a known
 * catalog version. Exact recipient/account ownership is checked separately. */
export function isCatalogPermission(value: SettingsConsentPermission): boolean {
  return [
    ...conversation,
    ...calendar,
    ...voice,
    ...Object.values(publicSearchSettingsPermissions),
  ].some(
    known =>
      known.purpose === value.purpose &&
      known.policyVersion === value.policyVersion &&
      value.dataCategories.length > 0 &&
      value.sourceKinds.length > 0 &&
      value.dataCategories.every(category =>
        known.dataCategories.includes(category),
      ) &&
      value.sourceKinds.every(kind => known.sourceKinds.includes(kind)),
  );
}

/** The selected recipient domain is part of the permission boundary, not a display label. */
export function isCatalogDomainPermission(
  feature: SettingsConsentFeature,
  domain: 'model' | 'public-web' | 'medical-search',
  value: SettingsConsentPermission,
): boolean {
  const candidates =
    domain === 'model'
      ? settingsPermissionsForFeature(feature)
      : feature !== 'conversation'
        ? []
        : domain === 'public-web'
          ? [publicSearchSettingsPermissions.web]
          : domain === 'medical-search'
            ? [publicSearchSettingsPermissions.medical]
            : [];
  return (
    isCatalogPermission(value) &&
    candidates.some(
      known =>
        known.purpose === value.purpose &&
        known.policyVersion === value.policyVersion,
    )
  );
}
