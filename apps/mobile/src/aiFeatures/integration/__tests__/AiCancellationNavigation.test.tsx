import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { Button, View } from 'react-native';
import type { ReactNode } from 'react';
import { DiseaseHypothesesScreen } from '../../../diseaseHypotheses/DiseaseHypothesesScreen';
import type { DiseaseHypothesisRunOutcome } from '../../../diseaseHypotheses/task';
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
              action.onPress();
            }}
          />
        ) : null}
      </View>
    </NavigationPrimaryActionContext.Provider>
  );
}

test('visit questions cancel from the page and abort the pending request', async () => {
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
    within(screen.getByTestId('bottom-navigation')).queryByTestId(
      'next-visit-generation-cancel',
    ),
  ).toBeNull();
  await fireEvent.press(
    within(screen.getByTestId('next-visit-questions-scroll')).getByTestId(
      'next-visit-generation-cancel',
    ),
  );
  expect(signal?.aborted).toBe(true);
  expect(screen.getByTestId('next-visit-generate')).toBeTruthy();
});

test('symptom analysis cancels from the page without a duplicate navigation control', async () => {
  let signal: AbortSignal | undefined;
  let finish!: (outcome: DiseaseHypothesisRunOutcome) => void;
  await render(
    <Shell>
      <DiseaseHypothesesScreen
        navigationRouteKey="ai-request"
        onBack={jest.fn()}
        onOpenSource={jest.fn()}
        onGenerate={current => {
          signal = current;
          return new Promise(resolve => {
            finish = resolve;
          });
        }}
      />
    </Shell>,
  );
  await fireEvent.press(screen.getByTestId('disease-hypotheses-generate'));
  expect(
    within(screen.getByTestId('bottom-navigation')).queryByTestId(
      'disease-hypotheses-cancel',
    ),
  ).toBeNull();
  const cancel = within(
    screen.getByTestId('disease-hypotheses-screen'),
  ).getByTestId('disease-hypotheses-cancel');
  await fireEvent.press(cancel);
  expect(signal?.aborted).toBe(true);
  expect(screen.getByTestId('disease-hypotheses-cancelled')).toBeTruthy();
  await act(async () => {
    finish({
      status: 'workflow',
      result: {
        status: 'consent_required',
        reason: 'Late synthetic response',
        checkpoint: {} as never,
      },
    });
  });
  expect(screen.getByTestId('disease-hypotheses-cancelled')).toBeTruthy();
  expect(
    screen.queryByTestId('disease-hypotheses-consent-required'),
  ).toBeNull();
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
