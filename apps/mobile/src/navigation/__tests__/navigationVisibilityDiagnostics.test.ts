import { createNavigationFrameDiagnostic } from '../navigationVisibilityDiagnostics';
import { resolveNavigationContentFrame } from '../navigationContentFrame';
import { createNavigationGeometrySnapshot } from '../navigationGeometry';
import { resolveNavigationRootLayout } from '../navigationRootLayout';

test('distinguishes a collapsed planned route underneath a retained native rail', () => {
  const windowBounds = { x: 0, y: 0, width: 466, height: 678 };
  const geometry = createNavigationGeometrySnapshot({
    windowBounds,
    safeAreaInsets: { top: 40, right: 0, bottom: 34, left: 0 },
    reservedRegionsSupported: false,
    reservedRegions: [],
    navigationSide: 'right',
    navigationWidth: 48,
  });
  const layout = resolveNavigationRootLayout(geometry);
  // Model the measurable discriminator, not a claim that iOS actually
  // emitted this transient, non-intersecting sample on the device.
  const stale = resolveNavigationContentFrame(
    geometry,
    layout,
    { x: 0, y: 0, width: 466, height: 30 },
    true,
  );
  const restored = resolveNavigationContentFrame(
    geometry,
    layout,
    windowBounds,
    true,
  );
  expect(stale?.side).toBe('right');
  expect(stale?.availableContentFrame.height).toBe(0);
  expect(restored?.availableContentFrame.height).toBeGreaterThan(0);

  const report = jest.fn();
  const record = createNavigationFrameDiagnostic(report);
  record(stale?.availableContentFrame, null, 'background');
  record(stale?.availableContentFrame, null, 'background');
  record(stale?.availableContentFrame, { width: 390, height: 0 }, 'active');
  record(
    restored?.availableContentFrame,
    { width: 390, height: 638 },
    'active',
  );
  record(
    restored?.availableContentFrame,
    { width: 389, height: 637 },
    'active',
  );
  expect(report.mock.calls).toEqual([
    ['foreground', 'background'],
    ['planned_frame', 'collapsed'],
    ['native_frame', 'missing'],
    ['foreground', 'active'],
    ['planned_frame', 'collapsed'],
    ['native_frame', 'collapsed'],
    ['planned_frame', 'positive'],
    ['native_frame', 'positive'],
  ]);
});
