import {
  createNavigationGeometrySnapshot,
  type NavigationGeometryPayload,
} from '../navigationGeometry';
import { resolveNavigationRootLayout } from '../navigationRootLayout';
import { openGeometry } from '../__fixtures__/navigationOpenGeometry';
import { leftSplitGeometry } from '../__fixtures__/navigationSplitGeometry';
import { resolveNavigationContentFrame } from '../navigationContentFrame';

// Public UIKit observations from beef451 on iOS 27.1, 2026-10-28.
// Closed Duo has no division; hinge identity must survive that disappearance.
const folded = {
  windowBounds: { x: 0, y: 0, width: 466, height: 678 },
  safeAreaInsets: { top: 0, left: 0, right: 84, bottom: 34 },
  reservedRegionsSupported: true,
  hasHinge: true,
  reservedRegions: [
    {
      id: 'system-side',
      kind: 'occlusion',
      isActive: true,
      frame: { x: 382, y: 0, width: 84, height: 174 },
      margins: { top: 0, left: 0, right: 0, bottom: 0 },
    },
  ],
} satisfies NavigationGeometryPayload & { hasHinge: boolean };

test('keeps the folded Duo rail below the actual system indicator without a division', () => {
  expect(
    resolveNavigationRootLayout(createNavigationGeometrySnapshot(folded)),
  ).toEqual(
    expect.objectContaining({
      placement: 'right',
      contentWidth: 382,
      railTopInset: 186,
      railRightInset: 143 / 6,
    }),
  );
});

test('positions the observed rail relative to the indicator', () => {
  const result = resolveNavigationRootLayout(
    createNavigationGeometrySnapshot(openGeometry),
  );
  expect(result).toEqual(
    expect.objectContaining({ railRightInset: 143 / 6, contentWidth: 867 }),
  );
});

test('does not infer a hinged phone from OS support or ordinary phone width', () => {
  expect(
    resolveNavigationRootLayout(
      createNavigationGeometrySnapshot({
        ...folded,
        hasHinge: false,
      }),
    ).placement,
  ).toBe('bottom');
});

test('places the observed left split rail opposite its edge-clipped division', () => {
  const geometry = createNavigationGeometrySnapshot(leftSplitGeometry);
  const layout = resolveNavigationRootLayout(geometry);
  expect(layout).toMatchObject({
    placement: 'right',
    railSide: 'left',
    reservedLeftWidth: 72,
    reservedRightWidth: 0,
    contentWidth: 397,
    railRightInset: 107 / 6,
  });
  expect(resolveNavigationContentFrame(geometry, layout)).toMatchObject({
    side: 'left',
    availableContentFrame: { x: 72, y: 0, width: 397, height: 635 },
  });
  if (layout.placement !== 'right') throw new Error('Expected a side rail');
  const innerGap = 72 - layout.railRightInset - 48;
  expect(layout.railRightInset - 12).toBeCloseTo(12 - innerGap);
  expect(innerGap).toBeGreaterThan(0);
});

test('preserves the left Split reservation with a top occlusion', () => {
  const geometry = createNavigationGeometrySnapshot({
    ...leftSplitGeometry,
    reservedRegions: [
      ...leftSplitGeometry.reservedRegions,
      {
        id: 'left-top',
        kind: 'occlusion',
        isActive: true,
        frame: { x: 0, y: 0, width: 72, height: 120 },
        margins: { top: 0, left: 0, right: 0, bottom: 0 },
      },
    ],
  });
  expect(resolveNavigationRootLayout(geometry)).toMatchObject({
    placement: 'right',
    railSide: 'left',
    reservedLeftWidth: 72,
    contentWidth: 397,
    railRightInset: 107 / 6,
  });
});
