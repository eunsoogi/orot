import {
  createNavigationGeometrySnapshot,
  type NavigationGeometryPayload,
} from '../navigationGeometry';

const bounds = { x: 0, y: 0, width: 400, height: 800 };
const noInsets = { top: 0, right: 0, bottom: 0, left: 0 };

test('retains four safe-area edges on systems without reserved-region support', () => {
  const geometry = createNavigationGeometrySnapshot({
    windowBounds: { x: 5, y: 7, width: 400, height: 800 },
    safeAreaInsets: { top: 20, right: 12, bottom: 30, left: 8 },
    reservedRegionsSupported: false,
    reservedRegions: [],
  });

  expect(geometry).toMatchObject({
    reservedRegionsSupported: false,
    reservedRegions: [],
    safeAreaFrame: { x: 13, y: 27, width: 380, height: 750 },
    usableRegions: [{ x: 13, y: 27, width: 380, height: 750 }],
  });
});

test('splits the safe area around an active division using its actual frame', () => {
  const geometry = createNavigationGeometrySnapshot({
    windowBounds: bounds,
    safeAreaInsets: { top: 24, right: 10, bottom: 30, left: 10 },
    reservedRegionsSupported: true,
    reservedRegions: [
      {
        id: 'fold',
        kind: 'division',
        frame: { x: 195, y: 0, width: 10, height: 800 },
        margins: noInsets,
        isActive: true,
      },
    ],
  });

  expect(geometry?.usableRegions).toEqual([
    { x: 10, y: 24, width: 185, height: 746 },
    { x: 205, y: 24, width: 185, height: 746 },
  ]);
});

test('keeps inactive reservations visible without removing usable space', () => {
  const geometry = createNavigationGeometrySnapshot({
    windowBounds: bounds,
    safeAreaInsets: noInsets,
    reservedRegionsSupported: true,
    reservedRegions: [
      {
        id: 'fold',
        kind: 'division',
        frame: { x: 190, y: 0, width: 20, height: 800 },
        margins: noInsets,
        isActive: false,
      },
    ],
  });

  expect(geometry?.reservedRegions).toHaveLength(1);
  expect(geometry?.usableRegions).toEqual([bounds]);
});

test('subtracts an occlusion frame once because its native frame includes margins', () => {
  const payload: NavigationGeometryPayload = {
    windowBounds: bounds,
    safeAreaInsets: { top: 20, right: 0, bottom: 20, left: 0 },
    reservedRegionsSupported: true,
    reservedRegions: [
      {
        id: 'camera',
        kind: 'occlusion',
        frame: { x: 350, y: 20, width: 50, height: 40 },
        margins: { top: 5, right: 5, bottom: 5, left: 5 },
        isActive: true,
      },
    ],
  };

  expect(createNavigationGeometrySnapshot(payload)?.usableRegions).toEqual([
    { x: 0, y: 20, width: 350, height: 40 },
    { x: 0, y: 60, width: 400, height: 720 },
  ]);
});

test('rejects invalid native measurements instead of publishing stale geometry', () => {
  expect(
    createNavigationGeometrySnapshot({
      windowBounds: { ...bounds, width: Number.NaN },
      safeAreaInsets: noInsets,
      reservedRegionsSupported: false,
      reservedRegions: [],
    }),
  ).toBeNull();
});

test('clips content to the measured viewport without relabeling it as the window', () => {
  const geometry = createNavigationGeometrySnapshot({
    windowBounds: { x: 0, y: 0, width: 951, height: 669 },
    viewportBounds: { x: 24, y: 10, width: 843, height: 625 },
    safeAreaInsets: { top: 0, right: 84, bottom: 34, left: 0 },
    reservedRegionsSupported: true,
    reservedRegions: [],
  });
  expect(geometry?.safeAreaFrame).toEqual({
    x: 0,
    y: 0,
    width: 867,
    height: 635,
  });
  expect(geometry?.usableRegions).toEqual([
    { x: 24, y: 10, width: 843, height: 625 },
  ]);
  expect(geometry?.windowBounds.width).toBe(951);
});

test.each([
  { x: 0, y: 0, width: Number.NaN, height: 10 },
  { x: 0, y: 0, width: -1, height: 10 },
])('rejects malformed explicit viewport bounds', viewportBounds => {
  expect(
    createNavigationGeometrySnapshot({
      windowBounds: bounds,
      viewportBounds,
      safeAreaInsets: noInsets,
      reservedRegionsSupported: true,
      reservedRegions: [],
    }),
  ).toBeNull();
});
