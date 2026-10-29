import {
  createNavigationGeometrySnapshot,
  type NavigationGeometryPayload,
} from '../navigationGeometry';
import { resolveNavigationRootLayout } from '../navigationRootLayout';
import { resolveNavigationContentFrame } from '../navigationContentFrame';

// Synthetic window inputs exercise publication order; these are not observed
// Duo multitasking dimensions or a policy for choosing its system-side edge.
const right: NavigationGeometryPayload = {
  windowBounds: { x: 0, y: 0, width: 600, height: 800 },
  safeAreaInsets: { top: 0, left: 0, right: 84, bottom: 34 },
  reservedRegionsSupported: true,
  reservedRegions: [],
  hasHinge: true,
  navigationSide: 'right',
  navigationWidth: 48,
  navigationFrame: { x: 534, y: 240, width: 48, height: 276 },
};
const left: NavigationGeometryPayload = {
  ...right,
  safeAreaInsets: { ...right.safeAreaInsets, left: 84, right: 0 },
  navigationSide: 'left',
  navigationFrame: { x: 18, y: 240, width: 48, height: 276 },
};

function resolve(payload: NavigationGeometryPayload) {
  const geometry = createNavigationGeometrySnapshot(payload);
  const candidate = resolveNavigationRootLayout(geometry);
  return {
    candidate,
    shared: resolveNavigationContentFrame(geometry, candidate),
  };
}

test('retains actual measured controls until a new native side arrives, then releases the former lane', () => {
  expect(resolve(right).shared).toMatchObject({
    side: 'right',
    availableContentFrame: { x: 0, width: 516 },
  });
  const pending = resolve({
    ...left,
    navigationSide: right.navigationSide,
    navigationFrame: right.navigationFrame,
  });
  expect(pending.candidate).toMatchObject({ railSide: 'left' });
  // A candidate alone cannot prove that mounted controls have moved. Preserve
  // their measurement instead of claiming a new frame from safe-area inputs.
  expect(pending.shared).toMatchObject({
    side: 'right',
    navigationFrame: right.navigationFrame,
    availableContentFrame: { x: 84, width: 444 },
  });
  expect(resolve(left).shared).toMatchObject({
    side: 'left',
    navigationFrame: left.navigationFrame,
    availableContentFrame: { x: 84, width: 516 },
  });
  expect(resolve(right).shared).toMatchObject({
    side: 'right',
    navigationFrame: right.navigationFrame,
    availableContentFrame: { x: 0, width: 516 },
  });
});

test('honors a freshly measured bottom fallback before returning to a side rail', () => {
  const fallback = resolve({
    ...left,
    navigationSide: 'bottom',
    navigationWidth: undefined,
    navigationFrame: { x: 100, y: 450, width: 480, height: 48 },
  });
  expect(fallback.candidate).toMatchObject({ railSide: 'left' });
  expect(fallback.shared).toMatchObject({
    side: 'bottom',
    availableContentFrame: { x: 84, width: 516 },
  });
  expect(resolve(right).shared?.side).toBe('right');
});

test('uses a new window size and viewport without retaining an opposite inset', () => {
  const narrowed = resolve({
    ...left,
    windowBounds: { x: 0, y: 0, width: 500, height: 800 },
    viewportBounds: { x: 0, y: 0, width: 500, height: 460 },
  });
  expect(narrowed.shared?.availableContentFrame).toEqual({
    x: 84,
    y: 0,
    width: 416,
    height: 460,
  });
  expect(resolve(right).shared?.availableContentFrame).toEqual({
    x: 0,
    y: 0,
    width: 516,
    height: 766,
  });
});
