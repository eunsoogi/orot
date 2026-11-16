import { providerDiagnostic } from '../../providers/diagnostics';

type HistoryFailureCode =
  | 'history_discovery_unavailable'
  | 'history_page_unavailable'
  | 'history_turn_unavailable'
  | 'history_session_changed'
  | 'history_sources_stale'
  | 'history_cancelled';

/** Closed local failure categories preserve the failed boundary without source identifiers. */
export class ConversationHistoryFailure extends Error {
  constructor(readonly code: HistoryFailureCode) {
    super(
      code === 'history_discovery_unavailable' ||
        code === 'history_page_unavailable'
        ? 'Conversation history is unavailable.'
        : 'Conversation history changed or was not saved.',
    );
    this.name = 'ConversationHistoryFailure';
  }
}

/** Never log arbitrary exception messages or data; unknown storage failures remain unknown. */
export function reportConversationPreparationFailure(error: unknown) {
  try {
    providerDiagnostic(
      'rag',
      'history_preparation',
      error instanceof ConversationHistoryFailure
        ? error.code
        : 'preparation_other',
    );
  } catch {
    // Optional opt-in diagnostics cannot replace or suppress the original failure.
  }
}
