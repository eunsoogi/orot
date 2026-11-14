import { pageActionRailLayout } from '../navigationPageActionLayout';
import {
  fitsNavigationRootRail,
  NAVIGATION_CONTEXTUAL_RAIL_CONTROL_HEIGHT,
  NAVIGATION_ROOT_BACK_GROUP_HEIGHT,
  NAVIGATION_ROOT_RAIL_HEIGHT,
} from '../navigationRootLayout';
import { navigationRailPresentation } from '../navigationRailPresentation';

test('keeps Back separate from root tabs and falls back below the complete group height', () => {
  const layout = {
    placement: 'right' as const,
    reservedRightWidth: 72,
    contentWidth: 400,
    windowHeight: 367,
    railTopInset: 20,
    railBottomInset: 20,
    railRightInset: 12,
    systemBottomInset: 0,
  };
  expect(
    navigationRailPresentation(layout, 0, true, 0, 0).rightLayout,
  ).toBeDefined();
  expect(fitsNavigationRootRail(367, 20, 20)).toBe(true);
  expect(fitsNavigationRootRail(367, 20, 20, true)).toBe(false);
  expect(
    navigationRailPresentation(layout, 0, true, 1, 0, true).rightLayout,
  ).toBeUndefined();
  expect(
    navigationRailPresentation(
      { ...layout, windowHeight: 368 },
      0,
      true,
      1,
      0,
      true,
    ).rightLayout,
  ).toBeDefined();
});

test('bottom-anchors Back with the fixed root tabs inside the measured rail segment', () => {
  const layout = pageActionRailLayout({
    height: 669,
    top: 192,
    bottom: 46,
    rootTabs: true,
    navigationCount: 1,
    actionCount: 0,
    hasContextualBack: true,
  });
  const rootCenter = 669 - 46 - NAVIGATION_ROOT_RAIL_HEIGHT / 2;
  const rootTop = rootCenter - NAVIGATION_ROOT_RAIL_HEIGHT / 2;
  const backTop = rootTop - NAVIGATION_ROOT_BACK_GROUP_HEIGHT;
  const backBottom = backTop + NAVIGATION_CONTEXTUAL_RAIL_CONTROL_HEIGHT;

  expect(layout.fits).toBe(true);
  expect(layout.navigationTopInset).toBe(
    669 - 46 - NAVIGATION_ROOT_RAIL_HEIGHT - NAVIGATION_ROOT_BACK_GROUP_HEIGHT,
  );
  expect(rootTop - backBottom).toBeCloseTo(4, 5);
  expect(rootTop + NAVIGATION_ROOT_RAIL_HEIGHT).toBe(669 - 46);
  expect(backTop).toBeGreaterThanOrEqual(192);
});

test('keeps measured page actions above Back and the fixed root rail', () => {
  const layout = pageActionRailLayout({
    height: 768,
    top: 148,
    bottom: 157,
    rootTabs: true,
    navigationCount: 1,
    actionCount: 1,
    hasContextualBack: true,
  });
  const rootCenter = 768 - 157 - NAVIGATION_ROOT_RAIL_HEIGHT / 2;
  const rootTop = rootCenter - NAVIGATION_ROOT_RAIL_HEIGHT / 2;
  const backTop = rootTop - NAVIGATION_ROOT_BACK_GROUP_HEIGHT;
  const pageActionBottom = 768 - layout.pageBottomInset;

  expect(layout.fits).toBe(true);
  expect(layout.capacity).toBeGreaterThanOrEqual(1);
  expect(backTop - pageActionBottom).toBeCloseTo(8, 5);
});
