import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { createNavigationController } from '../navigationController';
import {
  EdgeSwipeBackRegion,
  requestBackAfterEdgeGesture,
  shouldClaimEdgeBackGesture,
  shouldCompleteEdgeBackGesture,
} from '../EdgeSwipeBackRegion';

const event = { nativeEvent: {} } as never;

describe('left-edge back gesture', () => {
  it('claims a rightward gesture only when it starts at the left edge', () => {
    expect(
      shouldClaimEdgeBackGesture(
        { x0: 12, dx: 24, dy: 4 },
        { canGoBack: true, isTransitioning: false },
      ),
    ).toBe(true);
    expect(
      shouldClaimEdgeBackGesture(
        { x0: 48, dx: 24, dy: 4 },
        { canGoBack: true, isTransitioning: false },
      ),
    ).toBe(false);
    expect(
      shouldClaimEdgeBackGesture(
        { x0: 12, dx: -100, dy: 2 },
        { canGoBack: true, isTransitioning: false },
      ),
    ).toBe(false);
  });

  it('lets vertical scrolling, root routes, and pending transitions keep control', () => {
    expect(
      shouldClaimEdgeBackGesture(
        { x0: 8, dx: 12, dy: 40 },
        { canGoBack: true, isTransitioning: false },
      ),
    ).toBe(false);
    expect(
      shouldClaimEdgeBackGesture(
        { x0: 8, dx: 24, dy: 2 },
        { canGoBack: false, isTransitioning: false },
      ),
    ).toBe(false);
    expect(
      shouldClaimEdgeBackGesture(
        { x0: 8, dx: 24, dy: 2 },
        { canGoBack: true, isTransitioning: true },
      ),
    ).toBe(false);
  });

  it('does not navigate on a short or cancelled gesture', async () => {
    expect(shouldCompleteEdgeBackGesture({ dx: 40, dy: 2 })).toBe(false);
    expect(shouldCompleteEdgeBackGesture({ dx: 120, dy: 100 })).toBe(false);

    const controller = createNavigationController<'home' | 'details'>('home');
    controller.push('details');
    const { getByTestId } = await render(
      <EdgeSwipeBackRegion controller={controller}>
        <Text>Details</Text>
      </EdgeSwipeBackRegion>,
    );
    const region = getByTestId('edge-swipe-back-region');

    region.props.onResponderTerminate?.(event);
    expect(controller.getSnapshot().currentRoute.name).toBe('details');
  });

  it('calls the controller back path only after a completed edge swipe', async () => {
    const controller = createNavigationController<'home' | 'details'>('home');
    const detail = controller.push('details');
    if (!detail) throw new Error('Details route was unexpectedly rejected.');
    controller.registerLeaveGuard(detail.key, async () => true);
    const requestBack = jest.spyOn(controller, 'requestBack');

    await expect(
      requestBackAfterEdgeGesture(controller, {
        dx: 120,
        dy: 4,
      }),
    ).resolves.toBe(true);

    expect(requestBack).toHaveBeenCalledTimes(1);
  });
});
