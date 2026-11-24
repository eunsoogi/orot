import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import {
  NavigationContentFrameContext,
  type NavigationContentFrame,
} from '../../../navigation/navigationContentFrame';
import { EvidenceRouteScrollView } from '../EvidenceRouteScrollView';
import { EvidenceSourceSections } from '../EvidenceSourceSections';

const windowFrame = { x: 0, y: 0, width: 466, height: 678 };
const frame: NavigationContentFrame = {
  side: 'right',
  windowFrame,
  viewportFrame: windowFrame,
  availableContentFrame: { ...windowFrame, width: 382 },
  reservedRegions: [],
  navigationFrame: { x: 406, y: 174, width: 48, height: 270 },
};

const sections = [
  { title: '합성 첫 자료', rows: [{ label: '기록', value: '합성 첫 값' }] },
  { title: '합성 둘째 자료', rows: [{ label: '기록', value: '합성 둘째 값' }] },
];

function draw(routeKey?: string) {
  return (
    <NavigationContentFrameContext.Provider value={frame}>
      <EvidenceRouteScrollView
        routeKey={routeKey}
        testID="reader"
        contentContainerStyle={{ paddingHorizontal: 20 }}
      >
        {lane => (
          <EvidenceSourceSections
            routeKey={routeKey}
            edgeLane={lane}
            sections={sections}
          />
        )}
      </EvidenceRouteScrollView>
    </NavigationContentFrameContext.Provider>
  );
}

const layout = async (key: string, width: number) => {
  await fireEvent(screen.getByTestId(key), 'layout', {
    nativeEvent: { layout: { width } },
  });
};

test('only the measured full-width source selector bleeds through its rail, with hit and terminal clearance', async () => {
  const view = await render(draw('registered-route'));
  const scroll = screen.getByTestId('reader');
  const menu = screen.getByTestId('ai-feature-source-selection');
  const menuRight = () =>
    StyleSheet.flatten(menu.parent?.props.style)?.marginRight;
  expect(scroll.props.scrollIndicatorInsets).toBeUndefined();
  expect(menuRight()).toBeUndefined();
  await layout('reader-owner', 382);
  await layout('ai-feature-source-selection-owner', 342);
  expect(scroll.props.scrollIndicatorInsets.right).toBe(0);
  expect(StyleSheet.flatten(scroll.props.contentContainerStyle)).toMatchObject({
    paddingRight: 104,
  });
  expect(menuRight()).toBe(-104);
  expect(StyleSheet.flatten(menu.props.contentContainerStyle)).toMatchObject({
    paddingRight: 104,
  });

  const shield = screen.getByTestId('navigation-edge-menu-touch-clearance', {
    includeHiddenElements: true,
  });
  expect(shield.props.accessibilityElementsHidden).toBe(true);
  expect(StyleSheet.flatten(shield.props.style)).toMatchObject({
    width: 84,
    right: 0,
  });
  await fireEvent.press(screen.getByTestId('ai-feature-source-section-1'));
  expect(screen.getByText('합성 둘째 값')).toBeVisible();

  await layout('ai-feature-source-selection-owner', 250);
  expect(menuRight()).toBeUndefined();
  expect(
    screen.queryByTestId('navigation-edge-menu-touch-clearance', {
      includeHiddenElements: true,
    }),
  ).toBeNull();
  expect(scroll.props.scrollIndicatorInsets.right).toBe(0);
  expect(screen.getByText('합성 둘째 값')).toBeVisible();

  await view.rerender(draw());
  expect(scroll.props.scrollIndicatorInsets).toBeUndefined();
  expect(menuRight()).toBeUndefined();
});
