import type { SettingsConsentPermission } from './settingsConsentGrant';

/** The ordinary Conversation transmission catalog. Voice derives a closed subset
 * of the same operation rows, without adopting the text recipient or its grant. */
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
export const conversationSettingsPermissions: readonly SettingsConsentPermission[] =
  [
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
// An allowlist keeps future text categories from silently widening Live.
export const liveConversationSettingsPermissions =
  conversationSettingsPermissions
    .filter(row => row.purpose === 'record_conversation')
    .map(row => ({
      ...row,
      dataCategories: row.dataCategories.filter(category =>
        [
          'health_records',
          'reviewed_memory',
          'conversation',
          'generated_artifacts',
        ].includes(category),
      ),
      sourceKinds: row.sourceKinds.filter(kind =>
        ['personal_record', 'reviewed_memory', 'generated_artifact'].includes(
          kind,
        ),
      ),
    }));
