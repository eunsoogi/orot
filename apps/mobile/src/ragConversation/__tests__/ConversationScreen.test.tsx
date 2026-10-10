import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { appColors } from '../../layout/appColors';
import { ConversationScreen } from '../ConversationScreen';
import { getRagConversationCopy } from '../copy';
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
    backgroundColor: appColors.surface,
    color: appColors.text,
  });

  await fireEvent(conversationInput, 'focus');
  expect(StyleSheet.flatten(conversationInput.props.style)).toMatchObject({
    borderColor: appColors.primaryText,
    borderWidth: 2,
  });
  await fireEvent(conversationInput, 'blur');
  expect(StyleSheet.flatten(conversationInput.props.style)).toMatchObject({
    borderColor: appColors.secondary,
    borderWidth: 1,
  });
  await fireEvent.changeText(conversationInput, '혈압 기록을 보여줘');
  await fireEvent.press(screen.getByTestId('rag-conversation-send'));
  expect(await screen.findByText('저장된 기록을 찾았어요.')).toBeTruthy();
  await fireEvent.press(screen.getByText(/원문 근거 열기/));
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
  expect(screen.getByTestId('rag-conversation-loading')).toBeTruthy();
  expect(
    screen.getByTestId('rag-conversation-send').props.accessibilityState,
  ).toMatchObject({ busy: true, disabled: true });
  resolve({ status: 'unavailable' });
  expect(await screen.findByText(/답변을 만들지 못했어요/)).toBeTruthy();
});
