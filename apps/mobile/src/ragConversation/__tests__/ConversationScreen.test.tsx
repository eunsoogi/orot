import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';
import { appColors } from '../../layout/appColors';
import { ConversationScreen } from '../ConversationScreen';
import { getRagConversationCopy } from '../copy';
import type { RagConversationOutcome } from '../service';

const originalDimensions = Dimensions.get('window');
// Compact baseline assertions explicitly use the standard Dynamic Type size.
beforeEach(() =>
  Dimensions.set({ window: { ...originalDimensions, fontScale: 1 } }),
);
afterEach(() => Dimensions.set({ window: originalDimensions }));

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

test('keeps short input compact and scrolls long drafts within a bounded height', async () => {
  await render(
    <ConversationScreen
      onBack={jest.fn()}
      onOpenSource={jest.fn()}
      onSend={jest.fn()}
    />,
  );
  const input = screen.getByTestId('rag-conversation-input');
  expect(StyleSheet.flatten(input.props.style)).toMatchObject({
    minHeight: 44,
    maxHeight: 96,
  });
  expect(input.props.scrollEnabled).toBe(false);
  await fireEvent(input, 'contentSizeChange', {
    nativeEvent: { contentSize: { height: 300 } },
  });
  expect(screen.getByTestId('rag-conversation-input').props.scrollEnabled).toBe(
    true,
  );
  await fireEvent(input, 'contentSizeChange', {
    nativeEvent: { contentSize: { height: 32 } },
  });
  expect(StyleSheet.flatten(input.props.style)).toMatchObject({
    minHeight: 44,
    maxHeight: 96,
  });
  expect(screen.getByTestId('rag-conversation-input').props.scrollEnabled).toBe(
    false,
  );
});

test('cancel releases the composer and discards a late answer', async () => {
  let finish!: (value: RagConversationOutcome) => void;
  let signal: AbortSignal | undefined;
  await render(
    <ConversationScreen
      onBack={jest.fn()}
      onOpenSource={jest.fn()}
      onSend={(_question, _history, currentSignal) => {
        signal = currentSignal;
        return new Promise(resolve => {
          finish = resolve;
        });
      }}
    />,
  );
  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    '질문',
  );
  await fireEvent.press(screen.getByTestId('rag-conversation-send'));
  await fireEvent.press(screen.getByTestId('rag-conversation-cancel'));
  expect(signal?.aborted).toBe(true);
  expect(screen.getByTestId('rag-conversation-input').props.editable).toBe(
    true,
  );
  finish({ status: 'answer', answer: '늦은 답변', citations: [reference] });
  await waitFor(() => expect(screen.queryByText('늦은 답변')).toBeNull());
});

test('keeps the composer editable while a response is pending', async () => {
  let finish!: (value: RagConversationOutcome) => void;
  await render(
    <ConversationScreen
      onBack={jest.fn()}
      onOpenSource={jest.fn()}
      onSend={() =>
        new Promise(resolve => {
          finish = resolve;
        })
      }
    />,
  );
  const input = screen.getByTestId('rag-conversation-input');
  await fireEvent.changeText(input, '첫 질문');
  await fireEvent.press(screen.getByTestId('rag-conversation-send'));

  expect(screen.getByTestId('rag-conversation-input').props.editable).toBe(
    true,
  );
  await fireEvent.changeText(input, '다음 질문');
  expect(input.props.value).toBe('다음 질문');

  finish({ status: 'answer', answer: '첫 답변', citations: [reference] });
  expect(await screen.findByText('첫 답변')).toBeTruthy();
  expect(screen.getByTestId('rag-conversation-input').props.value).toBe(
    '다음 질문',
  );
});

test('renders a grounded answer with a source action and reports absent evidence', async () => {
  const outcomes: RagConversationOutcome[] = [
    {
      status: 'answer',
      answer: '저장된 기록을 찾았어요.',
      citations: [reference],
    },
    { status: 'no_evidence' },
  ];
  const onSend = jest.fn(async () => outcomes.shift()!);
  const onOpenSource = jest.fn();
  await render(
    <ConversationScreen
      onBack={jest.fn()}
      onSend={onSend}
      onOpenSource={onOpenSource}
    />,
  );
  const description = screen.getByText(getRagConversationCopy().description);
  const conversationInput = screen.getByTestId('rag-conversation-input');
  expect(StyleSheet.flatten(description.props.style).color).toBe(
    appColors.text,
  );
  expect(conversationInput.props.placeholderTextColor).toBe(
    appColors.secondary,
  );
  expect(StyleSheet.flatten(conversationInput.props.style)).toMatchObject({
    backgroundColor: 'transparent',
    color: appColors.text,
  });

  await fireEvent(conversationInput, 'focus');
  expect(
    StyleSheet.flatten(
      screen.getByTestId('rag-conversation-composer-field').props.style,
    ),
  ).toMatchObject({
    borderWidth: 0,
  });
  await fireEvent(conversationInput, 'blur');
  expect(
    StyleSheet.flatten(
      screen.getByTestId('rag-conversation-composer-field').props.style,
    ),
  ).toMatchObject({
    borderWidth: 0,
  });
  await fireEvent.changeText(conversationInput, '혈압 기록을 보여줘');
  await fireEvent.press(screen.getByTestId('rag-conversation-send'));
  expect(await screen.findByText('저장된 기록을 찾았어요.')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText(/원문 근거 열기/));
  expect(onOpenSource).toHaveBeenCalledWith(reference);

  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    '기록이 없는 질문',
  );
  await fireEvent.press(screen.getByTestId('rag-conversation-send'));
  expect(
    await screen.findByText('이 질문에 답할 만한 저장된 근거를 찾지 못했어요.'),
  ).toBeTruthy();
  expect(onSend).toHaveBeenLastCalledWith(
    '기록이 없는 질문',
    [
      { role: 'user', content: '혈압 기록을 보여줘' },
      { role: 'assistant', content: '저장된 기록을 찾았어요.' },
    ],
    expect.any(AbortSignal),
    expect.objectContaining({
      onProgress: expect.any(Function),
      onTaskStreamEvent: expect.any(Function),
    }),
  );
});

test('shows loading and a recoverable response failure', async () => {
  let resolve!: (value: RagConversationOutcome) => void;
  const onSend = jest.fn(
    () =>
      new Promise<RagConversationOutcome>(done => {
        resolve = done;
      }),
  );
  await render(
    <ConversationScreen
      onBack={jest.fn()}
      onSend={onSend}
      onOpenSource={jest.fn()}
    />,
  );
  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    '질문',
  );
  await fireEvent.press(screen.getByTestId('rag-conversation-send'));
  expect(screen.getByTestId('rag-conversation-progress').props.children).toBe(
    getRagConversationCopy().loading,
  );
  // The bridge configures UIKit's button; the material host is not a second accessible action.
  expect(screen.getByTestId('rag-conversation-cancel').props).toMatchObject({
    busy: true,
    disabled: false,
    accessible: false,
    actionLabel: getRagConversationCopy().cancel,
  });
  resolve({ status: 'unavailable' });
  expect(await screen.findByText(/답변을 만들지 못했어요/)).toBeTruthy();
});
