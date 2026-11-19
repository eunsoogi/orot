import { observedActiveTabOverlap } from '../activeTabOverlap';
import { selectTestRoute } from '../testRoute';

const overlap = {
  sqlRun: 'synthetic-run',
  touchRun: 'synthetic-run',
  scrollRun: 'synthetic-run',
  statement: 'aggregate-1',
  result: 'row' as const,
  target: 'records' as const,
  readyTarget: 'records' as const,
  complete: true,
  sqlStarted: 100,
  sqlFinished: 200,
  touch: 150,
  visible: 155,
  scrollStarted: 160,
  scrollFinished: 180,
  scrollOwnerBefore: 'scroll-1',
  scrollOwnerAfter: 'scroll-1',
  touchID: 'touch-1',
  scrollGesture: 'touch-2',
  scrollTouchBefore: 'touch-2',
  scrollTouchAfter: 'touch-2',
  scrollBefore: 0,
  scrollAfter: 20,
};

test('requires an actual touch during SQL and a visible scroll change', () => {
  expect(observedActiveTabOverlap(overlap)).toBe(true);
  // JS promise settlement may lag the worker: a post-SQL touch cannot count.
  expect(
    observedActiveTabOverlap({ ...overlap, touch: 201, visible: 220 }),
  ).toBe(false);
  expect(observedActiveTabOverlap({ ...overlap, scrollAfter: 0 })).toBe(false);
  expect(observedActiveTabOverlap({ ...overlap, visible: 149 })).toBe(false);
  expect(observedActiveTabOverlap({ ...overlap, sqlFinished: NaN })).toBe(
    false,
  );
  expect(observedActiveTabOverlap({ ...overlap, statement: '' })).toBe(false);
  expect(observedActiveTabOverlap({ ...overlap, scrollFinished: 250 })).toBe(
    false,
  );
  expect(
    observedActiveTabOverlap({ ...overlap, scrollOwnerAfter: 'scroll-2' }),
  ).toBe(false);
  expect(
    observedActiveTabOverlap({ ...overlap, scrollTouchAfter: 'touch-3' }),
  ).toBe(false);
  expect(
    observedActiveTabOverlap({
      ...overlap,
      scrollOwnerBefore: '0',
      scrollOwnerAfter: '0',
    }),
  ).toBe(false);
  expect(
    observedActiveTabOverlap({
      ...overlap,
      scrollGesture: 'touch-1',
      scrollTouchBefore: 'touch-1',
      scrollTouchAfter: 'touch-1',
    }),
  ).toBe(false);
  expect(
    observedActiveTabOverlap({ ...overlap, readyTarget: 'overview' }),
  ).toBe(false);
  expect(observedActiveTabOverlap({ ...overlap, complete: false })).toBe(false);
  expect(observedActiveTabOverlap({ ...overlap, scrollRun: 'other-run' })).toBe(
    false,
  );
  expect(observedActiveTabOverlap({ ...overlap, result: 'error' })).toBe(false);
  expect(observedActiveTabOverlap({ ...overlap, visible: 5000 })).toBe(false);
});

test('selects the workload only by the explicit test scenario', () => {
  expect(selectTestRoute({ OROT_TEST_SCENARIO: 'active-tab-workload' })).toBe(
    'active-tab-workload',
  );
  expect(selectTestRoute({})).toBe('core');
});
