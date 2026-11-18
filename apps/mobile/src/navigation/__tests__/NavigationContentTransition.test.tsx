import { act, render, screen } from '@testing-library/react-native';
import { Animated, Text } from 'react-native';
import { NavigationContentTransition } from '../NavigationContentTransition';
import { NavigationMotionContext } from '../NavigationMotionContext';

type AnimationResult = { readonly finished: boolean };
type PendingAnimation = {
  readonly value: Animated.Value;
  readonly toValue: number;
  readonly duration: number | undefined;
  readonly complete: (result: AnimationResult) => void;
  readonly stop: jest.Mock;
};

const pendingAnimations: PendingAnimation[] = [];

beforeEach(() => {
  pendingAnimations.length = 0;
  jest.spyOn(Animated, 'timing').mockImplementation((value, config) => {
    const stop = jest.fn();
    return {
      start: (callback?: (result: AnimationResult) => void) => {
        pendingAnimations.push({
          value: value as Animated.Value,
          toValue: config.toValue as number,
          duration: config.duration,
          complete: callback ?? (() => undefined),
          stop,
        });
      },
      stop,
      reset: jest.fn(),
    } as unknown as Animated.CompositeAnimation;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function transition(key: string, label: string, reduceMotion = false) {
  return (
    <NavigationMotionContext.Provider value={reduceMotion}>
      <NavigationContentTransition transitionKey={key}>
        <Text>{label}</Text>
      </NavigationContentTransition>
    </NavigationMotionContext.Provider>
  );
}

test('keeps only the latest root tab transition when rapid taps interrupt fading', async () => {
  const view = await render(transition('home', 'Home'));
  expect(screen.getByText('Home')).toBeVisible();

  await view.rerender(transition('records', 'Records'));
  await view.rerender(transition('schedule', 'Schedule'));
  expect(pendingAnimations).toHaveLength(2);
  expect(pendingAnimations[0]?.stop).toHaveBeenCalled();
  expect(pendingAnimations[0]?.toValue).toBe(1);
  expect(pendingAnimations[1]?.toValue).toBe(1);
  expect(
    screen.getByText('Home', { includeHiddenElements: true }),
  ).toBeTruthy();
  expect(screen.queryByText('Records')).toBeNull();

  await act(async () => {
    pendingAnimations[0]?.complete({ finished: true });
  });
  expect(
    screen.getByText('Home', { includeHiddenElements: true }),
  ).toBeTruthy();

  await act(async () => {
    pendingAnimations[1]?.complete({ finished: true });
  });
  expect(
    screen.getByText('Schedule', { includeHiddenElements: true }),
  ).toBeTruthy();
  expect(screen.queryByText('Records')).toBeNull();
  expect(pendingAnimations[2]?.toValue).toBe(0);
  expect(pendingAnimations[2]?.duration).toBe(200);
  await act(async () => {
    pendingAnimations[2]?.complete({ finished: true });
  });
  expect(screen.getByText('Schedule')).toBeVisible();
});

test('fades the latest rendered content when the displayed tab props change', async () => {
  const view = await render(transition('home', 'Home loading'));
  await view.rerender(transition('home', 'Home ready'));
  expect(screen.getByText('Home ready')).toBeVisible();

  await view.rerender(transition('records', 'Records'));

  expect(
    screen.getByText('Home ready', { includeHiddenElements: true }),
  ).toBeTruthy();
  expect(screen.queryByText('Home loading')).toBeNull();
  expect(screen.queryByText('Records')).toBeNull();
  await act(async () => {
    pendingAnimations[0]?.complete({ finished: true });
  });
  expect(
    screen.getByText('Records', { includeHiddenElements: true }),
  ).toBeTruthy();
});

test('switches immediately without animation when Reduce Motion is enabled', async () => {
  const view = await render(transition('home', 'Home'));
  await view.rerender(transition('records', 'Records', true));

  expect(screen.queryByText('Home')).toBeNull();
  expect(screen.getByText('Records')).toBeVisible();
  expect(Animated.timing).not.toHaveBeenCalled();
});

test('restores the uncovered content when rapid navigation returns to the still-displayed tab', async () => {
  const view = await render(transition('home', 'Home'));
  await view.rerender(transition('records', 'Records'));
  const fadeOut = pendingAnimations[0]!;
  let offset = 0;
  const listener = fadeOut.value.addListener(state => {
    offset = state.value;
  });
  // Represent a real intermediate frame, rather than treating cancellation as if nothing moved.
  await act(async () => {
    fadeOut.value.setValue(0.4);
  });
  await view.rerender(transition('home', 'Home'));
  expect(offset).toBe(0);
  expect(fadeOut.stop).toHaveBeenCalled();
  await act(async () => {
    fadeOut.complete({ finished: true });
  });
  expect(screen.getByText('Home')).toBeVisible();
  expect(screen.queryByText('Records')).toBeNull();
  fadeOut.value.removeListener(listener);
});

test('settles the latest content if Reduce Motion changes during fading', async () => {
  const view = await render(transition('home', 'Home'));
  await view.rerender(transition('records', 'Records'));
  await view.rerender(transition('schedule', 'Schedule', true));
  await act(async () => {
    pendingAnimations[0]!.complete({ finished: true });
  });
  expect(screen.getByText('Schedule')).toBeVisible();
  expect(screen.queryByText('Home')).toBeNull();
  expect(screen.queryByText('Records')).toBeNull();
  expect(pendingAnimations).toHaveLength(1);
});

// UIKit materials must never be mounted inside a fading ancestor.
test('keeps glass ancestors fully opaque throughout root transitions', async () => {
  const view = await render(transition('home', 'Home'));
  await view.rerender(transition('records', 'Records'));
  await act(async () => {
    pendingAnimations[0]?.value.setValue(0.5);
  });
  const root = screen.getByTestId('navigation-content-transition', {
    includeHiddenElements: true,
  });
  expect(root).toHaveStyle({ opacity: 1 });
  await act(async () => {
    pendingAnimations[0]?.complete({ finished: true });
  });
  expect(
    screen.getByTestId('navigation-content-transition', {
      includeHiddenElements: true,
    }),
  ).toHaveStyle({ opacity: 1 });
});

test('an obsolete enter completion cannot unlock a newer destination', async () => {
  const view = await render(transition('home', 'Home'));
  await view.rerender(transition('records', 'Records'));
  await act(async () => pendingAnimations[0]!.complete({ finished: true }));
  const obsoleteEnter = pendingAnimations[1]!;
  await view.rerender(transition('schedule', 'Schedule'));
  await act(async () => pendingAnimations[2]!.complete({ finished: true }));
  await act(async () => obsoleteEnter.complete({ finished: true }));
  expect(
    screen.getByTestId('navigation-content-transition', {
      includeHiddenElements: true,
    }).props.pointerEvents,
  ).toBe('none');
  await act(async () => pendingAnimations[3]!.complete({ finished: true }));
  expect(screen.getByText('Schedule')).toBeVisible();
});

test('fades through a sibling veil without translating either screen', async () => {
  const view = await render(transition('home', 'Home'));
  await view.rerender(transition('records', 'Records'));
  const root = screen.getByTestId('navigation-content-transition', {
    includeHiddenElements: true,
  });
  expect(root.props.style).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({ transform: expect.anything() }),
    ]),
  );
  const veil = screen.getByTestId('navigation-fade-veil', {
    includeHiddenElements: true,
  });
  expect(veil.props.pointerEvents).toBe('none');
  expect(veil.props.accessibilityElementsHidden).toBe(true);
  expect(pendingAnimations[0]).toMatchObject({ toValue: 1, duration: 100 });
  await act(async () => pendingAnimations[0]!.complete({ finished: true }));
  expect(pendingAnimations[1]).toMatchObject({ toValue: 0, duration: 200 });
  expect(
    screen.queryByText('Home', { includeHiddenElements: true }),
  ).toBeNull();
});

// A native driver may report interruption without a newer React tab transition.
test('an interrupted incoming fade uncovers the mounted destination', async () => {
  const view = await render(transition('home', 'Home'));
  await view.rerender(transition('records', 'Records'));
  await act(() => pendingAnimations[0]!.complete({ finished: true }));
  await act(() => pendingAnimations[1]!.complete({ finished: false }));
  expect(screen.getByText('Records')).toBeVisible();
  expect(
    screen.getByTestId('navigation-content-transition').props.pointerEvents,
  ).toBe('auto');
});
