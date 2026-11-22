import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Animated, Pressable, StyleSheet } from 'react-native';
import { ClassificationMovingStage } from '../ClassificationMovingStage';

afterEach(() => {
  jest.restoreAllMocks();
});

test('keeps faded results and retry confirmation out of touch and accessibility until each reveal owns the stage', async () => {
  const timing = jest.mocked(Animated.timing);
  const fallback = timing.getMockImplementation()!;
  const reveal: (() => void)[] = [];
  timing.mockImplementation((value, config) => {
    if (config.duration !== 140) return fallback(value, config);
    return {
      start: callback => {
        reveal.push(() => callback?.({ finished: true }));
      },
      stop: jest.fn(),
      reset: jest.fn(),
    };
  });
  const restart = jest.fn();
  const draw = (stage: 'progress' | 'results' | 'confirmation') => (
    <ClassificationMovingStage
      stage={stage}
      classified={1}
      total={2}
      saving={false}
      onRestart={restart}
    >
      {() => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={stage}
          testID="destination"
          onPress={restart}
        />
      )}
    </ClassificationMovingStage>
  );
  const view = await render(draw('progress'));
  await fireEvent(screen.getByTestId('classification-moving-stage'), 'layout', {
    nativeEvent: { layout: { width: 300, height: 132 } },
  });
  const footprint = () =>
    StyleSheet.flatten(
      screen.getByTestId('classification-circle-slot').props.style,
    ).width;
  expect(footprint()).toBe(44);
  await view.rerender(draw('results'));
  expect(footprint()).toBe(44);
  const concealed = () => {
    expect(screen.queryByTestId('destination')).toBeNull();
    const container = screen.getByTestId('destination', {
      includeHiddenElements: true,
    }).parent;
    expect(container?.props.pointerEvents).toBe('none');
    expect(container?.props.accessibilityElementsHidden).toBe(true);
    expect(container?.props.importantForAccessibility).toBe(
      'no-hide-descendants',
    );
  };
  concealed();
  expect(screen.getByRole('button', { name: '다시 분류하기' })).toBeDisabled();
  await act(async () => reveal[0]!());
  expect(screen.getByRole('button', { name: 'results' })).toBeEnabled();
  await view.rerender(draw('confirmation'));
  concealed();
  await act(async () => reveal[0]!());
  concealed();
  await act(async () => reveal[1]!());
  expect(screen.getByRole('button', { name: 'confirmation' })).toBeEnabled();
  await view.rerender(draw('progress'));
  expect(screen.queryByTestId('destination')).toBeNull();
  expect(footprint()).toBe(44);
});
