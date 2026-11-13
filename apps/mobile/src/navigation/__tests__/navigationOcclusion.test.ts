import {
  BOTTOM_NAVIGATION_CONTENT_INSET,
  resolveNavigationOcclusion,
} from '../navigationLayout';

const systemInsets = { top: 40, right: 84, bottom: 34, left: 0 };
const rail = {
  placement: 'right' as const,
  reservedRightWidth: 84,
  systemBottomInset: 34,
  systemInsets,
  measuredBottomActionOcclusion: null,
};

// These synthetic geometry inputs prove inset ownership, not native point bounds.
test('does not reserve an absent bottom navigation bar while a rail is awaiting measurement', () => {
  const result = resolveNavigationOcclusion(rail);
  expect(result.viewportInsets).toEqual({
    top: 0,
    right: 84,
    bottom: 34,
    left: 0,
  });
  expect(result.scrollContentInsets.bottom).toBe(0);
});

test('keeps clearance for an actual bottom action alongside a side rail', () => {
  expect(
    resolveNavigationOcclusion({ ...rail, measuredBottomActionOcclusion: 42 })
      .scrollContentInsets.bottom,
  ).toBe(42);
});

test('preserves conservative bottom navigation clearance and later measured keyboard overlap', () => {
  const bottom = { ...rail, placement: 'bottom' as const };
  expect(resolveNavigationOcclusion(bottom).scrollContentInsets.bottom).toBe(
    BOTTOM_NAVIGATION_CONTENT_INSET + 34,
  );
  expect(
    resolveNavigationOcclusion({ ...bottom, measuredBottomActionOcclusion: 60 })
      .scrollContentInsets.bottom,
  ).toBe(60);
});
