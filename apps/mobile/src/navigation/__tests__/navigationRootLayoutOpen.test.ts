import {
  createNavigationGeometrySnapshot,
  type NavigationGeometryPayload,
} from '../navigationGeometry';
import { resolveNavigationRootLayout } from '../navigationRootLayout';

import {
  openGeometry,
  rotatedGeometry,
} from '../__fixtures__/navigationOpenGeometry';

function layout(payload: NavigationGeometryPayload) {
  const geometry = createNavigationGeometrySnapshot(payload);
  if (!geometry) throw new Error('Expected valid source regression geometry');
  return resolveNavigationRootLayout(geometry);
}

test.each([
  [openGeometry, 144, 807, 12],
  [rotatedGeometry, 60, 609, 94],
] as const)(
  'allocates content and a rail inside continuous measured Open space',
  (payload, reservedRightWidth, contentWidth, railTopInset) => {
    const geometry = createNavigationGeometrySnapshot(payload);
    expect(geometry?.usableRegions).toEqual([geometry?.safeAreaFrame]);
    expect(layout(payload)).toEqual({
      placement: 'right',
      reservedRightWidth,
      contentWidth,
      windowHeight: payload.windowBounds.height,
      railTopInset,
      railBottomInset: 46,
      railRightInset: reservedRightWidth - 48,
      systemBottomInset: 34,
    });
  },
);

test('retains ordinary-phone placement without a native division', () => {
  expect(layout({ ...openGeometry, reservedRegions: [] }).placement).toBe(
    'bottom',
  );
});

test.each([
  { x: 951, y: 0, width: 40, height: 669 },
  { x: 0, y: -40, width: 951, height: 40 },
  { x: 400, y: 0, width: 0, height: 669 },
  { x: 0, y: 400, width: 951, height: 0 },
])('ignores inactive divisions with no area inside the window', frame => {
  expect(
    layout({
      ...openGeometry,
      reservedRegions: [{ ...openGeometry.reservedRegions[0]!, frame }],
    }).placement,
  ).toBe('bottom');
});

test('keeps bottom placement when continuous space cannot hold readable content beside the rail', () => {
  expect(
    layout({
      ...openGeometry,
      windowBounds: { x: 0, y: 0, width: 450, height: 669 },
      reservedRegions: [
        {
          ...openGeometry.reservedRegions[0]!,
          frame: { x: 200, y: 0, width: 40, height: 669 },
        },
      ],
    }).placement,
  ).toBe('bottom');
});

test('keeps the rail below actual active occlusion in a continuous region', () => {
  expect(
    layout({
      ...rotatedGeometry,
      reservedRegions: [
        rotatedGeometry.reservedRegions[0]!,
        {
          ...rotatedGeometry.reservedRegions[2]!,
          frame: { x: 525, y: 0, width: 144, height: 180 },
        },
      ],
    }),
  ).toEqual(expect.objectContaining({ placement: 'right', railTopInset: 192 }));
});

test.each([
  { x: 525, y: 0, width: 144, height: 700 },
  { x: 609, y: 82, width: 60, height: 835 },
])(
  'keeps bottom placement when active occlusion leaves no complete rail segment',
  frame => {
    expect(
      layout({
        ...rotatedGeometry,
        reservedRegions: [
          rotatedGeometry.reservedRegions[0]!,
          { ...rotatedGeometry.reservedRegions[2]!, frame },
        ],
      }).placement,
    ).toBe('bottom');
  },
);
