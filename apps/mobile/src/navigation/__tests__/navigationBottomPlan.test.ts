import { navigationBottomPlan } from '../navigationBottomPlan';
import type { NavigationGlassAction } from '../NavigationGlassSurface';

const root = ['home', 'records', 'schedule', 'ai', 'settings'].map(
  (id, index): NavigationGlassAction => ({
    id: `tab-${id}`,
    label: id,
    accessibilityLabel: id,
    testID: `tab-${id}`,
    rootTab: true,
    selected: index === 2,
  }),
);
const detail: NavigationGlassAction[] = ['back', 'home'].map(id => ({
  id,
  label: id,
  accessibilityLabel: id,
  testID: id,
}));

test('keeps selected root and primary page action direct without shrinking original root targets', () => {
  const plan = navigationBottomPlan({
    width: 390,
    navigation: root,
    navigationWidths: [44, 44, 44, 44, 44],
    pageWidths: [88],
    moreWidth: 44,
  });
  expect(plan).not.toBeNull();
  expect(plan!.navigationIndices).toContain(2);
  expect(plan!.pageIndices).toEqual([0]);
  expect(plan!.overflowNavigation.length).toBeGreaterThan(0);
  const count = plan!.navigationIndices.length + 1;
  const hitWidth = (plan!.navWidth - 32 - (count - 1) * 4) / count;
  expect(hitWidth).toBeGreaterThanOrEqual((390 - 16 - 32 - 16) / 5);
});

test('keeps all four detail controls direct when they fit, and primary before secondary when narrow', () => {
  const full = navigationBottomPlan({
    width: 390,
    navigation: detail,
    navigationWidths: [48, 64],
    pageWidths: [88, 88],
    moreWidth: 52,
  });
  expect(full?.navigationIndices).toEqual([0, 1]);
  expect(full?.pageIndices).toEqual([0, 1]);
  expect(full?.overflowPages).toEqual([]);
  const narrow = navigationBottomPlan({
    width: 320,
    navigation: detail,
    navigationWidths: [48, 64],
    pageWidths: [88, 88],
    moreWidth: 52,
  });
  expect(narrow?.navigationIndices).toContain(0);
  expect(narrow?.pageIndices).toContain(0);
  expect(narrow?.overflowNavigation).toEqual([1]);
  expect(narrow?.overflowPages).toEqual([1]);
});

test('keeps the selected root tab visible when large text requires overflow', () => {
  const plan = navigationBottomPlan({
    width: 390,
    navigation: root,
    navigationWidths: [100, 100, 100, 100, 100],
    pageWidths: [],
    moreWidth: 80,
  });
  expect(plan?.navigationIndices).toContain(2);
  expect(plan?.overflowNavigation.length).toBeGreaterThan(0);
});

test('reports impossible or invalid geometry instead of hiding the primary control', () => {
  expect(
    navigationBottomPlan({
      width: 180,
      navigation: detail,
      navigationWidths: [100, 100],
      pageWidths: [120],
      moreWidth: 80,
    }),
  ).toBeNull();
  expect(
    navigationBottomPlan({
      width: 390,
      navigation: detail,
      navigationWidths: [48, NaN],
      pageWidths: [88],
      moreWidth: 52,
    }),
  ).toBeNull();
});

test('uses the explicitly identified primary page action even when it is not first', () => {
  const plan = navigationBottomPlan({
    width: 320,
    navigation: detail,
    navigationWidths: [48, 64],
    pageWidths: [88, 88],
    moreWidth: 52,
    primaryPageIndices: [1],
  });
  expect(plan?.pageIndices).toContain(1);
  expect(plan?.overflowPages).toEqual([0]);
});

test('reports insufficient space when all explicitly primary actions cannot fit', () => {
  expect(
    navigationBottomPlan({
      width: 320,
      navigation: detail,
      navigationWidths: [48, 64],
      pageWidths: [88, 88],
      moreWidth: 52,
      primaryPageIndices: [0, 1],
    }),
  ).toBeNull();
});
