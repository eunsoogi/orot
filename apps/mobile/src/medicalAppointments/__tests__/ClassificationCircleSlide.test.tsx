import { act, fireEvent, render, screen } from '@testing-library/react-native';
import {
  Animated,
  Dimensions,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { NavigationMotionContext } from '../../navigation/NavigationMotionContext';
import { ClassificationMovingStage } from '../ClassificationMovingStage';
import { classificationDockGeometry } from '../ClassificationCircle';

const originalDimensions = {
  window: Dimensions.get('window'),
  screen: Dimensions.get('screen'),
};
afterEach(async () => {
  jest.restoreAllMocks();
  await act(async () => Dimensions.set(originalDimensions));
});

test.each([
  { width: 342, windowWidth: 390, height: 524, side: false },
  { width: 346, windowWidth: 466, height: 504, side: true },
  { width: 662, windowWidth: 700, height: 404, side: true },
])(
  'keeps one circle during travel and withholds the list until it settles ($width point lane)',
  async ({ width, windowWidth, height, side }) => {
    await act(async () =>
      Dimensions.set({
        window: { width: windowWidth, height, scale: 2, fontScale: 1 },
        screen: { width: windowWidth, height, scale: 2, fontScale: 1 },
      }),
    );
    const timing = jest.mocked(Animated.timing);
    const fallback = timing.getMockImplementation()!;
    const slides: {
      value: Animated.Value;
      finish: () => void;
      stop: jest.Mock;
    }[] = [];
    timing.mockImplementation((value, config) => {
      if (config.duration !== 200) return fallback(value, config);
      const stop = jest.fn();
      return {
        start: callback =>
          slides.push({
            value: value as Animated.Value,
            stop,
            finish: () => callback?.({ finished: true }),
          }),
        stop,
        reset: jest.fn(),
      };
    });
    const restart = jest.fn();
    const draw = (
      stage: 'progress' | 'results' | 'confirmation',
      reduced = false,
    ) => (
      <NavigationMotionContext.Provider value={reduced}>
        <ClassificationMovingStage
          stage={stage}
          confirmingRestart={stage === 'confirmation'}
          classified={3}
          total={8}
          saving={false}
          onRestart={restart}
        >
          {dock => (
            <View
              testID={
                stage === 'results' ? 'synthetic-list' : 'synthetic-confirm'
              }
              style={{ marginLeft: dock.listStart, marginTop: dock.captionTop }}
            />
          )}
        </ClassificationMovingStage>
      </NavigationMotionContext.Provider>
    );
    const view = await render(draw('progress'));
    await fireEvent(
      screen.getByTestId('classification-moving-stage'),
      'layout',
      {
        nativeEvent: { layout: { width, height } },
      },
    );
    const host = screen.getByTestId('classification-circle-slot');
    const position = () => {
      const style = StyleSheet.flatten(host.props.style);
      const [{ translateX }, { translateY }] = style.transform;
      return [translateX, translateY];
    };
    const center = position();
    expect(center[0]).toBe(0);
    expect(center[1]).toBeGreaterThan(0);
    await view.rerender(draw('results'));
    expect(screen.getByTestId('classification-circle-slot')).toBe(host);
    expect(screen.queryByTestId('synthetic-list')).toBeNull();
    expect(screen.queryByRole('button', { name: '다시 분류하기' })).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
    await act(async () => slides[0]!.value.setValue(0.5));
    const intermediate = position();
    if (side) {
      expect(intermediate[0]).toBeLessThan(0);
      expect(intermediate[1]).toBe(center[1]);
    } else {
      expect(intermediate[0]).toBe(0);
      expect(intermediate[1]).toBeLessThan(center[1]!);
      expect(intermediate[1]).toBeGreaterThan(0);
    }
    await act(async () => slides[0]!.finish());
    expect(
      screen.getByTestId('synthetic-list').props.style.marginLeft > 0,
    ).toBe(side);
    await fireEvent.press(
      screen.getByRole('button', { name: '다시 분류하기' }),
    );
    expect(restart).toHaveBeenCalledTimes(1);
    await view.rerender(draw('confirmation'));
    expect(slides).toHaveLength(1);
    expect(screen.queryByTestId('synthetic-list')).toBeNull();
    await view.rerender(draw('progress'));
    expect(slides).toHaveLength(2);
    expect(screen.queryByTestId('synthetic-list')).toBeNull();
    expect(screen.getByRole('progressbar').props.accessibilityValue.now).toBe(
      37,
    );
    await act(async () => slides[0]!.finish());
    expect(screen.queryByTestId('synthetic-list')).toBeNull();
    await view.rerender(draw('progress', true));
    expect(position()).toEqual(center);
    expect(slides[1]!.stop).toHaveBeenCalled();
  },
);

test('reserves enough measured width for readable results even with scaled text and a short pane', () => {
  const duo = classificationDockGeometry(346, 504, 1, 466);
  expect(duo.side).toBe(true);
  expect(duo.size).toBe(106);
  expect(346 - duo.listStart).toBe(224);
  expect(classificationDockGeometry(346, 504, 1, 430).side).toBe(false);
  expect(classificationDockGeometry(346, 504, 1.7, 466).side).toBe(false);
  expect(classificationDockGeometry(700, 125, 1).side).toBe(false);
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
      confirmingRestart={stage === 'confirmation'}
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
