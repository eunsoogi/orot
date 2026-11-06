import {
  createNavigationGeometrySnapshot,
  type NavigationGeometryPayload,
} from '../navigationGeometry';
import { hasNavigationDuoGeometry } from '../navigationDuoGeometry';

const geometry: NavigationGeometryPayload = {
  windowBounds: { x: 0, y: 0, width: 320, height: 720 },
  safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
  reservedRegionsSupported: true,
  reservedRegions: [
    {
      id: 'hinge',
      kind: 'division',
      frame: { x: 315, y: 0, width: 5, height: 720 },
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
      isActive: false,
    },
  ],
};

test('uses explicit hinge evidence and only falls back to divisions for legacy geometry', () => {
  expect(
    hasNavigationDuoGeometry(
      createNavigationGeometrySnapshot({ ...geometry, hasHinge: true }),
    ),
  ).toBe(true);
  expect(
    hasNavigationDuoGeometry(
      createNavigationGeometrySnapshot({ ...geometry, hasHinge: false }),
    ),
  ).toBe(false);
  expect(
    hasNavigationDuoGeometry(createNavigationGeometrySnapshot(geometry)),
  ).toBe(true);
  expect(
    hasNavigationDuoGeometry(
      createNavigationGeometrySnapshot({
        ...geometry,
        reservedRegionsSupported: false,
      }),
    ),
  ).toBe(false);
  expect(
    hasNavigationDuoGeometry(
      createNavigationGeometrySnapshot({ ...geometry, reservedRegions: [] }),
    ),
  ).toBe(false);
  expect(hasNavigationDuoGeometry(null)).toBe(false);
  expect(
    hasNavigationDuoGeometry(
      createNavigationGeometrySnapshot({
        ...geometry,
        windowBounds: { ...geometry.windowBounds, width: 0 },
      }),
    ),
  ).toBe(false);
});
