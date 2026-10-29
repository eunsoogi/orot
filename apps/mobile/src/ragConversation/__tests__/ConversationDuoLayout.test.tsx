import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';
import { ConversationScreen } from '../ConversationScreen';
import type { RagConversationOutcome } from '../service';

const originalWindow = Dimensions.get('window');
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

beforeEach(() =>
  Dimensions.set({
    window: { ...originalWindow, width: 390, height: 844, fontScale: 1 },
  }),
);
afterEach(() => Dimensions.set({ window: originalWindow }));

function panelAxis(): string | undefined {
  return StyleSheet.flatten(
    screen.getByTestId('rag-conversation-columns').props.style,
  )?.flexDirection;
}

test('keeps the request, draft, and exact citations through adaptive reflow', async () => {
  let finish!: (outcome: RagConversationOutcome) => void;
  let requestSignal: AbortSignal | undefined;
  const onSend = jest.fn<
    ReturnType<React.ComponentProps<typeof ConversationScreen>['onSend']>,
    Parameters<React.ComponentProps<typeof ConversationScreen>['onSend']>
  >();
  onSend.mockImplementation((_question, _history, signal) => {
    requestSignal = signal;
    return new Promise(resolve => {
      finish = resolve;
    });
  });
  const onOpenSource = jest.fn();

  await render(
    <ConversationScreen
      navigationRouteKey="rag-conversation"
      onBack={jest.fn()}
      onOpenSource={onOpenSource}
      onSend={onSend}
    />,
  );

  expect(panelAxis()).toBe('column');
  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    '첫 질문',
  );
  await fireEvent.press(screen.getByTestId('rag-conversation-send'));
  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    '다음 질문 초안',
  );
  expect(screen.getByTestId('rag-conversation-progress')).toBeTruthy();

  await act(async () => {
    Dimensions.set({
      window: { ...originalWindow, width: 1400, height: 900, fontScale: 1 },
    });
  });
  await waitFor(() => expect(panelAxis()).toBe('column'));
  expect(screen.getByTestId('rag-conversation-input').props.value).toBe(
    '다음 질문 초안',
  );
  expect(requestSignal?.aborted).toBe(false);
  expect(onSend).toHaveBeenCalledTimes(1);

  await act(async () => {
    Dimensions.set({
      window: { ...originalWindow, width: 320, height: 720, fontScale: 1.2 },
    });
  });
  await waitFor(() => expect(panelAxis()).toBe('column'));
  expect(screen.getByTestId('rag-conversation-input').props.value).toBe(
    '다음 질문 초안',
  );
  expect(screen.getByTestId('rag-conversation-progress')).toBeTruthy();
  expect(requestSignal?.aborted).toBe(false);
  expect(onSend).toHaveBeenCalledTimes(1);

  await act(async () => {
    finish({
      status: 'answer',
      answer: '저장된 기록에서 확인한 답변이에요.',
      citations: [reference],
    });
  });
  expect(
    await screen.findByText('저장된 기록에서 확인한 답변이에요.'),
  ).toBeTruthy();

  const evidencePanel = screen.getByTestId('rag-conversation-evidence-panel');
  expect(
    within(screen.getByTestId('rag-conversation-history')).getByLabelText(
      /원문 근거 열기/,
    ),
  ).toBeTruthy();
  await fireEvent.press(within(evidencePanel).getByLabelText(/원문 근거 열기/));
  expect(onOpenSource).toHaveBeenCalledTimes(1);
  expect(onOpenSource).toHaveBeenCalledWith(reference);
  expect(screen.getByTestId('rag-conversation-input').props.value).toBe(
    '다음 질문 초안',
  );
  expect(onSend.mock.calls[0]?.[1]).toEqual([]);
});
