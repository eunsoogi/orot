import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import type { AiWorkflowObserver } from '../../agent/workflowActivity';
import { NextVisitQuestionsScreen } from '../NextVisitQuestionsScreen';
import { makeProps, questions, type Props } from '../testSupport/fixtures';

test('shows a provisional question stream and ignores events after cancellation', async () => {
  let observer: AiWorkflowObserver | undefined;
  let resolveOutcome!: (
    outcome: Awaited<ReturnType<Props['onGenerate']>>,
  ) => void;
  const onGenerate: Props['onGenerate'] = jest.fn(
    (_visit, _selection, _signal, currentObserver) => {
      observer = currentObserver;
      return new Promise(resolve => {
        resolveOutcome = resolve;
      });
    },
  );
  await render(<NextVisitQuestionsScreen {...makeProps({ onGenerate })} />);

  const pendingPress = fireEvent.press(
    screen.getByTestId('next-visit-generate'),
  );
  await waitFor(() => expect(observer).toBeDefined());
  expect(
    screen.getByTestId('next-visit-generation-progress').props.children,
  ).toBe('현재 자료를 확인하고 질문 후보를 만들고 있어요.');

  await act(async () => {
    observer?.onTaskStreamEvent?.({ type: 'started' });
    observer?.onTaskStreamEvent?.({
      type: 'text_delta',
      text: '최근 변화는 언제부터였나요?',
    });
    observer?.onProgress?.({
      type: 'evidence_search',
      status: 'started',
      sourceKind: 'personal_record',
    });
  });
  expect(
    screen.getByTestId('next-visit-generation-progress').props.children,
  ).toBe('필요한 자료를 찾고 있어요.');
  expect(
    screen.getByTestId('next-visit-generation-preview').props.children,
  ).toBeTruthy();
  expect(screen.getByText('최근 변화는 언제부터였나요?')).toBeTruthy();
  expect(screen.getByText('검증 중인 응답 초안')).toBeTruthy();
  expect(
    screen.getByText('최종 결과는 근거와 안전 기준을 확인한 뒤 보여 드려요.'),
  ).toBeTruthy();

  await fireEvent.press(screen.getByTestId('next-visit-generation-cancel'));
  expect(screen.queryByTestId('next-visit-generation-preview')).toBeNull();
  await act(async () => {
    observer?.onTaskStreamEvent?.({
      type: 'text_delta',
      text: '오래된 초안',
    });
    resolveOutcome({ status: 'ready', questions, caveats: [] });
    await pendingPress;
  });
  expect(screen.queryByText('오래된 초안')).toBeNull();
  expect(screen.queryByTestId('next-visit-review-list')).toBeNull();
  expect(
    screen.getByTestId('next-visit-generation-message').props.children,
  ).toBe('질문 생성을 취소했어요.');
});
