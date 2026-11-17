import { conversationHingeLayout } from '../conversationHingeLayout';
import { createNavigationGeometrySnapshot } from '../../navigation/navigationGeometry';
import {
  dividedGeometry,
  openGeometry,
} from '../../navigation/__fixtures__/navigationOpenGeometry';

test('keeps sources and chat on opposite sides of the active seam in window coordinates', () => {
  const geometry = createNavigationGeometrySnapshot({
    ...dividedGeometry,
    hasHinge: true,
  });
  const plan = conversationHingeLayout(geometry, { x: 14, width: 964 }, 1);
  expect(plan.visible).toBe(true);
  expect(14 + plan.leading + plan.activityWidth).toBeLessThanOrEqual(450);
  expect(
    14 + plan.leading + plan.activityWidth + plan.gap,
  ).toBeGreaterThanOrEqual(490);
  expect(plan.activityWidth).toBeGreaterThanOrEqual(320);
  expect(plan.transcriptWidth).toBeGreaterThanOrEqual(320);
  expect(
    plan.leading + plan.activityWidth + plan.gap + plan.transcriptWidth,
  ).toBeLessThanOrEqual(964);
});

test('translates a consumed leading rail once and clips a contracted host', () => {
  const geometry = createNavigationGeometrySnapshot({
    ...dividedGeometry,
    hasHinge: true,
  });
  const plan = conversationHingeLayout(geometry, { x: 100, width: 800 }, 1);
  expect(plan.visible).toBe(true);
  expect(plan.leading).toBe(0);
  expect(plan.activityWidth).toBe(350);
  expect(plan.gap).toBe(40);
  expect(plan.transcriptWidth).toBe(410);
});

test('uses a safe single region when large type or a narrow host cannot fit both panels', () => {
  const geometry = createNavigationGeometrySnapshot({
    ...dividedGeometry,
    hasHinge: true,
  });
  for (const [width, scale] of [
    [964, 2],
    [400, 1],
  ]) {
    const plan = conversationHingeLayout(
      geometry,
      { x: 14, width: width! },
      scale!,
    );
    expect(plan.visible).toBe(false);
    expect(plan.activityWidth).toBe(0);
    expect(plan.transcriptWidth).toBeGreaterThan(0);
    expect(plan.leading + plan.transcriptWidth).toBeLessThanOrEqual(width!);
  }
});

test('preserves the open Duo proportion and never splits an ordinary phone', () => {
  const geometry = createNavigationGeometrySnapshot({
    ...openGeometry,
    hasHinge: true,
  });
  const plan = conversationHingeLayout(geometry, { x: 0, width: 867 }, 1);
  expect(plan.visible).toBe(true);
  expect(plan.activityWidth).toBeCloseTo(867 * 0.32);
  expect(plan.gap).toBe(0);
  expect(conversationHingeLayout(null, { x: 0, width: 1000 }, 1).visible).toBe(
    false,
  );
});

test('keeps a horizontal fold fallback inside one vertical region', () => {
  const geometry = createNavigationGeometrySnapshot({
    ...dividedGeometry,
    hasHinge: true,
    reservedRegions: [
      {
        id: 'horizontal',
        kind: 'division',
        isActive: true,
        margins: { top: 0, right: 0, bottom: 0, left: 0 },
        frame: { x: 0, y: 440, width: 1000, height: 40 },
      },
    ],
  });
  const plan = conversationHingeLayout(
    geometry,
    { x: 14, y: 40, width: 964, height: 830 },
    1,
  );
  expect(plan.visible).toBe(false);
  expect(plan.top).toBe(0);
  expect(plan.height).toBe(400);
  const lower = conversationHingeLayout(
    geometry,
    { x: 14, y: 500, width: 964, height: 300 },
    1,
  );
  expect(lower.top).toBe(0);
  expect(lower.height).toBe(300);
});

test('clips the top indicator and keyboard-contracted host without changing horizontal ownership', () => {
  const geometry = createNavigationGeometrySnapshot({
    ...dividedGeometry,
    hasHinge: true,
  });
  const plan = conversationHingeLayout(
    geometry,
    { x: 14, y: 40, width: 964, height: 300 },
    1,
  );
  expect(plan.visible).toBe(true);
  expect(plan.top).toBe(40);
  expect(plan.height).toBe(260);
});

// The shell, not a second safe-area crop, owns routed content's bottom edge.
test.each([669, 400])(
  'fills a routed %s-point host without adding height above the keyboard',
  height => {
    const geometry = createNavigationGeometrySnapshot({
      ...openGeometry,
      hasHinge: true,
    });
    const bounds = { x: 0, y: 0, width: 867, height };
    const plan = conversationHingeLayout(geometry, bounds, 1, true);
    expect(plan.top).toBe(0);
    expect(plan.height).toBe(height);
    expect(plan.transcriptWidth).toBeCloseTo(867 * 0.68);
    expect(geometry?.safeAreaInsets.bottom).toBe(34);
    expect(geometry?.safeAreaFrame.height).toBe(635);
  },
);

test('drawing through the home area still stops at an active bottom occlusion', () => {
  const geometry = createNavigationGeometrySnapshot({
    ...openGeometry,
    reservedRegions: [
      {
        id: 'bottom-occlusion',
        kind: 'occlusion',
        isActive: true,
        frame: { x: 0, y: 620, width: 951, height: 49 },
        margins: { top: 0, right: 0, bottom: 0, left: 0 },
      },
    ],
  });
  const plan = conversationHingeLayout(
    geometry,
    { x: 0, y: 0, width: 867, height: 669 },
    1,
    true,
  );
  expect(plan.height).toBe(620);
});

test('routed horizontal-fold fallback never extends through the division', () => {
  const geometry = createNavigationGeometrySnapshot({
    ...dividedGeometry,
    hasHinge: true,
    reservedRegions: [
      {
        id: 'horizontal',
        kind: 'division',
        isActive: true,
        frame: { x: 0, y: 440, width: 1000, height: 40 },
        margins: { top: 0, right: 0, bottom: 0, left: 0 },
      },
    ],
  });
  const plan = conversationHingeLayout(
    geometry,
    { x: 14, y: 40, width: 964, height: 860 },
    1,
    true,
  );
  expect(plan.visible).toBe(false);
  expect(plan.height).toBe(400);
});
