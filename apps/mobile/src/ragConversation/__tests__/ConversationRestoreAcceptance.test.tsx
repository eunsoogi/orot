import { act, render, screen } from '@testing-library/react-native';
import { t } from '../../i18n';
import { ConversationScreen } from '../ConversationScreen';
import {
  ConversationSessionsProvider,
  useConversationSessions,
} from '../ConversationSessionsContext';
import type { ConversationSessions } from '../conversationSessions';
import type { RestoredTurn } from '../conversationRestoredTurn';

/** Presentation acceptance uses synthetic restored turns. SQLite predecessor
 * validity is covered separately by conversationPredecessorRestoreMatrix. */
test.each([
  ['same', 'stopped'],
  ['different', 'stopped'],
  ['same', 'successful'],
  ['different', 'successful'],
] as const)(
  '%s question after %s predecessor preserves both restored owners without dispatch',
  async (questionKind, predecessor) => {
    const question = 'Synthetic report request';
    const olderQuestion =
      questionKind === 'same' ? question : 'Synthetic earlier request';
    const oldAnswer =
      predecessor === 'stopped'
        ? 'Synthetic stopped partial answer'
        : 'Synthetic previous completed answer';
    const newAnswer = 'Synthetic latest completed answer';
    const turns: RestoredTurn[] = [
      {
        question: olderQuestion,
        answer: oldAnswer,
        citations: [],
        toolMessageId: 'older',
        completion: predecessor === 'stopped' ? 'partial' : 'complete',
        ...(predecessor === 'stopped'
          ? { interrupted: true, interruptionReason: 'user-stopped' as const }
          : {}),
      },
      {
        question,
        answer: newAnswer,
        citations: [],
        toolMessageId: 'latest',
        completion: 'complete',
      },
    ];
    let store!: ConversationSessions;
    let attached = false;
    const send = jest.fn(async () => ({
      status: 'answer' as const,
      answer: 'Unexpected dispatch',
      citations: [],
    }));
    const options = {
      retention: {
        attachExisting: async () => {
          attached = true;
        },
        activeIdentity: () => (attached ? 'saved' : null),
        activeLease: () => null,
        beginTurn: async () => undefined,
        invalidate: () => {},
      } as never,
      restoreSession: async () => turns,
    };
    function View() {
      store = useConversationSessions();
      return (
        <ConversationScreen
          onBack={jest.fn()}
          onOpenSource={jest.fn()}
          onSend={send}
        />
      );
    }
    const view = await render(
      <ConversationSessionsProvider options={options}>
        <View />
      </ConversationSessionsProvider>,
    );
    try {
      await act(() => store.attachExisting('saved', 0, '2026-11-18T00:00:00Z'));
      expect(screen.getByText(oldAnswer)).toBeTruthy();
      expect(screen.getByText(newAnswer)).toBeTruthy();
      expect(
        screen.queryAllByText(t('aiActivity.draft.incompleteHeading')),
      ).toHaveLength(predecessor === 'stopped' ? 1 : 0);
      expect(
        screen.queryAllByTestId('rag-conversation-incomplete-activity'),
      ).toHaveLength(predecessor === 'stopped' ? 1 : 0);
      expect(screen.getAllByText(question)).toHaveLength(
        questionKind === 'same' ? 2 : 1,
      );
      const session = store
        .getSnapshot()
        .sessions.find(item =>
          item.messages.some(message => message.toolMessageId === 'latest'),
        )!;
      expect(session.messages.map(message => message.content)).toEqual([
        olderQuestion,
        oldAnswer,
        question,
        newAnswer,
      ]);
      const assistants = session.messages.filter(
        message => message.role === 'assistant',
      );
      expect(assistants.map(message => message.toolMessageId)).toEqual([
        'older',
        'latest',
      ]);
      expect(Boolean(assistants[0]?.incomplete)).toBe(
        predecessor === 'stopped',
      );
      expect(assistants[0]?.interruptionReason).toBe(
        predecessor === 'stopped' ? 'user-stopped' : undefined,
      );
      expect(assistants[1]?.incomplete).not.toBe(true);
      expect(assistants[1]?.retainedTurnId).toBe('latest');
      const rendered = JSON.stringify(screen.toJSON());
      expect(rendered.indexOf(oldAnswer)).toBeLessThan(
        rendered.indexOf(newAnswer),
      );
      expect(session.busy).toBe(false);
      expect(session.pendingMessage).toBeNull();
      expect(send).not.toHaveBeenCalled();
    } finally {
      await view.unmount();
    }
  },
);
