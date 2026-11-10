import {
  HealthObservationSchema,
  ManualHistoryEvidenceSchema,
  SourceRecordSchema,
} from '@orot/domain';
import type { ManualHistoryRepository, SqlExecutor } from '@orot/storage';
import { RetainedSourceInvalidError } from '../aiFeatures/integration/retainedSourceError';
import type { TreatmentContext } from './types';
import type { ConversationArtifactSource } from '../ragConversation/conversationArtifactSources';
import { stableJson } from '../aiFeatures/integration/evidenceUtils';

/** Recheck record type and origin in the same snapshot as retention and freshness. */
export async function assertTreatmentAttribution(
  tx: SqlExecutor,
  history: ManualHistoryRepository,
  context: TreatmentContext,
  sources: readonly ConversationArtifactSource[],
): Promise<void> {
  if (context.clinicianPlans.status === 'source_records') {
    for (const plan of context.clinicianPlans.sources) {
      const rows = await tx.execute(
        'SELECT payload_json FROM source_records WHERE id = ?',
        [plan.record.id],
      );
      const raw = rows.rows[0]?.payload_json;
      let valid = false;
      if (typeof raw === 'string') {
        try {
          const parsed = SourceRecordSchema.safeParse(JSON.parse(raw));
          valid =
            parsed.success &&
            parsed.data.sourceKind === 'clinician_note' &&
            parsed.data.provenance.origin === 'clinician_recorded';
        } catch {
          /* Invalid source documents cannot establish clinician attribution. */
        }
      }
      if (!valid)
        throw new RetainedSourceInvalidError(
          'Clinician plan source attribution is unavailable.',
        );
    }
  }
  for (const condition of context.conditions) {
    if (condition.status === 'ai_possibility') {
      let hasIndependentRecord = false;
      for (const reference of condition.supportingEvidence) {
        const source = sources.find(
          item => stableJson(item.reference) === stableJson(reference),
        );
        if (
          !source ||
          source.reference.sourceKind !== 'personal_record' ||
          !('records' in source)
        )
          continue;
        for (const record of source.records) {
          if (record.kind === 'health_observation') {
            const rows = await tx.execute(
              'SELECT payload_json FROM health_observations WHERE id = ?',
              [record.id],
            );
            const raw = rows.rows[0]?.payload_json;
            if (typeof raw === 'string') {
              try {
                hasIndependentRecord ||= HealthObservationSchema.safeParse(
                  JSON.parse(raw),
                ).success;
              } catch {
                /* Do not treat malformed retained data as evidence. */
              }
            }
          }
          if (record.kind === 'manual_history') {
            const current = await history.getEvidence(record.id, tx);
            if (
              current &&
              ['diagnosis_history', 'procedure'].includes(current.kind)
            )
              hasIndependentRecord = true;
          }
        }
      }
      if (!hasIndependentRecord)
        throw new RetainedSourceInvalidError(
          'A possibility needs non-medication personal evidence.',
        );
      continue;
    }
    let origin: string | undefined;
    if (condition.record.kind === 'manual_history') {
      const parsed = ManualHistoryEvidenceSchema.safeParse(
        await history.getEvidence(condition.record.id, tx),
      );
      if (parsed.success && parsed.data.kind === 'diagnosis_history')
        origin = parsed.data.provenance.origin;
    } else {
      const rows = await tx.execute(
        'SELECT payload_json FROM health_observations WHERE id = ?',
        [condition.record.id],
      );
      const raw = rows.rows[0]?.payload_json;
      if (typeof raw === 'string') {
        try {
          const parsed = HealthObservationSchema.safeParse(JSON.parse(raw));
          if (parsed.success && parsed.data.observationKind === 'diagnosis')
            origin = parsed.data.provenance.origin;
        } catch {
          /* Invalid original records are never exposed through a saved context. */
        }
      }
    }
    const expected =
      condition.status === 'clinician_recorded'
        ? 'clinician_recorded'
        : 'user_reported';
    if (origin !== expected)
      throw new RetainedSourceInvalidError(
        'Treatment condition attribution is unavailable.',
      );
  }
}
