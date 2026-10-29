import type { RecordKind } from '@orot/storage';
import { assessHealthEvidenceCoverage } from '../../healthEvidence/coverage';
import type { LocalHealthEvidenceInventory } from '../../healthEvidence/localEvidenceRepository';
import type { HealthKitAutoSyncStatus } from '../../healthkit/autoSyncCheckpoint';
import { t } from '../../i18n';
import type { TranslationKey } from '../../i18n';

const categoryKeyByRecordKind = {
  source_record: 'ragConversation.availability.category.sourceRecord',
  evidence_span: 'ragConversation.availability.category.evidenceSpan',
  encounter: 'ragConversation.availability.category.encounter',
  health_observation: 'ragConversation.availability.category.healthObservation',
  symptom_entry: 'ragConversation.availability.category.symptomEntry',
  medication_definition:
    'ragConversation.availability.category.medicationDefinition',
  medication_assertion:
    'ragConversation.availability.category.medicationAssertion',
  dose_event: 'ragConversation.availability.category.doseEvent',
  appointment: 'ragConversation.availability.category.appointment',
  visit_question: 'ragConversation.availability.category.visitQuestion',
  visit_brief: 'ragConversation.availability.category.visitBrief',
  transcript_segment: 'ragConversation.availability.category.transcriptSegment',
} as const satisfies Record<RecordKind, TranslationKey>;

/** Summarizes only category and coverage metadata; record payloads and access grants stay private. */
export function describeLocalRecordAvailability(
  inventory: LocalHealthEvidenceInventory,
  syncStatus: { readonly status: HealthKitAutoSyncStatus } | null,
): string {
  const coverage = assessHealthEvidenceCoverage(inventory);
  const categories = [
    ...new Set(
      inventory.availableKinds.map(kind => t(categoryKeyByRecordKind[kind])),
    ),
  ];
  const summary = categories.length
    ? t('ragConversation.availability.categories', {
        categories: categories.join(', '),
      })
    : coverage.status === 'complete'
      ? t('ragConversation.availability.empty')
      : t('ragConversation.availability.noKinds');
  const partial =
    coverage.status === 'complete'
      ? undefined
      : t('ragConversation.availability.partial');
  const sync = t(
    syncStatus?.status === 'complete'
      ? 'ragConversation.availability.syncComplete'
      : syncStatus?.status === 'retryable'
        ? 'ragConversation.availability.syncRetryable'
        : 'ragConversation.availability.syncUnknown',
  );
  return [summary, partial, sync, t('ragConversation.availability.scope')]
    .filter(Boolean)
    .join(' ');
}
