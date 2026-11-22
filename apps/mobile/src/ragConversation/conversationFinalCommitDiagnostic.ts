import { useLayoutEffect } from 'react';
import { NativeModules } from 'react-native';
import { providerDiagnostic } from '../providers/diagnostics';
import type { DisplayMessage } from './conversationDisplayMessage';

/** React committed a live result body. This is not native paint, visibility, or save timing. */
export function useConversationFinalCommitDiagnostic(
  message: DisplayMessage,
  showBody: boolean,
) {
  const settled =
    showBody &&
    message.id > 0 &&
    message.role === 'assistant' &&
    !message.restoredHistory &&
    !message.savedHistoryDisplayOnly &&
    !message.voiceTimelineOrder &&
    !message.localClarification &&
    !message.streaming &&
    !message.incomplete &&
    message.citations !== undefined &&
    Boolean(message.content);
  useLayoutEffect(() => {
    if (!settled) return;
    try {
      if (NativeModules.OrotProviderDiagnostics?.enabled === true)
        providerDiagnostic(
          'rag',
          'conversation_final_react_commit',
          'completed',
        );
    } catch {
      // Diagnostics must not affect terminal output rendering.
    }
  }, [settled]);
}
