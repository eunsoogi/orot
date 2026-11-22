import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';
import { ClassificationResultsStage } from '../ClassificationResultsStage';

const originalDimensions = {
  window: Dimensions.get('window'),
  screen: Dimensions.get('screen'),
};
afterEach(async () => {
  await act(async () => Dimensions.set(originalDimensions));
});

const rows = Array.from({ length: 8 }, (_, index) => {
  const title = `합성 일정 ${index + 1}`;
  return {
    id: String(index),
    title,
    when: '6월 2일 09:05–09:45',
    category: '의료 방문·검사 일정',
    details: [{ label: '제목', value: title }],
  };
});

test('wide results stay at three per page and Detail Back preserves the selected list page', async () => {
  const pane = { width: 820, height: 750, scale: 2, fontScale: 1 };
  await act(async () => Dimensions.set({ window: pane, screen: pane }));
  const restart = jest.fn();
  await render(
    <ClassificationResultsStage
      rows={rows}
      summary="범위"
      notice=""
      restart={restart}
    />,
  );
  await fireEvent(screen.getByTestId('medical-appointment-results'), 'layout', {
    nativeEvent: { layout: pane },
  });
  const rowIDs = () => screen.getAllByTestId('classification-result-row');
  const next = () => screen.getByRole('button', { name: '다음 페이지' });
  const previous = () => screen.getByRole('button', { name: '이전 페이지' });
  expect(rowIDs()).toHaveLength(3);
  expect(previous()).toBeDisabled();
  await fireEvent.press(next());
  expect(rowIDs()).toHaveLength(3);
  expect(screen.getByText(rows[3]!.title)).toBeTruthy();
  await fireEvent.press(rowIDs()[0]!);
  const back = screen.getByRole('button', {
    name: '분류된 일정 목록으로 돌아가기',
  });
  expect(StyleSheet.flatten(back.props.style)).toMatchObject({
    width: 44,
    height: 44,
  });
  expect(back).not.toHaveTextContent('목록');
  await fireEvent.press(back);
  expect(restart).not.toHaveBeenCalled();
  expect(screen.getByText(rows[3]!.title)).toBeTruthy();
  await fireEvent.press(next());
  expect(rowIDs()).toHaveLength(2);
  expect(next()).toBeDisabled();
  expect(screen.getByText(rows[7]!.title)).toBeTruthy();
  await fireEvent.press(previous());
  await fireEvent.press(previous());
  expect(screen.getByText(rows[0]!.title)).toBeTruthy();
});

test('a short partial list shows warning and coverage and offers their full text without a second result page', async () => {
  const pane = { width: 280, height: 125, scale: 2, fontScale: 2 };
  const notice = '일부 일정은 확인하지 못했어요. 완료한 분류는 유지했어요.';
  const coverage = '불러온 일정 10건 중 8건을 분류했습니다.';
  await act(async () => Dimensions.set({ window: pane, screen: pane }));
  await render(
    <ClassificationResultsStage
      rows={rows}
      notice={notice}
      summary={coverage}
      restart={jest.fn()}
    />,
  );
  await fireEvent(screen.getByTestId('medical-appointment-results'), 'layout', {
    nativeEvent: { layout: pane },
  });
  expect(screen.getByText(notice)).toBeVisible();
  expect(screen.getByText(coverage)).toBeVisible();
  expect(screen.getAllByTestId('classification-result-row')).toHaveLength(1);
  await fireEvent.press(screen.getByTestId('classification-result-notice'));
  expect(screen.getByText(notice).props.numberOfLines).toBeUndefined();
  expect(screen.getByText(coverage).props.numberOfLines).toBeUndefined();
  expect(screen.queryByTestId('medical-appointment-next-result')).toBeNull();
  await fireEvent.press(screen.getByTestId('classification-detail-back'));
  expect(screen.getByText(coverage)).toBeVisible();
});

test('no classified rows keeps the original measured failure reader without a results list', async () => {
  const notice =
    '첫 번째 분류 작업을 완료하지 못했어요. 완료한 분류는 유지했어요.';
  const restart = jest.fn();
  await render(
    <ClassificationResultsStage
      rows={[]}
      notice={notice}
      summary="합성 집계"
      restart={restart}
    />,
  );
  expect(screen.getByTestId('classification-page-text')).toHaveTextContent(
    notice,
  );
  expect(screen.getByTestId('classification-text-viewport')).toBeTruthy();
  expect(screen.getByTestId('classification-stage-footer')).toBeTruthy();
  expect(screen.queryByTestId('classification-result-list')).toBeNull();
  expect(screen.getByText('재분류')).toBeVisible();
  await fireEvent.press(screen.getByRole('button', { name: '다시 분류하기' }));
  expect(restart).toHaveBeenCalledTimes(1);
});
