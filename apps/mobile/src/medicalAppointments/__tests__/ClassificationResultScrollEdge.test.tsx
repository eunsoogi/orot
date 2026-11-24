import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import {
  NavigationContentFrameContext,
  type NavigationContentFrame,
} from '../../navigation/navigationContentFrame';
import { ClassificationResultsStage } from '../ClassificationResultsStage';

const windowFrame = { x: 0, y: 0, width: 760, height: 600 };
const frame: NavigationContentFrame = {
  side: 'right',
  windowFrame,
  viewportFrame: windowFrame,
  availableContentFrame: { ...windowFrame, width: 676 },
  reservedRegions: [],
  navigationFrame: { x: 704, y: 90, width: 48, height: 260 },
};

test('keeps its centered rows inset and retained while the owning list borrows the window edge', async () => {
  const draw = (width: number) => (
    <NavigationContentFrameContext.Provider value={frame}>
      <ClassificationResultsStage
        routeRightGutter={24}
        routeOwnerWidth={width}
        rows={[
          {
            id: 'synthetic',
            title: '합성 일정',
            when: '오전 9시',
            category: '의료 방문',
            details: [{ label: '제목', value: '합성 일정' }],
          },
        ]}
        notice=""
        summary="분류 완료"
        restart={jest.fn()}
      />
    </NavigationContentFrameContext.Provider>
  );
  const view = await render(draw(676));
  await fireEvent(screen.getByTestId('medical-appointment-results'), 'layout', {
    nativeEvent: { layout: { width: 628, height: 500 } },
  });
  const list = screen.getByTestId('classification-result-list');
  const edgeWidth = 84 + 24 + (628 - 520) / 2;
  expect(StyleSheet.flatten(list.props.style)).toMatchObject({
    marginRight: -edgeWidth,
  });
  expect(StyleSheet.flatten(list.props.contentContainerStyle)).toMatchObject({
    paddingRight: edgeWidth,
  });
  expect(list.props.scrollIndicatorInsets.right).toBe(0);
  await fireEvent.press(screen.getByTestId('classification-result-row'));
  expect(screen.queryByTestId('classification-result-list')).toBeNull();
  expect(screen.queryByTestId('classification-result-row')).toBeNull();
  const retained = screen.getByTestId('classification-result-group', {
    includeHiddenElements: true,
  });
  expect(retained.props.pointerEvents).toBe('none');
  expect(retained.props.accessibilityElementsHidden).toBe(true);
  expect(
    screen.getByTestId('classification-result-list', {
      includeHiddenElements: true,
    }),
  ).toBe(list);
  await fireEvent.press(screen.getByTestId('classification-detail-back'));
  expect(screen.getByTestId('classification-result-list')).toBe(list);

  await view.rerender(draw(500));
  expect(StyleSheet.flatten(list.props.style)?.marginRight).toBeUndefined();
  expect(list.props.scrollIndicatorInsets).toBeUndefined();
});
