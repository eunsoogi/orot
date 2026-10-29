import {
  createNavigationGeometrySnapshot,
  type NavigationGeometryPayload,
} from '../navigationGeometry';
import { resolveNavigationRootLayout } from '../navigationRootLayout';
import { openGeometry } from '../__fixtures__/navigationOpenGeometry';

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
    }),
  );
});

test('centers the rail horizontally within the observed system-side lane', () => {
  const result = resolveNavigationRootLayout(
    createNavigationGeometrySnapshot(openGeometry),
  );
  expect(result).toEqual(
    expect.objectContaining({ railRightInset: 18, contentWidth: 867 }),
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
