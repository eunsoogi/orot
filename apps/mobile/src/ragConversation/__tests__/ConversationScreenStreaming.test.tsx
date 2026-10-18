import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { ConversationScreen } from '../ConversationScreen';
import type { RagConversationOutcome } from '../service';

const reference = {
  sourceKind: 'personal_record' as const,
  sourceId: 'record-1',
  sourceRevision: '1',
  evidenceId: 'evidence-1',
  evidenceRevision: '1',
  locator: { kind: 'structured_record', recordId: 'record-1' },
  effectiveTime: null,
  reviewState: 'reviewed' as const,
};

test('shows safe answer text and separate evidence activity while generating', async () => {
  let finish!: (value: RagConversationOutcome) => void;
  let observer:
    | Parameters<
        NonNullable<React.ComponentProps<typeof ConversationScreen>['onSend']>
      >[3]
    | undefined;
  await render(
    <ConversationScreen
      onBack={jest.fn()}
      onOpenSource={jest.fn()}
      onSend={(_question, _history, _signal, currentObserver) => {
        observer = currentObserver;
        return new Promise(resolve => {
          finish = resolve;
        });
      }}
    />,
  );
  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    '혈압 기록은?',
  );
  await fireEvent.press(screen.getByTestId('rag-conversation-send'));

  await act(async () => {
    observer?.onProgress?.({
      type: 'evidence_search',
      status: 'started',
      sourceKind: 'personal_record',
    });
  });
  expect(screen.getByTestId('rag-conversation-progress').props.children).toBe(
    '기록에서 근거를 찾고 있어요.',
  );
  await act(async () => {
    observer?.onTaskStreamEvent?.({ type: 'started' });
    observer?.onTaskStreamEvent?.({
      type: 'text_delta',
      text: '기록에는 혈압이 남아 있어요.',
    });
  });
  expect(screen.getByTestId('rag-conversation-stream').props.children).toBe(
    '기록에는 혈압이 남아 있어요.',
  );
  expect(screen.queryByText(/citations|evidenceId|"value"/i)).toBeNull();

  finish({
    status: 'answer',
    answer: '기록에는 혈압이 남아 있어요.',
    citations: [reference],
  });
  expect(await screen.findByLabelText(/원문 근거 열기/)).toBeTruthy();
  await waitFor(() =>
    expect(screen.queryByTestId('rag-conversation-stream')).toBeNull(),
  );
});

test.each(['cancel', 'failure'] as const)(
  'retains %s partial output through the next turn without sending it as validated history',
  async terminal => {
    let observer: Parameters<
      React.ComponentProps<typeof ConversationScreen>['onSend']
    >[3];
    let reject!: (error: Error) => void;
    const onSend = jest
      .fn<
        ReturnType<React.ComponentProps<typeof ConversationScreen>['onSend']>,
        Parameters<React.ComponentProps<typeof ConversationScreen>['onSend']>
      >()
      .mockImplementationOnce(
        (_question, _history, _signal, currentObserver) => {
          observer = currentObserver;
          return new Promise((_resolve, rejectPromise) => {
            reject = rejectPromise;
          });
        },
      )
      .mockResolvedValue({
        status: 'answer',
        answer: '다음 완료 답변',
        citations: [],
      });
    await render(
      <ConversationScreen
        onBack={jest.fn()}
        onOpenSource={jest.fn()}
        onSend={onSend}
      />,
    );
    await fireEvent.changeText(
      screen.getByTestId('rag-conversation-input'),
      '첫 질문',
    );
    await fireEvent.press(screen.getByTestId('rag-conversation-send'));
    await act(async () => {
      observer?.onTaskStreamEvent?.({
        type: 'text_delta',
        text: '보존할 부분 답변',
      });
    });
    if (terminal === 'cancel') {
      await fireEvent.press(screen.getByTestId('rag-conversation-cancel'));
    } else {
      await act(async () => {
        reject(new Error('provider failed'));
      });
    }
    expect(await screen.findByText('보존할 부분 답변')).toBeTruthy();
    expect(screen.getByText('완료되지 않은 응답 초안')).toBeTruthy();
    await act(async () => {
      observer?.onTaskStreamEvent?.({ type: 'text_delta', text: '늦은 응답' });
    });
    await fireEvent.changeText(
      screen.getByTestId('rag-conversation-input'),
      '다음 질문',
    );
    await fireEvent.press(screen.getByTestId('rag-conversation-send'));
    expect(await screen.findByText('다음 완료 답변')).toBeTruthy();
    expect(screen.getByText('보존할 부분 답변')).toBeTruthy();
    expect(screen.queryByText(/늦은 응답/)).toBeNull();
    expect(onSend.mock.calls[1][1]).toEqual([
      { role: 'user', content: '첫 질문' },
    ]);
  },
);

test('shows cancellation even when no response text has arrived', async () => {
  await render(
    <ConversationScreen
      onBack={jest.fn()}
      onOpenSource={jest.fn()}
      onSend={() => new Promise(() => {})}
    />,
  );
  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    '질문',
  );
  await fireEvent.press(screen.getByTestId('rag-conversation-send'));
  await fireEvent.press(screen.getByTestId('rag-conversation-cancel'));
  expect(screen.getByText('답변 생성을 중지했어요.')).toBeTruthy();
  expect(screen.queryByText('완료되지 않은 응답 초안')).toBeNull();
});
