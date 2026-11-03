import { navigationWrappedPlan } from '../navigationWrappedPlan';
import type { NavigationGlassAction } from '../NavigationGlassSurface';

const navigation: NavigationGlassAction[] = ['back', 'home'].map(id => ({
  id,
  label: id,
  accessibilityLabel: id,
  testID: id,
}));

test('wraps a long primary label before moving navigation into More', () => {
  const result = navigationWrappedPlan({
    width: 402,
    navigation,
    navigationWidths: [76, 64],
    pageWidths: [250],
    moreWidth: 140,
  });
  expect(result?.wrapped).toBe(true);
  expect(result?.plan.navigationIndices).toEqual([0, 1]);
  expect(result?.plan.pageIndices).toEqual([0]);
  expect(result?.plan.overflowNavigation).toEqual([]);
  expect(result!.pageWidths[0]).toBeGreaterThanOrEqual(88);
  expect(result!.pageWidths[0]).toBeLessThan(250);
});

test('retains primary and sends secondary actions to More only after wrapping cannot fit all', () => {
  const result = navigationWrappedPlan({
    width: 320,
    navigation,
    navigationWidths: [48, 64],
    pageWidths: [200, 200],
    moreWidth: 100,
  });
  expect(result?.plan.pageIndices).toContain(0);
  expect(result?.plan.overflowPages.length).toBeGreaterThan(0);
});

test('never wraps below the original standard-text hit width', () => {
  const result = navigationWrappedPlan(
    {
      width: 402,
      navigation,
      navigationWidths: [76, 64],
      pageWidths: [250],
      moreWidth: 140,
    },
    [true],
    [110],
    64,
  );
  expect(result?.pageWidths[0]).toBeGreaterThanOrEqual(110);
});
