import { observeConversationHistory } from '../../providers/conversationHistoryDiagnostic';
import type { createConversationArtifactDiscovery } from './conversationArtifactDiscovery';
import type { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';

type Discovery = Pick<
  ReturnType<typeof createConversationArtifactDiscovery>,
  'revalidateSession'
>;
type Storage = Pick<
  ReturnType<typeof createConversationArtifactStorage>,
  'readToolTurnsSnapshot'
>;

/** Observe original awaits with live owner-method lookup; retain no results or validity. */
export function createHistoryFenceDiagnostics(
  discovery: Discovery,
  storage: Storage,
  sessionArgs: Parameters<Discovery['revalidateSession']>,
  toolArgs: () => Parameters<Storage['readToolTurnsSnapshot']>,
) {
  const signal = sessionArgs[3];
  const session = (
    stage:
      | 'history_session_recheck_before_assembly'
      | 'history_session_recheck_after_assembly',
  ) =>
    observeConversationHistory(
      stage,
      () => discovery.revalidateSession(...sessionArgs),
      signal,
    );
  const tools = (
    stage:
      'history_tool_recheck_before_assembly' | 'history_tool_recheck_final',
  ) =>
    observeConversationHistory(
      stage,
      () => storage.readToolTurnsSnapshot(...toolArgs()),
      signal,
    );
  return {
    sessionBefore: () => session('history_session_recheck_before_assembly'),
    sessionAfter: () => session('history_session_recheck_after_assembly'),
    toolsBefore: () => tools('history_tool_recheck_before_assembly'),
    toolsFinal: () => tools('history_tool_recheck_final'),
  };
}
