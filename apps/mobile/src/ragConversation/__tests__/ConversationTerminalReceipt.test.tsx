import { act, render, screen, waitFor } from '@testing-library/react-native';
import { useSyncExternalStore } from 'react';
import { conversationIntentRequests } from '../../aiFeatures/integration/conversationIntent';
import { ConversationHistory } from '../ConversationHistory';
import { conversationFinalization } from '../conversationFinalizationDiagnostics';
import {
  createConversationSessions,
  type ConversationSender,
} from '../conversationSessions';

function gate() {
  let release!: () => void;
  const wait = new Promise<void>(resolve => {
    release = resolve;
  });
  return { wait, release };
}

test.each(['daily-shortcut', 'typed', 'typed-provider-receipt'] as const)(
  'settles only the finished outgoing receipt in the visible terminal snapshot: %s',
  async mode => {
    const sessions = createConversationSessions();
    const response = gate();
    const cleanup = gate();
    const original = conversationFinalization.presentation;
    const finalization = jest
      .spyOn(conversationFinalization, 'presentation')
      .mockImplementationOnce(async (...args) => {
        await cleanup.wait;
        return original(...args);
      });

    function History() {
      const { sessions: list } = useSyncExternalStore(
        sessions.subscribe,
        sessions.getSnapshot,
      );
      const session = list[0];
      return (
        <ConversationHistory
          messages={session.messages}
          pendingMessage={session.pendingMessage}
          requestSessionId={session.id}
          requestActivity={session.requestActivity}
          error=""
          onOpenSource={() => {}}
          onLinkError={() => {}}
        />
      );
    }
    const prompt =
      mode === 'daily-shortcut'
        ? conversationIntentRequests['daily-report']
        : 'Synthetic typed input';
    const readAt = () =>
      sessions.getSnapshot().sessions[0].messages.find(m => m.role === 'user')
        ?.delivery?.readAt;
    const receipt = () => screen.getByTestId('conversation-message-receipt');
    const sender: ConversationSender = async (
      _q,
      _history,
      _signal,
      observer,
    ) => {
      observer?.onTaskStreamEvent?.({ type: 'started' });
      await response.wait;
      if (mode === 'typed-provider-receipt')
        observer?.onProviderReceipt?.('response_started');
      return {
        status: 'answer',
        answer: 'Synthetic full answer',
        citations: [],
      };
    };
    let pending: Promise<unknown> | undefined;
    const view = await render(<History />);
    try {
      await act(() => {
        if (mode === 'daily-shortcut')
          pending = sessions.sendQuickPrompt(1, prompt, sender);
        else {
          sessions.setDraft(1, prompt);
          pending = sessions.send(1, sender);
        }
      });
      await waitFor(() => expect(receipt()).toHaveTextContent(/전송 중/));
      expect(readAt()).toBeUndefined();
      expect(screen.queryByText('Synthetic full answer')).toBeNull();
      await act(() => response.release());
      await screen.findByText('Synthetic full answer');
      expect(finalization).toHaveBeenCalledTimes(1);
      expect(sessions.getSnapshot().sessions[0].busy).toBe(true);
      expect(receipt()).not.toHaveTextContent(/전송 중/);
      if (mode === 'typed-provider-receipt') {
        expect(receipt()).toHaveTextContent(/읽음/);
        expect(readAt()).toBeDefined();
      } else {
        expect(receipt()).not.toHaveTextContent(/읽음/);
        expect(readAt()).toBeUndefined();
      }
    } finally {
      await act(async () => {
        response.release();
        cleanup.release();
        await pending;
      });
      await view.unmount();
      sessions.dispose();
      finalization.mockRestore();
    }
  },
);
