import { act, render } from '@testing-library/react-native';
import { t } from '../../i18n';
import { createConversationSessions } from '../conversationSessions';
import { getRagConversationFailureCopy } from '../copy';
import type { ConversationSender } from '../conversationSessionTypes';
import { Transcript } from '../testSupport/savedHistoryDisplayFixture';

test.each(['validation_failed', 'provider_refused'] as const)(
  'keeps an approved opening without treating a terminal %s as interrupted model work',
  async kind => {
    const store = createConversationSessions();
    const id = store.getSnapshot().activeId;
    const question = 'Synthetic typed request';
    const approvedOpening = '함께 내용을 살펴볼게요.';
    const unreviewedDraft = 'Synthetic unapproved response projection';
    const sender = jest.fn<
      ReturnType<ConversationSender>,
      Parameters<ConversationSender>
    >(async (_question, _history, _signal, observer) => {
      observer?.onTaskStreamEvent?.({
        type: 'initial_response',
        callId: 'reviewed-synthetic-opening',
        text: approvedOpening,
      });
      observer?.onTaskStreamEvent?.({
        type: 'text_delta',
        text: unreviewedDraft,
      });
      observer?.onTaskStreamEvent?.({ type: 'steering_applied' });
      observer?.onTaskStreamEvent?.({
        type: 'text_delta',
        text: 'Synthetic unapproved revised projection',
      });
      // A test at the session boundary: a typed terminal result, not a native
      // expiry, Stop, or an inference about what actually happened on device.
      return { status: 'failure', kind };
    });
    const view = await render(<Transcript store={store} />);
    try {
      await act(async () => {
        store.setDraft(id, question);
        await store.send(id, sender);
      });
      expect(view.getByText(approvedOpening)).toBeTruthy();
      expect(
        view.getAllByText(getRagConversationFailureCopy(kind)),
      ).toHaveLength(1);
      expect(
        view.queryByText(t('aiActivity.draft.incompleteHeading')),
      ).toBeNull();
      expect(view.queryByText(unreviewedDraft)).toBeNull();
      expect(
        view.queryByText('Synthetic unapproved revised projection'),
      ).toBeNull();
      const session = store.getSnapshot().sessions.find(row => row.id === id)!;
      expect(session.draft).toBe(question);
      expect(session.messages.find(row => row.role === 'user')?.failed).toBe(
        true,
      );
      expect(sender).toHaveBeenCalledTimes(1);
      const retry = jest.fn<
        ReturnType<ConversationSender>,
        Parameters<ConversationSender>
      >(async () => ({
        status: 'answer',
        answer: 'Synthetic validated response',
        citations: [],
      }));
      await act(async () => {
        await store.send(id, retry);
      });
      expect(retry.mock.calls[0]?.slice(0, 2)).toEqual([question, []]);
    } finally {
      await view.unmount();
      store.dispose();
    }
  },
);
