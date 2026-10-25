import {
  observeNavigationTest,
  registerNavigationTestObserver,
} from '../navigationTestObservation';

describe('test-only navigation timeline', () => {
  it('is inert without a test entry and retains structural event order when installed', () => {
    observeNavigationTest('state-change', { nativeKeys: ['route-1'] });
    const sink = jest.fn();
    const uninstall = registerNavigationTestObserver(sink);
    observeNavigationTest('beforeRemove-permission', { permitted: true });
    observeNavigationTest('leave-state-cleanup', { routeKey: 'route-2' });
    expect(sink.mock.calls.map(([event]) => event.event)).toEqual([
      'beforeRemove-permission',
      'leave-state-cleanup',
    ]);
    expect(sink.mock.calls[0][0]).toEqual({
      event: 'beforeRemove-permission',
      permitted: true,
      atMs: expect.any(Number),
    });
    uninstall();
    observeNavigationTest('state-change', { nativeKeys: ['route-1'] });
    expect(sink).toHaveBeenCalledTimes(2);
  });

  it('never lets a failed diagnostic alter navigation and removes only its own sink', () => {
    const old = registerNavigationTestObserver(() => {
      throw new Error('observer failed');
    });
    expect(() => observeNavigationTest('state-change', {})).not.toThrow();
    const sink = jest.fn();
    const latest = registerNavigationTestObserver(sink);
    old();
    observeNavigationTest('allowance-clear', { allowance: null });
    expect(sink).toHaveBeenCalledTimes(1);
    latest();
  });
});
