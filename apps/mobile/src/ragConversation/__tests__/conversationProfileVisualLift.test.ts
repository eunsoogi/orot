import {
  createNavigationGeometrySnapshot,
  type NavigationGeometryPayload,
  type NavigationGeometryRect,
} from '../../navigation/navigationGeometry';
import type { NavigationContentFrame } from '../../navigation/navigationContentFrame';
import { conversationProfileVisualLift } from '../conversationWorkspaceLayout';

const windowBounds = { x: 0, y: 0, width: 951, height: 669 };
const safeAreaInsets = { top: 56, right: 0, bottom: 34, left: 0 };
const topBar = { ...windowBounds, height: 40 };

function candidate(
  systemTopBarFrame: NavigationGeometryRect | undefined,
  options: {
    viewportTop?: number;
    foreign?: boolean;
    reservedRegions?: NavigationGeometryPayload['reservedRegions'];
  } = {},
) {
  const reservedRegions = options.reservedRegions ?? [];
  const geometry = createNavigationGeometrySnapshot({
    windowBounds,
    safeAreaInsets,
    reservedRegionsSupported: true,
    reservedRegions,
    systemTopBarFrame,
  });
  const frame: NavigationContentFrame = {
    windowFrame: options.foreign ? { ...windowBounds } : windowBounds,
    viewportFrame: { ...windowBounds, y: options.viewportTop ?? 0 },
    availableContentFrame: { ...windowBounds, y: 56 },
    reservedRegions,
    side: 'bottom',
    systemIndicatorAtTop: true,
    navigationFrame: null,
  };
  return conversationProfileVisualLift(geometry, frame, {
    x: 0,
    width: 335,
    y: 56,
  });
}

test('limits visual lift to observed status and route clearance', () => {
  expect(candidate(topBar)).toBe(12);
  expect(candidate({ ...topBar, height: 49 })).toBe(3);
  expect(candidate({ ...topBar, height: 54 })).toBe(0);
  expect(candidate(topBar, { viewportTop: 53 })).toBe(3);
  expect(candidate(topBar, { viewportTop: 56 })).toBe(0);
});

test('does not reuse an unknown, side, or foreign scene indicator', () => {
  expect(candidate(undefined)).toBe(0);
  expect(candidate({ x: 909, y: 0, width: 42, height: 150 })).toBe(0);
  expect(candidate(topBar, { foreign: true })).toBe(0);
});

test('keeps the visuals below active physical reservations in their lane', () => {
  const region = {
    id: 'synthetic-cutout',
    kind: 'occlusion' as const,
    frame: { x: 0, y: 36, width: 130, height: 19 },
    isActive: true,
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
  };
  expect(candidate(topBar, { reservedRegions: [region] })).toBe(0);
  expect(
    candidate(topBar, { reservedRegions: [{ ...region, isActive: false }] }),
  ).toBe(12);
  expect(
    candidate(topBar, {
      reservedRegions: [{ ...region, frame: { ...region.frame, x: 850 } }],
    }),
  ).toBe(12);
});
