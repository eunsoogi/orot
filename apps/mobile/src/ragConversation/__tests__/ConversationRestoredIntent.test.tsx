import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { ConversationScreen } from '../ConversationScreen';
import {
  ConversationSessionsProvider,
  useConversationSessions,
} from '../ConversationSessionsContext';
import type { ConversationSessions } from '../conversationSessions';
import { AppButton } from '../../layout/AppButton';
import { t } from '../../i18n';

test('a report task remains with its original session when history changes selection', async () => {
  let store!: ConversationSessions;
  function Capture() {
    store = useConversationSessions();
    return (
      <ConversationScreen
        navigationRouteKey="report-route"
        onBack={jest.fn()}
        onOpenSource={jest.fn()}
        onSend={jest.fn()}
        renderReportTask={() => (
          <AppButton title="Report task" onPress={jest.fn()} />
        )}
        renderStoredReportTask={card => (
          <AppButton title={`Stored task ${card.id}`} onPress={jest.fn()} />
        )}
      />
    );
  }
  await render(
    <ConversationSessionsProvider>
      <Capture />
    </ConversationSessionsProvider>,
  );
  expect(screen.getByRole('button', { name: 'Report task' })).toBeTruthy();
  await act(() => store.create());
  expect(screen.queryByRole('button', { name: 'Report task' })).toBeNull();
  await fireEvent.press(screen.getByTestId('daily-report-request'));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Stored task daily-report' }),
    ).toBeTruthy(),
  );
  expect(
    store.getSnapshot().sessions.find(session => session.id === 2)?.taskCards,
  ).toHaveLength(1);
  expect(
    store.getSnapshot().sessions.find(session => session.id === 1)?.taskCards,
  ).toBeUndefined();
  await act(() => store.select(1));
  expect(screen.getByRole('button', { name: 'Report task' })).toBeTruthy();
  expect(
    screen.queryByRole('button', { name: 'Stored task daily-report' }),
  ).toBeNull();
});

test('selecting a report attaches its revision without sending', async () => {
  const report = {
    identity: {
      kind: 'daily_report' as const,
      localDate: '2026-11-10',
      timeZone: 'Asia/Seoul',
      key: 'daily-report:2026-11-10@Asia/Seoul',
    },
    runId: 'synthetic-run',
    revision: 2,
  };
  const send = jest.fn(async () => ({ status: 'no_evidence' as const }));
  await render(
    <ConversationScreen
      entryContext={{ intent: 'conversation', entryKey: 'report-task' }}
      onBack={jest.fn()}
      onOpenSource={jest.fn()}
      onSend={send}
      renderReportTask={onChat => (
        <AppButton title="Continue report" onPress={() => onChat(report)} />
      )}
    />,
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Continue report' }),
  );
  expect(send).not.toHaveBeenCalled();
  expect(
    screen.queryByRole('button', { name: t('treatmentSafety.open') }),
  ).toBeNull();
  expect(screen.getByTestId('rag-conversation-input')).toHaveProp('value', '');
  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    '이어서',
  );
  await fireEvent.press(screen.getByTestId('rag-conversation-send'));
  expect(send).toHaveBeenCalledWith(
    '이어서',
    [],
    expect.any(AbortSignal),
    expect.any(Object),
    expect.objectContaining({ dailyReport: report }),
  );
});

test('continues a restored possibilities conversation after a plain route entry', async () => {
  let store!: ConversationSessions;
  let attached = false;
  const retention = {
    attachExisting: async () => {
      attached = true;
    },
    activeIdentity: () => (attached ? 'saved' : null),
    activeLease: () => null,
    beginTurn: async () => undefined,
    invalidate: () => {},
  };
  const options = {
    retention: retention as never,
    restoreSession: async () => [
      {
        question: '피로가 있어요',
        answer: '언제부터 시작됐나요?',
        citations: [],
        entryIntent: 'possibilities' as const,
      },
    ],
  };
  const send = jest.fn(async () => ({
    status: 'answer' as const,
    answer: '확인이 필요해요.',
    citations: [],
  }));
  function Capture() {
    store = useConversationSessions();
    return (
      <ConversationScreen
        entryContext={{ intent: 'conversation', entryKey: 'plain' }}
        onBack={jest.fn()}
        onOpenSource={jest.fn()}
        onSend={send}
      />
    );
  }
  await render(
    <ConversationSessionsProvider options={options}>
      <Capture />
    </ConversationSessionsProvider>,
  );
  await act(async () => {
    await store.attachExisting('saved', 0, '2026-10-05T00:00:00.000Z');
  });
  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    '지난주부터예요',
  );
  await fireEvent.press(screen.getByTestId('rag-conversation-send'));
  expect(send).toHaveBeenCalledWith(
    '지난주부터예요',
    expect.any(Array),
    expect.any(AbortSignal),
    expect.any(Object),
    expect.objectContaining({ intent: 'possibilities' }),
  );
});

test.each([false, true])(
  'continues a restored report conversation (possibilities: %s)',
  async possibilities => {
    const report = {
      identity: {
        kind: 'daily_report' as const,
        localDate: '2026-11-10',
        timeZone: 'Asia/Seoul',
        key: 'daily-report:2026-11-10@Asia/Seoul',
      },
      runId: 'run',
      revision: 1,
    };
    let store!: ConversationSessions;
    const options = {
      retention: {
        attachExisting: async () => {},
        activeIdentity: () => 'saved',
        activeLease: () => null,
        beginTurn: async () => undefined,
        invalidate: () => {},
      } as never,
      restoreSession: async () => [
        {
          question: '보고서',
          answer: '답변',
          citations: [],
          dailyReport: report,
          ...(possibilities ? { entryIntent: 'possibilities' as const } : {}),
        },
      ],
    };
    const send = jest.fn(async () => ({
      status: 'failure' as const,
      kind: 'retrieval_failed' as const,
    }));
    function Capture() {
      store = useConversationSessions();
      return (
        <ConversationScreen
          entryContext={{ intent: 'conversation', entryKey: 'plain' }}
          onBack={jest.fn()}
          onOpenSource={jest.fn()}
          onSend={send}
        />
      );
    }
    await render(
      <ConversationSessionsProvider options={options}>
        <Capture />
      </ConversationSessionsProvider>,
    );
    await act(async () => {
      await store.attachExisting('saved', 0, '2026-10-05T00:00:00.000Z');
    });
    expect(
      screen.getAllByText(/선택한 보고서: 2026-11-10 · Asia\/Seoul/).length,
    ).toBeGreaterThan(0);
    await fireEvent.changeText(
      screen.getByTestId('rag-conversation-input'),
      '이어서',
    );
    await fireEvent.press(screen.getByTestId('rag-conversation-send'));
    expect(send).toHaveBeenCalledWith(
      '이어서',
      expect.any(Array),
      expect.any(AbortSignal),
      expect.any(Object),
      expect.objectContaining({
        dailyReport: report,
        intent: possibilities ? 'possibilities' : 'conversation',
      }),
    );
  },
);
