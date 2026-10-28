import {
  createNavigationGeometrySnapshot,
  type NavigationGeometryPayload,
} from '../navigationGeometry';
import { resolveNavigationRootLayout } from '../navigationRootLayout';
import { resolveNavigationContentFrame } from '../navigationContentFrame';
import { openGeometry } from '../__fixtures__/navigationOpenGeometry';

function frame(payload: NavigationGeometryPayload) {
  const geometry = createNavigationGeometrySnapshot(payload);
  return resolveNavigationContentFrame(
    geometry,
    resolveNavigationRootLayout(geometry),
  );
}

test('shares the native window and content bounds without subtracting the safe side twice', () => {
  expect(frame(openGeometry)).toMatchObject({
    windowFrame: openGeometry.windowBounds,
    reservedRegions: openGeometry.reservedRegions,
    side: 'right',
    navigationFrame: null,
    availableContentFrame: { x: 0, y: 0, width: 867, height: 635 },
  });
  expect(
    frame({
      ...openGeometry,
      viewportBounds: { x: 24, y: 10, width: 843, height: 625 },
    })?.availableContentFrame,
  ).toEqual({ x: 24, y: 10, width: 843, height: 625 });
});

test('carries measured control width and frame instead of resizing content from an assumed bar', () => {
  const measuredFrame = { x: 879, y: 240, width: 60, height: 276 };
  expect(
    frame({
      ...openGeometry,
      navigationWidth: 60,
      navigationFrame: measuredFrame,
    }),
  ).toMatchObject({
    navigationFrame: measuredFrame,
    availableContentFrame: { x: 0, y: 0, width: 867, height: 635 },
  });
});

test('mirrors the system side without changing window coordinates for left-side windows', () => {
  const reflected: NavigationGeometryPayload = {
    ...openGeometry,
    hasHinge: true,
    safeAreaInsets: { top: 0, left: 84, right: 0, bottom: 34 },
    reservedRegions: openGeometry.reservedRegions.map(region => ({
      ...region,
      frame: { ...region.frame, x: 951 - region.frame.x - region.frame.width },
    })),
  };
  expect(frame(reflected)).toMatchObject({
    side: 'left',
    availableContentFrame: { x: 84, y: 0, width: 867, height: 635 },
  });
  expect(
    resolveNavigationRootLayout(createNavigationGeometrySnapshot(reflected)),
  ).toMatchObject({
    railSide: 'left',
    reservedLeftWidth: 84,
    reservedRightWidth: 0,
    railRightInset: 18,
    railTopInset: 136,
  });
});

test('ordinary iPhones retain bottom placement even with reserved-region API support', () => {
  expect(frame({ ...openGeometry, hasHinge: false })).toMatchObject({
    side: 'bottom',
  });
});

test('clips the shared available frame to the measured keyboard-contracted content host', () => {
  const geometry = createNavigationGeometrySnapshot(openGeometry);
  expect(
    resolveNavigationContentFrame(
      geometry,
      resolveNavigationRootLayout(geometry),
      { x: 0, y: 0, width: 867, height: 420 },
    )?.availableContentFrame,
  ).toEqual({ x: 0, y: 0, width: 867, height: 420 });
});

test('shares the observed bottom fallback while candidate rail admission stays available', () => {
  const geometry = createNavigationGeometrySnapshot({
    ...openGeometry,
    navigationSide: 'bottom',
    navigationFrame: { x: 16, y: 300, width: 835, height: 60 },
  });
  const candidate = resolveNavigationRootLayout(geometry);
  expect(candidate.placement).toBe('right');
  expect(resolveNavigationContentFrame(geometry, candidate)?.side).toBe(
    'bottom',
  );
});
