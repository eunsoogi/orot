import {
  createNavigationGeometrySnapshot,
  type NavigationGeometryPayload,
} from '../navigationGeometry';
import {
  resolveNavigationRootLayout,
  type NavigationRootLayout,
} from '../navigationRootLayout';

const bounds = { x: 0, y: 0, width: 1000, height: 900 };
const insets = { top: 40, right: 0, bottom: 30, left: 0 };
const noMargins = { top: 0, right: 0, bottom: 0, left: 0 };

function snapshot(changes: Partial<NavigationGeometryPayload> = {}) {
  const payload: NavigationGeometryPayload = {
    windowBounds: bounds,
    safeAreaInsets: insets,
    reservedRegionsSupported: true,
    reservedRegions: [
      {
        id: 'display-division',
        kind: 'division',
        frame: { x: 450, y: 0, width: 40, height: 900 },
        margins: noMargins,
        isActive: true,
      },
      {
        id: 'top-indicator',
        kind: 'occlusion',
        frame: { x: 760, y: 0, width: 100, height: 80 },
        margins: noMargins,
        isActive: true,
      },
    ],
    ...changes,
  };
  const result = createNavigationGeometrySnapshot(payload);
  if (!result) throw new Error('Expected valid navigation geometry');
  return result;
}

test('uses the right rail only when live panels can support content and controls', () => {
  expect(resolveNavigationRootLayout(snapshot())).toEqual({
    placement: 'right',
    reservedRightWidth: 72,
    contentWidth: 928,
    windowHeight: 900,
    railTopInset: 92,
    railBottomInset: 42,
    railRightInset: 12,
    systemBottomInset: 30,
  });
});

test('keeps bottom navigation when an active division leaves a narrow column', () => {
  const narrow = snapshot({
    reservedRegions: [
      {
        id: 'display-division',
        kind: 'division',
        frame: { x: 280, y: 0, width: 40, height: 900 },
        margins: noMargins,
        isActive: true,
      },
    ],
  });
  expect(resolveNavigationRootLayout(narrow)).toEqual({
    placement: 'bottom',
    reservedRightWidth: 0,
  });
});

test('keeps bottom navigation for horizontal and unsupported geometry', () => {
  const horizontal = snapshot({
    reservedRegions: [
      {
        id: 'display-division',
        kind: 'division',
        frame: { x: 0, y: 430, width: 1000, height: 40 },
        margins: noMargins,
        isActive: true,
      },
    ],
  });
  expect(resolveNavigationRootLayout(horizontal).placement).toBe('bottom');
  expect(
    resolveNavigationRootLayout({
      ...snapshot(),
      reservedRegionsSupported: false,
    }),
  ).toEqual({ placement: 'bottom', reservedRightWidth: 0 });
});

test('moves the upper action below the current usable-region boundary', () => {
  const expanded = snapshot({
    reservedRegions: [
      {
        id: 'display-division',
        kind: 'division',
        frame: { x: 450, y: 0, width: 40, height: 900 },
        margins: noMargins,
        isActive: true,
      },
      {
        id: 'top-indicator',
        kind: 'occlusion',
        frame: { x: 760, y: 0, width: 100, height: 120 },
        margins: noMargins,
        isActive: true,
      },
    ],
  });
  const layout: NavigationRootLayout = resolveNavigationRootLayout(expanded);
  expect(layout).toEqual(expect.objectContaining({ railTopInset: 132 }));
});

test('keeps bottom navigation when the full rail cannot fit below reserved regions', () => {
  const shortWindow = snapshot({
    windowBounds: { x: 0, y: 0, width: 1000, height: 400 },
    safeAreaInsets: { top: 40, right: 0, bottom: 30, left: 0 },
    reservedRegions: [
      {
        id: 'display-division',
        kind: 'division',
        frame: { x: 450, y: 0, width: 40, height: 400 },
        margins: noMargins,
        isActive: true,
      },
      {
        id: 'top-indicator',
        kind: 'occlusion',
        frame: { x: 760, y: 0, width: 100, height: 120 },
        margins: noMargins,
        isActive: true,
      },
    ],
  });

  expect(resolveNavigationRootLayout(shortWindow)).toEqual({
    placement: 'bottom',
    reservedRightWidth: 0,
  });
});
