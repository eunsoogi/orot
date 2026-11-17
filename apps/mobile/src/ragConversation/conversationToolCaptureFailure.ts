import { providerDiagnostic } from '../providers/diagnostics';

export type ToolCaptureFailureDiagnostic =
  | 'tool_capture_alias'
  | 'tool_capture_research_shape'
  | 'tool_capture_photo_unsupported'
  | 'tool_capture_filtered_unavailable'
  | 'tool_parent_unavailable'
  | 'tool_capture_other';

const reasons = new Map<string, ToolCaptureFailureDiagnostic>([
  ['Tool source is unavailable.', 'tool_capture_alias'],
  ['Tool research source is unavailable.', 'tool_capture_research_shape'],
  ['Photo tool sources are unsupported.', 'tool_capture_photo_unsupported'],
  ['Filtered tool source is unavailable.', 'tool_capture_filtered_unavailable'],
]);

/** Inner source-read diagnostics do not cover the surrounding alias/filter guards.
 * Match only exact app-owned errors; neither their text nor the missing alias is emitted. */
export function reportToolCaptureFailure(error: unknown) {
  try {
    providerDiagnostic(
      'storage',
      'tool_event_capture',
      error instanceof Error
        ? (reasons.get(error.message) ?? 'tool_capture_other')
        : 'tool_capture_other',
    );
  } catch {
    // Observation cannot replace the original error or authorize an unbound source.
  }
}
