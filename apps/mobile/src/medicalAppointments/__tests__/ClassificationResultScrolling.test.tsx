import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';
import { classificationDockGeometry } from '../ClassificationCircle';
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

test('one scroll owns all ordered rows and stays mounted but inaccessible during detail', async () => {
  const pane = { width: 820, height: 750, scale: 2, fontScale: 1 };
  await act(async () => Dimensions.set({ window: pane, screen: pane }));
  const restart = jest.fn();
  await render(
    <ClassificationResultsStage
      rows={rows}
      summary="합성 집계"
      notice=""
      restart={restart}
    />,
  );
  await fireEvent(screen.getByTestId('medical-appointment-results'), 'layout', {
    nativeEvent: { layout: pane },
  });
  const list = screen.getByTestId('classification-result-list');
  const visibleRows = screen.getAllByTestId('classification-result-row');
  expect(visibleRows.map(row => row.props.accessibilityLabel)).toEqual(
    rows.map(row => `${row.title}, ${row.when}, ${row.category}`),
  );
  expect(
    screen.queryByTestId('medical-appointment-previous-result'),
  ).toBeNull();
  expect(screen.queryByTestId('medical-appointment-next-result')).toBeNull();
  expect(within(list).getAllByTestId('classification-result-row')).toHaveLength(
    rows.length,
  );
  expect(within(list).queryByTestId('medical-appointment-import')).toBeNull();
  expect(within(list).queryByTestId('classification-result-notice')).toBeNull();
  expect(screen.getByText('합성 집계')).toBeVisible();
  await fireEvent.press(visibleRows.at(-1)!);
  const back = screen.getByRole('button', {
    name: '분류된 일정 목록으로 돌아가기',
  });
  expect(StyleSheet.flatten(back.props.style)).toMatchObject({
    width: 44,
    height: 44,
  });
  expect(back).not.toHaveTextContent('목록');
  expect(screen.getByTestId('classification-detail-value-0')).toHaveTextContent(
    rows.at(-1)!.title,
  );
  expect(screen.queryByTestId('classification-result-list')).toBeNull();
  expect(screen.queryAllByTestId('classification-result-row')).toHaveLength(0);
  expect(
    screen.getByTestId('classification-result-list', {
      includeHiddenElements: true,
    }),
  ).toBe(list);
  await fireEvent.press(back);
  expect(screen.getByTestId('classification-result-list')).toBe(list);
  expect(screen.queryByTestId('classification-result-reader')).toBeNull();
  expect(restart).not.toHaveBeenCalled();
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
  expect(screen.getAllByTestId('classification-result-row')).toHaveLength(
    rows.length,
  );
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

test('centers the whole short expanded group and keeps overflow scroll geometry through detail Back', async () => {
  const pane = { width: 819, height: 402, scale: 3, fontScale: 1 };
  await act(async () => Dimensions.set({ window: pane, screen: pane }));
  const draw = (count: number) => (
    <ClassificationResultsStage
      rows={rows.slice(0, count)}
      summary="합성 집계"
      notice=""
      restart={jest.fn()}
      movingCircle={classificationDockGeometry(
        pane.width,
        pane.height,
        1,
        true,
      )}
    />
  );
  const view = await render(draw(2));
  await fireEvent(screen.getByTestId('medical-appointment-results'), 'layout', {
    nativeEvent: { layout: pane },
  });
  const group = () =>
    StyleSheet.flatten(
      screen.getByTestId('classification-result-group', {
        includeHiddenElements: true,
      }).props.style,
    );
  let list = screen.getByTestId('classification-result-list');
  await fireEvent(list, 'contentSizeChange', 583, 108);
  expect(group()).not.toHaveProperty('maxWidth');
  expect(group()).not.toHaveProperty('width');
  expect(group()).toMatchObject({ top: 125, bottom: 125, left: 236, right: 0 });
  const first = screen.getAllByTestId('classification-result-row')[0]!;
  await fireEvent.press(first);
  const reader = StyleSheet.flatten(
    screen.getByTestId('classification-result-reader').props.style,
  );
  expect(reader).toMatchObject({ left: 236, right: 0 });
  expect(reader).not.toHaveProperty('maxWidth');
  expect(group()).toMatchObject({ top: 125, bottom: 125, opacity: 0 });
  expect(
    screen.getByTestId('classification-result-list', {
      includeHiddenElements: true,
    }),
  ).toBe(list);
  await fireEvent.press(screen.getByTestId('classification-detail-back'));
  expect(screen.getByTestId('classification-result-list')).toBe(list);
  expect(group()).toMatchObject({ top: 125, bottom: 125 });

  await view.rerender(draw(8));
  list = screen.getByTestId('classification-result-list');
  await fireEvent(list, 'contentSizeChange', 583, 470);
  expect(group()).toMatchObject({ top: 0, bottom: 0, left: 236, right: 0 });
  expect(screen.getAllByTestId('classification-result-row')).toHaveLength(8);
});
