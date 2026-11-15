import {
  fitsBottomNavigationRow,
  pageActionRailLayout,
  splitMeasuredPageActions,
  splitPageActions,
} from '../navigationPageActionLayout';
import {
  NAVIGATION_CONTEXTUAL_RAIL_CONTROL_HEIGHT,
  NAVIGATION_CONTEXTUAL_RAIL_STACK_SPACING,
  NAVIGATION_ROOT_RAIL_HEIGHT,
} from '../navigationRootLayout';
import { navigationRailPresentation } from '../navigationRailPresentation';

test('keeps a safe root rail when the complete bottom-anchored action group fits', () => {
  const layout = {
    placement: 'right' as const,
    reservedRightWidth: 72,
    contentWidth: 400,
    windowHeight: 382,
    railTopInset: 20,
    railBottomInset: 20,
    railRightInset: 12,
    systemBottomInset: 0,
  };
  expect(
    navigationRailPresentation(layout, 0, true, 0, 0).rightLayout,
  ).toBeDefined();
  const withActions = navigationRailPresentation(layout, 0, true, 0, 2);
  expect(withActions.rightLayout).toEqual(layout);
  expect(withActions.pageLayout?.capacity).toBe(2);
  // UIKit's spacer adds a 12pt gap before the first of two 48pt controls.
  expect(
    navigationRailPresentation({ ...layout, windowHeight: 382 }, 0, true, 0, 2)
      .pageLayout?.capacity,
  ).toBe(2);
  expect(
    navigationRailPresentation({ ...layout, windowHeight: 381 }, 0, true, 0, 2)
      .pageLayout?.capacity,
  ).toBe(1);
  const page = withActions.pageLayout!;
  expect(
    layout.windowHeight - page.pageBottomInset - page.pageTopInset,
  ).toBeGreaterThanOrEqual(120);
  expect(
    navigationRailPresentation({ ...layout, windowHeight: 238 }, 0, true, 0, 0)
      .rightLayout,
  ).toBeUndefined();
});

test('requires room for navigation and page actions together before placing one row', () => {
  const row = {
    navigationWidths: [48, 64],
    actionWidths: [80, 80],
    horizontalInsets: 32,
    itemGap: 8,
  };
  expect(fitsBottomNavigationRow({ ...row, width: 328 })).toBe(true);
  expect(fitsBottomNavigationRow({ ...row, width: 327 })).toBe(false);
  expect(fitsBottomNavigationRow({ ...row, width: Number.NaN })).toBe(false);
  expect(
    fitsBottomNavigationRow({ ...row, width: 500, actionWidths: [NaN] }),
  ).toBe(false);
});

test.each([
  ['the observed one-action rail', 768, 148, 157, 1],
  ['a two-action rail', 678, 30, 30, 2],
])(
  'bottom-anchors the complete page-action and root-tab group for %s',
  (_scenario, height, top, bottom, actionCount) => {
    const layout = pageActionRailLayout({
      height,
      top,
      bottom,
      rootTabs: true,
      navigationCount: 5,
      actionCount,
    });
    const actionStackHeight =
      actionCount *
      (NAVIGATION_CONTEXTUAL_RAIL_CONTROL_HEIGHT +
        NAVIGATION_CONTEXTUAL_RAIL_STACK_SPACING);
    const pageActionBottom = height - layout.pageBottomInset;
    const pageActionTop = pageActionBottom - actionStackHeight;
    const rootBottom = height - bottom;
    const rootTop = rootBottom - NAVIGATION_ROOT_RAIL_HEIGHT;

    expect(layout.fits).toBe(true);
    expect(layout.capacity).toBeGreaterThanOrEqual(actionCount);
    expect(pageActionTop).toBeGreaterThanOrEqual(top);
    expect(rootTop - pageActionBottom).toBe(8);
    expect(layout.navigationTopInset).toBeCloseTo(pageActionTop, 5);
  },
);

test('fits measured UIKit widths including the overflow button and every gap', () => {
  const actions = ['one', 'two', 'three'];
  expect(splitMeasuredPageActions(actions, [140, 130, 125, 48], 402)).toEqual({
    visible: ['one', 'two'],
    overflow: ['three'],
  });
  expect(splitMeasuredPageActions(['long'], [400, 48], 320)).toEqual({
    visible: [],
    overflow: ['long'],
  });
  expect(splitMeasuredPageActions(['a', 'b'], [100, 100, 48], 256)).toEqual({
    visible: ['a', 'b'],
    overflow: [],
  });
  expect(splitMeasuredPageActions(['a', 'b'], [100, 100, 48], 255)).toEqual({
    visible: ['a'],
    overflow: ['b'],
  });
  expect(splitMeasuredPageActions(actions, [], 402)).toEqual({
    visible: [],
    overflow: actions,
  });
  // These widths exercise the production labels' ordering; UIKit supplies the real measurements.
  const koreanActions = [
    '증상과 기록 요약하기',
    '가능성 살펴보기',
    '저장된 요약 보기',
  ];
  expect(
    splitMeasuredPageActions(koreanActions, [146, 130, 118, 48], 402),
  ).toEqual({
    visible: koreanActions.slice(0, 2),
    overflow: koreanActions.slice(2),
  });
});

test('reserves navigation widths before deciding which page actions fit', () => {
  expect(
    splitMeasuredPageActions(['save', 'cancel'], [80, 80, 44], 328, [48, 64]),
  ).toEqual({
    visible: ['save'],
    overflow: ['cancel'],
  });
});

test('places Back before page actions and preserves Home at the rail end', () => {
  const input = {
    height: 400,
    top: 20,
    bottom: 20,
    rootTabs: false,
    navigationCount: 2,
    actionCount: 4,
  };
  const layout = pageActionRailLayout(input);
  expect(layout.fits).toBe(true);
  expect(layout.navigationTopInset).toBeGreaterThanOrEqual(input.top);
  expect(layout.pageTopInset).toBeGreaterThan(layout.navigationTopInset);
  expect(layout.pageTopInset).toBe(
    layout.navigationTopInset +
      NAVIGATION_CONTEXTUAL_RAIL_CONTROL_HEIGHT +
      NAVIGATION_CONTEXTUAL_RAIL_STACK_SPACING +
      8,
  );
  expect(400 - layout.pageBottomInset).toBeLessThanOrEqual(
    input.height -
      input.bottom -
      NAVIGATION_CONTEXTUAL_RAIL_CONTROL_HEIGHT -
      NAVIGATION_CONTEXTUAL_RAIL_STACK_SPACING -
      8,
  );
  expect(pageActionRailLayout({ ...input, height: 150 }).fits).toBe(false);
});

test('reserves a reachable overflow slot while preserving action order', () => {
  expect(splitPageActions(['add', 'save', 'cancel'], 2)).toEqual({
    visible: ['add'],
    overflow: ['save', 'cancel'],
  });
  expect(splitPageActions(['add', 'save'], 1)).toEqual({
    visible: [],
    overflow: ['add', 'save'],
  });
});
