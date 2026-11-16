import { render } from '@testing-library/react-native';
import { createDailyReportIdentity } from '@orot/domain';
import {
  ConversationTaskHeader,
  ConversationStoredTaskCards,
} from '../ConversationTaskPanels';
import { createConversationSessions } from '../conversationSessions';

const target = {
  identity: createDailyReportIdentity('2035-01-01', 'UTC')!,
  runId: 'synthetic',
  revision: 1,
};

test('a retained report answer suppresses duplicate header and legacy task renderers', async () => {
  const store = createConversationSessions();
  await store.sendPrompt(1, 'Synthetic report request', async () => ({
    status: 'answer',
    answer: 'Synthetic report answer',
    citations: [],
    dailyReport: target,
  }));
  const session = store.getSnapshot().sessions[0];
  expect(session.dailyReport).toEqual(target);
  const saved = jest.fn(() => null);
  const stored = jest.fn(() => null);
  await render(
    <>
      <ConversationTaskHeader
        store={store}
        session={session}
        onOpenSource={jest.fn()}
        selectedReport={target}
        reportOwner={null}
        renderSavedReport={saved}
      />
      <ConversationStoredTaskCards
        store={store}
        session={{
          ...session,
          taskCards: [
            {
              id: 'legacy',
              createdAt: '2035-01-01T12:00:00Z',
              revision: 1,
              task: {
                kind: 'daily_report',
                identity: target.identity,
                report: target,
              },
            },
          ],
        }}
        onOpenSource={jest.fn()}
        durableSessionId={null}
        renderStoredReportTask={stored}
      />
    </>,
  );
  expect(saved).not.toHaveBeenCalled();
  expect(stored).not.toHaveBeenCalled();
  store.dispose();
});
