import type { EvidenceSourceKind } from '@orot/agent-runtime';
import { providerDiagnostic } from '../../providers/diagnostics';
import type { Outcome, Stage } from '../../providers/diagnosticTypes';

const stages: Record<EvidenceSourceKind, Stage> = {
  personal_record: 'tool_capture_personal',
  reviewed_memory: 'tool_capture_memory',
  generated_artifact: 'tool_capture_generated',
  external_medical: 'tool_capture_external',
};
// Match complete app-owned messages only. Unknown/private errors collapse to a fixed code.
const reasons = new Map<string, Outcome>([
  ['The cited source changed before saving.', 'tool_cited_changed'],
  ['Conversation photos require their request owner.', 'tool_photo_owner'],
  [
    'The filtered tool source cannot be retained as a new citation.',
    'tool_filter_rejected',
  ],
  ['The generated source changed before saving.', 'tool_generated_changed'],
  ['The generated source identity is invalid.', 'tool_generated_identity'],
  [
    'The generated summary has incomplete input lineage.',
    'tool_generated_lineage',
  ],
  ['The attached photo changed before saving.', 'tool_photo_changed'],
  ['The generated parent changed or was removed.', 'tool_parent_changed'],
  ['The generated parent cannot be retained.', 'tool_parent_invalid'],
  ['The generated parent is unavailable.', 'tool_parent_unavailable'],
]);

/** Observe only failed source captures; preserve the exact result/error and never emit its text. */
export async function observeCapturedToolSource<T>(
  kind: EvidenceSourceKind,
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    try {
      providerDiagnostic(
        'storage',
        Object.prototype.hasOwnProperty.call(stages, kind)
          ? stages[kind]
          : 'tool_event_capture',
        error instanceof Error
          ? (reasons.get(error.message) ?? 'other')
          : 'other',
      );
    } catch {
      /* Optional fixed diagnostics cannot affect source validation. */
    }
    throw error;
  }
}
