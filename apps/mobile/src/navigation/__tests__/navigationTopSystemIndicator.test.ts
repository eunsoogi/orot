import { openGeometry } from '../__fixtures__/navigationOpenGeometry';
import { resolveNavigationContentFrame } from '../navigationContentFrame';
import { createNavigationGeometrySnapshot } from '../navigationGeometry';
import { resolveNavigationRootLayout } from '../navigationRootLayout';

const topFrame = { x: 0, y: 0, width: 951, height: 42 };
const staleRail = { x: 880, y: 178, width: 48, height: 260 };
const baseline = {
  ...openGeometry,
  navigationSide: 'right',
  navigationFrame: staleRail,
} as const;

function resolve(systemTopBarFrame?: typeof topFrame, measured = false) {
  const geometry = createNavigationGeometrySnapshot({
    ...baseline,
    systemTopBarFrame,
  });
  const root = resolveNavigationRootLayout(geometry);
  return {
    root,
    content: resolveNavigationContentFrame(
      geometry,
      root,
      measured ? { x: 0, y: 0, width: 951, height: 500 } : undefined,
    ),
  };
}

test('uses the positively observed top system band instead of a stale side rail at identical window dimensions', () => {
  const side = resolve();
  expect(side.root.placement).toBe('right');
  expect(side.content).toMatchObject({
    side: 'right',
    navigationFrame: staleRail,
  });

  const top = resolve(topFrame, true);
  expect(top.root.placement).toBe('bottom');
  expect(top.content).toMatchObject({
    side: 'bottom',
    navigationFrame: null,
    systemIndicatorAtTop: true,
    availableContentFrame: { y: 42, height: 458 },
  });
  expect(resolve()).toEqual(side);
});

test.each([
  { x: 907, y: 0, width: 44, height: 174 },
  { x: 0, y: 0, width: 80, height: 42 },
  { x: 0, y: 10, width: 951, height: 42 },
  { x: 0, y: 0, width: 0, height: 0 },
  { x: 0, y: 0, width: 951, height: Number.NaN },
])(
  'falls back for an absent or geometrically ambiguous top band (%o)',
  frame => {
    expect(resolve(frame)).toEqual(resolve());
  },
);
