import {
  HealthObservationSchema,
  ManualHistoryEntrySchema,
} from '@orot/domain';
import type { HealthObservation, ManualHistoryEntry } from '@orot/domain';

export type OriginalCondition =
  | { readonly kind: 'observation'; readonly record: HealthObservation }
  | { readonly kind: 'manual_history'; readonly record: ManualHistoryEntry };

export type OriginalConditionStatus =
  'clinician_attributed' | 'user_attributed' | 'unavailable';

/** Attribution does not assert that the record describes a present diagnosis. */
export function classifyOriginalCondition(
  value: OriginalCondition,
): OriginalConditionStatus {
  if (value.kind === 'manual_history') {
    const parsed = ManualHistoryEntrySchema.safeParse(value.record);
    return parsed.success && parsed.data.kind === 'diagnosis_history'
      ? 'user_attributed'
      : 'unavailable';
  }
  const parsed = HealthObservationSchema.safeParse(value.record);
  if (!parsed.success || parsed.data.observationKind !== 'diagnosis')
    return 'unavailable';
  if (parsed.data.provenance.origin === 'clinician_recorded')
    return 'clinician_attributed';
  if (parsed.data.provenance.origin === 'user_reported')
    return 'user_attributed';
  return 'unavailable';
}
