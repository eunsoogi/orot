import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { Button, View } from 'react-native';
import type { ReactNode } from 'react';
import { DiseaseHypothesesScreen } from '../../../diseaseHypotheses/DiseaseHypothesesScreen';
import { ConversationScreen } from '../../../ragConversation/ConversationScreen';
import { NextVisitQuestionsScreen } from '../../../nextVisitQuestions/NextVisitQuestionsScreen';
import { makeProps } from '../../../nextVisitQuestions/testSupport/fixtures';
import {
  NavigationPrimaryActionContext,
  useNavigationPrimaryActionHost,
} from '../../../navigation/useNavigationPrimaryAction';

/** Mirrors the production shell's action registration without mocking the screen hooks. */
function Shell({ children }: { readonly children: ReactNode }) {
  const { host, action } = useNavigationPrimaryActionHost('ai-request');
  return (
    <NavigationPrimaryActionContext.Provider value={host}>
      <View testID="content">{children}</View>
      <View testID="bottom-navigation">
        {action ? (
          <Button
            title={action.label}
            testID={action.testID}
            onPress={() => {
              void action.onPress();
            }}
          />
        ) : null}
      </View>
    </NavigationPrimaryActionContext.Provider>
  );
}

test('visit questions use the same bottom cancel label and abort the pending request', async () => {
  let signal: AbortSignal | undefined;
  const props = makeProps({
    onGenerate: (_appointment, _selection, current) => {
      signal = current;
      return new Promise(() => {});
    },
  });
  await render(
    <Shell>
      <NextVisitQuestionsScreen {...props} />
    </Shell>,
  );
  await fireEvent.press(screen.getByTestId('next-visit-generate'));
  expect(
    within(screen.getByTestId('content')).queryByTestId(
      'next-visit-generation-cancel',
    ),
  ).toBeNull();
  await fireEvent.press(
    within(screen.getByTestId('bottom-navigation')).getByText('요청 취소'),
  );
  expect(signal?.aborted).toBe(true);
  expect(screen.getByTestId('next-visit-generate')).toBeTruthy();
});

test('symptom analysis cancels from the bottom navigation without a duplicate body control', async () => {
  let signal: AbortSignal | undefined;
  await render(
    <Shell>
      <DiseaseHypothesesScreen
        navigationRouteKey="ai-request"
        onBack={jest.fn()}
        onOpenSource={jest.fn()}
        onGenerate={current => {
          signal = current;
          return new Promise(() => {});
        }}
      />
    </Shell>,
  );
  await fireEvent.press(screen.getByTestId('disease-hypotheses-generate'));
  expect(
    within(screen.getByTestId('content')).queryByTestId(
      'disease-hypotheses-cancel',
    ),
  ).toBeNull();
  const cancel = within(screen.getByTestId('bottom-navigation')).getByText(
    '요청 취소',
  );
  await fireEvent.press(cancel);
  expect(signal?.aborted).toBe(true);
  expect(screen.getByTestId('disease-hypotheses-cancelled')).toBeTruthy();
  expect(
    within(screen.getByTestId('bottom-navigation')).queryByText('요청 취소'),
  ).toBeNull();
});

test('chat keeps composing available with stop in the send position and no navigation stop', async () => {
  let signal: AbortSignal | undefined;
  await render(
    <Shell>
      <ConversationScreen
        navigationRouteKey="ai-request"
        onBack={jest.fn()}
        onOpenSource={jest.fn()}
        onSend={(_question, _history, current) => {
          signal = current;
          return new Promise(() => {});
        }}
      />
    </Shell>,
  );
  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    '합성 검증 질문',
  );
  await fireEvent.press(screen.getByTestId('rag-conversation-send'));
  expect(
    within(screen.getByTestId('content')).queryByTestId(
      'rag-conversation-cancel',
    ),
  ).toBeTruthy();
  expect(screen.getByTestId('rag-conversation-input').props.editable).toBe(
    true,
  );
  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    '다음 질문 초안',
  );
  await fireEvent.press(
    within(screen.getByTestId('content')).getByTestId(
      'rag-conversation-cancel',
    ),
  );
  expect(signal?.aborted).toBe(true);
  expect(screen.getByText('답변 생성을 중지했어요.')).toBeTruthy();
  expect(screen.getByTestId('rag-conversation-input').props.value).toBe(
    '다음 질문 초안',
  );
  expect(screen.getByTestId('rag-conversation-send')).toBeTruthy();
  expect(
    within(screen.getByTestId('bottom-navigation')).queryByText('요청 취소'),
  ).toBeNull();
});
