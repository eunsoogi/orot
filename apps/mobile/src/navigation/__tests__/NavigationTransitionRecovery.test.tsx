import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Animated, AppState, Dimensions, Text, TextInput } from 'react-native';
import { NavigationContentTransition } from '../NavigationContentTransition';

type Completion = (result: { finished: boolean }) => void;
const motions: { value: Animated.Value; complete: Completion }[] = [];
let foreground: () => void;
let resize: () => void;
const removals: jest.Mock[] = [];

beforeEach(() => {
  motions.length = 0;
  removals.length = 0;
  jest.spyOn(Animated, 'timing').mockImplementation((value, _config) => ({
    start: callback =>
      motions.push({
        value: value as Animated.Value,
        complete: callback ?? (() => undefined),
      }),
    stop: jest.fn(),
    reset: jest.fn(),
  }));
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, callback) => {
      foreground = () => callback('active');
      const remove = jest.fn();
      removals.push(remove);
      return { remove };
    });
  jest
    .spyOn(Dimensions, 'addEventListener')
    .mockImplementation((_event, callback) => {
      resize = () =>
        callback({
          window: { width: 400, height: 700, scale: 3, fontScale: 1 },
          screen: { width: 900, height: 700, scale: 3, fontScale: 1 },
        });
      const remove = jest.fn();
      removals.push(remove);
      return { remove };
    });
});
afterEach(() => jest.restoreAllMocks());

function Draft() {
  const [text, setText] = useState('synthetic saved draft');
  return (
    <TextInput testID="retained-draft" value={text} onChangeText={setText} />
  );
}
function view(key: string) {
  return (
    <NavigationContentTransition transitionKey={key}>
      {key === 'conversation' ? <Draft /> : <Text>{key}</Text>}
    </NavigationContentTransition>
  );
}
function expectUnlocked() {
  const root = screen.getByTestId('navigation-content-transition');
  expect(root.props.pointerEvents).toBe('auto');
  expect(root.props.accessibilityElementsHidden).toBe(false);
}

// Reflow/resume changes presentation only, with no remount, request, or data reset.
test.each(['resize', 'foreground'] as const)(
  '%s uncovers the entering tab and preserves its edited draft',
  async event => {
    const rendered = await render(view('records'));
    await rendered.rerender(view('conversation'));
    await act(() => motions[0]!.complete({ finished: true }));
    let veil = 1;
    const listener = motions[0]!.value.addListener(value => {
      veil = value.value;
    });
    const input = screen.getByTestId('retained-draft', {
      includeHiddenElements: true,
    });
    await fireEvent.changeText(input, 'edited synthetic draft');
    await act(() => (event === 'resize' ? resize() : foreground()));
    expectUnlocked();
    expect(veil).toBe(0);
    motions[0]!.value.removeListener(listener);
    expect(screen.getByTestId('retained-draft')).toBe(input);
    expect(input.props.value).toBe('edited synthetic draft');
    // A queued native callback from before recovery cannot cover/unlock newer work.
    await rendered.rerender(view('settings'));
    await act(() => motions[1]!.complete({ finished: true }));
    expect(
      screen.getByTestId('navigation-content-transition', {
        includeHiddenElements: true,
      }).props.pointerEvents,
    ).toBe('none');
    await act(() => motions[2]!.complete({ finished: true }));
    await act(() => motions[3]!.complete({ finished: true }));
    expect(screen.getByText('settings')).toBeVisible();
    await rendered.unmount();
    expect(removals.every(remove => remove.mock.calls.length === 1)).toBe(true);
  },
);

test('an interrupted outgoing fade settles the latest selected tab', async () => {
  const rendered = await render(view('records'));
  await rendered.rerender(view('conversation'));
  await act(() => motions[0]!.value.setValue(0.8));
  await act(() => motions[0]!.complete({ finished: false }));
  expectUnlocked();
  expect(screen.getByTestId('retained-draft').props.value).toBe(
    'synthetic saved draft',
  );
  expect(screen.queryByText('records')).toBeNull();
});

test('repeated resize and resume without navigation do not remount the current draft', async () => {
  await render(view('conversation'));
  const input = screen.getByTestId('retained-draft');
  await fireEvent.changeText(input, 'keep this unsent draft');
  await act(() => {
    resize();
    foreground();
    resize();
    foreground();
  });
  expect(screen.getByTestId('retained-draft')).toBe(input);
  expect(input.props.value).toBe('keep this unsent draft');
  expectUnlocked();
  expect(motions).toHaveLength(0);
});

test.each(['resize', 'foreground'] as const)(
  '%s settles the outgoing phase even if native completion never arrives',
  async event => {
    const rendered = await render(view('records'));
    await rendered.rerender(view('conversation'));
    await act(() => motions[0]!.value.setValue(1));
    await act(() => (event === 'resize' ? resize() : foreground()));
    expectUnlocked();
    expect(screen.getByTestId('retained-draft').props.value).toBe(
      'synthetic saved draft',
    );
    await act(() => motions[0]!.complete({ finished: true }));
    expectUnlocked();
    expect(motions).toHaveLength(1);
  },
);
