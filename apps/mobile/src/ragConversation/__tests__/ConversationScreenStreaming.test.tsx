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
