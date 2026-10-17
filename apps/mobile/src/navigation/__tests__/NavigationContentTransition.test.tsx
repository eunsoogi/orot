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

test('keeps only the latest root tab transition when rapid taps interrupt a fade', async () => {
  const view = await render(transition('home', 'Home'));
  expect(screen.getByText('Home')).toBeVisible();

  await view.rerender(transition('records', 'Records'));
  await view.rerender(transition('schedule', 'Schedule'));
  expect(pendingAnimations).toHaveLength(2);
  expect(pendingAnimations[0]?.stop).toHaveBeenCalled();
  expect(pendingAnimations[0]?.toValue).toBe(0);
  expect(pendingAnimations[1]?.toValue).toBe(0);
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
  expect(pendingAnimations[2]?.toValue).toBe(1);
  expect(pendingAnimations[2]?.duration).toBe(140);
  await act(async () => {
    pendingAnimations[2]?.complete({ finished: true });
  });
  expect(screen.getByText('Schedule')).toBeVisible();
});

test('fades out the latest rendered content when the displayed tab props change', async () => {
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

test('restores full opacity when rapid navigation returns to the still-displayed tab', async () => {
  const view = await render(transition('home', 'Home'));
  await view.rerender(transition('records', 'Records'));
  const fadeOut = pendingAnimations[0]!;
  let opacity = 1;
  const listener = fadeOut.value.addListener(state => {
    opacity = state.value;
  });
  // Represent a real intermediate frame, rather than treating cancellation as if nothing moved.
  await act(async () => {
    fadeOut.value.setValue(0.4);
  });
  await view.rerender(transition('home', 'Home'));
  expect(opacity).toBe(1);
  expect(fadeOut.stop).toHaveBeenCalled();
  await act(async () => {
    fadeOut.complete({ finished: true });
  });
  expect(screen.getByText('Home')).toBeVisible();
  expect(screen.queryByText('Records')).toBeNull();
  fadeOut.value.removeListener(listener);
});

test('settles the latest content if Reduce Motion changes during a fade', async () => {
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
