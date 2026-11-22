import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { createDailyReportIdentity } from '@orot/domain';
import { ConversationScreen } from '../ConversationScreen';
import {
  ConversationSessionsProvider,
  useConversationSessions,
} from '../ConversationSessionsContext';
import { startConversationReportTurn } from '../startConversationReportTurn';
import type { ConversationScreenProps } from '../ConversationScreenProps';

const mockOptions = Intl.DateTimeFormat.prototype.resolvedOptions;

function localMidnight() {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2035-01-01T15:00:00.100Z'));
  jest
    .spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')
    .mockImplementation(function (this: Intl.DateTimeFormat) {
      return { ...mockOptions.call(this), timeZone: 'Asia/Seoul' };
    });
}

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

async function mount(
  sender: ConversationScreenProps['onSend'],
  isEntryCurrent?: () => boolean,
) {
  function Capture() {
    const store = useConversationSessions();
    return (
      <ConversationScreen
        onBack={jest.fn()}
        onOpenSource={jest.fn()}
        onSend={sender}
        isEntryCurrent={isEntryCurrent}
        onOpenDailyReport={() =>
          startConversationReportTurn(store, () => true, sender)
        }
      />
    );
  }
  await render(
    <ConversationSessionsProvider>
      <Capture />
    </ConversationSessionsProvider>,
  );
}

async function typeAndSend(value: string) {
  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    value,
  );
  await fireEvent.press(screen.getByTestId('rag-conversation-send'));
}

test('bare typed Daily Report starts one report on the local day, without a second button', async () => {
  localMidnight();
  const sender = jest.fn(
    async (..._args: Parameters<ConversationScreenProps['onSend']>) => ({
      status: 'answer' as const,
      answer: 'Synthetic report ready',
      citations: [],
    }),
  );
  await mount(sender);
  await typeAndSend('일일 보고서');
  await waitFor(() =>
    expect(screen.getByText('Synthetic report ready')).toBeTruthy(),
  );
  expect(sender).toHaveBeenCalledTimes(1);
  const [question, , , observer, context] = sender.mock.calls[0];
  expect(question).toBe('일일 보고서');
  expect(observer?.inputOrigin).toBe('composer');
  expect(context).toMatchObject({
    intent: 'daily-report',
    reportRequest: createDailyReportIdentity('2035-01-02', 'Asia/Seoul'),
  });
  expect(context?.directDailyReportRequest).toBeUndefined();
  expect(screen.queryByText('오늘 선택하기')).toBeNull();

  await typeAndSend('어제 일일 보고서를 설명해 줘');
  await waitFor(() => expect(sender).toHaveBeenCalledTimes(2));
  expect(sender.mock.calls[1][4]?.reportRequest).toBeUndefined();
});

test('a later typed request after a successful shortcut uses the new local day', async () => {
  localMidnight();
  const sender = jest.fn(
    async (..._args: Parameters<ConversationScreenProps['onSend']>) => ({
      status: 'answer' as const,
      answer: 'Synthetic daily answer',
      citations: [],
    }),
  );
  await mount(sender);
  await fireEvent.press(screen.getByTestId('daily-report-request'));
  await waitFor(() =>
    expect(screen.getByText('Synthetic daily answer')).toBeTruthy(),
  );
  expect(sender.mock.calls[0][4]?.reportRequest?.localDate).toBe('2035-01-02');
  jest.setSystemTime(new Date('2035-01-02T15:00:00.100Z'));
  await typeAndSend('일일 보고서');
  await waitFor(() => expect(sender).toHaveBeenCalledTimes(2));
  expect(sender.mock.calls[1][4]?.reportRequest?.localDate).toBe('2035-01-03');
  expect(screen.queryByText('오늘 선택하기')).toBeNull();
});

test('stopping the typed Daily Report never publishes a late answer or sends again', async () => {
  localMidnight();
  let finish!: (
    value: Awaited<ReturnType<ConversationScreenProps['onSend']>>,
  ) => void;
  const sender = jest.fn(
    (..._args: Parameters<ConversationScreenProps['onSend']>) =>
      new Promise<Awaited<ReturnType<ConversationScreenProps['onSend']>>>(
        resolve => {
          finish = resolve;
        },
      ),
  );
  await mount(sender);
  await typeAndSend('일일 보고서');
  await waitFor(() => expect(sender).toHaveBeenCalledTimes(1));
  await fireEvent.press(screen.getByTestId('rag-conversation-cancel'));
  expect(sender.mock.calls[0][2]?.aborted).toBe(true);
  await act(() =>
    finish({
      status: 'answer',
      answer: 'Synthetic late report',
      citations: [],
    }),
  );
  expect(screen.queryByText('Synthetic late report')).toBeNull();
  expect(sender).toHaveBeenCalledTimes(1);
});

test('a stale composer callback cannot start a typed report', async () => {
  localMidnight();
  const send = jest.fn();
  let active = true;
  await mount(send, () => active);
  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    '일일 보고서',
  );
  active = false;
  await fireEvent.press(screen.getByTestId('rag-conversation-send'));
  expect(send).not.toHaveBeenCalled();
});
