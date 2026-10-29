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
  [openGeometry, 84, 867, 136, 18],
  [rotatedGeometry, 72, 597, 94, 12],
] as const)(
  'allocates content and a rail inside continuous measured Open space',
  (payload, reservedRightWidth, contentWidth, railTopInset, railRightInset) => {
    const geometry = createNavigationGeometrySnapshot(payload);
    expect(geometry?.usableRegions).toEqual([geometry?.safeAreaFrame]);
    expect(layout(payload)).toEqual({
      placement: 'right',
      reservedRightWidth,
      contentWidth,
      windowHeight: payload.windowBounds.height,
      railTopInset,
      railBottomInset: 46,
      railRightInset,
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

test('does not deduct the rail twice from an already safe readable column', () => {
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
  ).toBe('right');
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

// The content safe edge excludes the system lane; the custom bar can use it
// below active indicators without carving that same lane out a second time.
test('places the rail outside the right content safe edge with a real indicator gap', () => {
  const result = layout(openGeometry);
  expect(result.placement).toBe('right');
  if (result.placement !== 'right') throw new Error('Expected a rail');
  const railRight = openGeometry.windowBounds.width - result.railRightInset;
  expect(railRight).toBe(933);
  expect(railRight - 48).toBe(885);
  expect(result.contentWidth).toBe(867);
  expect(result.railTopInset).toBe(124 + 12);
});

test('keeps window origin translations out of local rail insets', () => {
  const offsetX = 37;
  const offsetY = 19;
  const shifted = {
    ...openGeometry,
    windowBounds: { ...openGeometry.windowBounds, x: offsetX, y: offsetY },
    reservedRegions: openGeometry.reservedRegions.map(region => ({
      ...region,
      frame: {
        ...region.frame,
        x: region.frame.x + offsetX,
        y: region.frame.y + offsetY,
      },
    })),
  };
  expect(layout(shifted)).toEqual(layout(openGeometry));
});

test('uses expanded reserved frames without applying their included margins again', () => {
  const indicator = openGeometry.reservedRegions[2]!;
  expect(
    layout({
      ...openGeometry,
      reservedRegions: [
        openGeometry.reservedRegions[0]!,
        {
          ...indicator,
          frame: { ...indicator.frame, height: 180 },
          margins: { top: 10, right: 20, bottom: 24, left: 20 },
        },
      ],
    }),
  ).toEqual(
    expect.objectContaining({
      placement: 'right',
      railTopInset: 192,
      railRightInset: 18,
      contentWidth: 867,
    }),
  );
});

test('does not reserve the rail again inside an already contracted content viewport', () => {
  expect(
    layout({
      ...openGeometry,
      viewportBounds: { x: 24, y: 10, width: 843, height: 625 },
    }),
  ).toEqual(
    expect.objectContaining({
      placement: 'right',
      contentWidth: 843,
      reservedRightWidth: 0,
      systemBottomInset: 0,
      railRightInset: 18,
      railTopInset: 136,
    }),
  );
});
