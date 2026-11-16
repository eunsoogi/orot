import { createNavigationGeometrySnapshot } from '../navigationGeometry';
import { resolveNavigationRootLayout } from '../navigationRootLayout';
import { navigationRailPresentation } from '../navigationRailPresentation';
import { openGeometry } from '../__fixtures__/navigationOpenGeometry';
import { leftSplitGeometry } from '../__fixtures__/navigationSplitGeometry';

// Fixed expected coordinates independently preserve observed system edges.
test.each([
  [openGeometry, 128, 38],
  [leftSplitGeometry, 4, 38],
] as const)(
  'keeps compact gaps outside measured top and bottom boundaries',
  (payload, top, bottom) => {
    const layout = resolveNavigationRootLayout(
      createNavigationGeometrySnapshot(payload),
    );
    expect(layout).toMatchObject({
      railTopInset: top,
      railBottomInset: bottom,
    });
    expect(
      navigationRailPresentation(layout, 0, true, 0, 0).rightLayout,
    ).toEqual(layout);
  },
);

test('keeps the existing keyboard clearance without shrinking native targets', () => {
  const layout = resolveNavigationRootLayout(
    createNavigationGeometrySnapshot(openGeometry),
  );
  const result = navigationRailPresentation(layout, 160, true, 0, 0);
  expect(result.bottomInset).toBe(12);
  expect(result.height).toBe(509);
  expect(result.rightLayout).toEqual(layout);
  expect(result.keyboardSuspended).toBe(false);
});

test('still suspends a rail when the keyboard leaves less than the fixed control stack', () => {
  const layout = resolveNavigationRootLayout(
    createNavigationGeometrySnapshot(openGeometry),
  );
  expect(
    navigationRailPresentation(layout, 430, true, 0, 0).keyboardSuspended,
  ).toBe(true);
});
