import {
  createNavigationGeometrySnapshot,
  type NavigationGeometryPayload,
  type NavigationReservedRegion,
} from '../navigationGeometry';
import { resolveNavigationRootLayout } from '../navigationRootLayout';
import { leftSplitGeometry } from '../__fixtures__/navigationSplitGeometry';

const seam = leftSplitGeometry.reservedRegions[0] as NavigationReservedRegion;
const resolve = (payload: NavigationGeometryPayload) =>
  resolveNavigationRootLayout(createNavigationGeometrySnapshot(payload));

// These variations are synthetic guard tests. Only leftSplitGeometry is an
// actual window observation; mirrored input does not prove right-window behavior.
test.each([
  ['absent', []],
  ['left edge', [{ ...seam, frame: { ...seam.frame, x: 0 } }]],
  ['center', [{ ...seam, frame: { ...seam.frame, x: 220 } }]],
  [
    'multiple',
    [seam, { ...seam, id: 'another', frame: { ...seam.frame, x: 0 } }],
  ],
  ['short', [{ ...seam, frame: { ...seam.frame, height: 600 } }]],
  ['detached from edge', [{ ...seam, frame: { ...seam.frame, width: 10 } }]],
  [
    'horizontal',
    [{ ...seam, frame: { x: 0, y: 655.5, width: 469, height: 13.5 } }],
  ],
] as const)(
  'preserves the upstream right default for a %s division',
  (_name, regions) => {
    expect(
      resolve({ ...leftSplitGeometry, reservedRegions: regions }),
    ).toMatchObject({
      placement: 'right',
      reservedRightWidth: 72,
    });
  },
);

test('preserves bottom fallback when an active edge reservation leaves no complete rail segment', () => {
  // The existing native-control admission rejects the rail that intersects this
  // active strip. Choosing a side must not bypass that independent safety check.
  expect(
    resolve({
      ...leftSplitGeometry,
      reservedRegions: [{ ...seam, isActive: true }],
    }),
  ).toEqual({ placement: 'bottom', reservedRightWidth: 0 });
});

test('preserves unequal system edges and declines equal positive insets', () => {
  expect(
    resolve({
      ...leftSplitGeometry,
      safeAreaInsets: { top: 0, left: 0, right: 84, bottom: 34 },
    }),
  ).toMatchObject({ reservedRightWidth: 84 });
  expect(
    resolve({
      ...leftSplitGeometry,
      safeAreaInsets: { top: 0, left: 84, right: 0, bottom: 34 },
    }),
  ).toMatchObject({
    railSide: 'left',
    reservedLeftWidth: 84,
    reservedRightWidth: 0,
  });
  expect(
    resolve({
      ...leftSplitGeometry,
      safeAreaInsets: { top: 0, left: 10, right: 10, bottom: 34 },
    }),
  ).toMatchObject({ reservedRightWidth: 72 });
});

test('uses window-relative boundaries and consumes region margins only through the supplied frame', () => {
  const shifted: NavigationGeometryPayload = {
    ...leftSplitGeometry,
    windowBounds: { x: 40, y: 20, width: 469, height: 669 },
    reservedRegions: leftSplitGeometry.reservedRegions.map(region => ({
      ...region,
      margins: { top: 50, right: 100, bottom: 50, left: 100 },
      frame: {
        ...region.frame,
        x: region.frame.x + 40,
        y: region.frame.y + 20,
      },
    })),
  };
  expect(resolve(shifted)).toMatchObject({
    railSide: 'left',
    contentWidth: 397,
    reservedLeftWidth: 72,
    reservedRightWidth: 0,
  });
});

test('requires the seam signature, not a particular window width or an outside division', () => {
  expect(
    resolve({
      ...leftSplitGeometry,
      windowBounds: { x: 0, y: 0, width: 600, height: 800 },
      reservedRegions: [
        { ...seam, frame: { x: 586.5, y: 0, width: 13.5, height: 800 } },
      ],
    }),
  ).toMatchObject({ railSide: 'left', contentWidth: 528 });
  expect(
    resolve({
      ...leftSplitGeometry,
      reservedRegions: [seam, { ...seam, frame: { ...seam.frame, x: 900 } }],
    }),
  ).toMatchObject({ railSide: 'left', contentWidth: 397 });
  expect(resolve({ ...leftSplitGeometry, hasHinge: false }).placement).toBe(
    'bottom',
  );
});
