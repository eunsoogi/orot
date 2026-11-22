import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Animated, Dimensions, StyleSheet, View } from 'react-native';
import {
  openGeometry,
  rotatedGeometry,
  dividedGeometry,
} from '../../navigation/__fixtures__/navigationOpenGeometry';
import { NavigationGeometryProvider } from '../../navigation/NavigationGeometryProvider';
import {
  createNavigationGeometrySnapshot,
  type NavigationGeometryPayload,
} from '../../navigation/navigationGeometry';
import { isClassificationExpandedDuo } from '../classificationExpandedDuo';
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

const folded: NavigationGeometryPayload = {
  windowBounds: { x: 0, y: 0, width: 466, height: 678 },
  safeAreaInsets: { top: 0, left: 0, right: 84, bottom: 34 },
  reservedRegionsSupported: true,
  hasHinge: true,
  reservedRegions: [],
};

test.each([
  { width: 342, windowWidth: 390, windowHeight: 844, height: 524, side: false },
  {
    width: 334,
    windowWidth: 466,
    windowHeight: 678,
    height: 402,
    side: false,
    geometry: folded,
  },
  {
    width: 819,
    windowWidth: 951,
    windowHeight: 669,
    height: 404,
    side: true,
    geometry: openGeometry,
  },
  {
    width: 537,
    windowWidth: 669,
    windowHeight: 951,
    height: 620,
    side: true,
    geometry: rotatedGeometry,
  },
])(
  'keeps one circle during travel and withholds the list until it settles ($width point lane)',
  async ({ width, windowWidth, windowHeight, height, side, geometry }) => {
    await act(async () =>
      Dimensions.set({
        window: {
          width: windowWidth,
          height: windowHeight,
          scale: 2,
          fontScale: 1,
        },
        screen: {
          width: windowWidth,
          height: windowHeight,
          scale: 2,
          fontScale: 1,
        },
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
      <NavigationGeometryProvider>
        <NavigationMotionContext.Provider value={reduced}>
          <ClassificationMovingStage
            stage={stage}
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
                style={{
                  marginLeft: dock.listStart,
                  marginTop: dock.captionTop,
                }}
              />
            )}
          </ClassificationMovingStage>
        </NavigationMotionContext.Provider>
      </NavigationGeometryProvider>
    );
    const view = await render(draw('progress'));
    if (geometry) {
      await fireEvent(
        screen.getByTestId('navigation-window-geometry-sensor'),
        'geometryChange',
        { nativeEvent: geometry },
      );
    }
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
    expect(center).toEqual([0, expect.any(Number)]);
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
    await view.rerender(draw('confirmation'));
    expect(slides).toHaveLength(2);
    expect(screen.queryByTestId('synthetic-list')).toBeNull();
    await act(async () => slides[1]!.value.setValue(0.5));
    expect(position()).toEqual(intermediate);
    await act(async () => slides[1]!.finish());
    expect(position()).toEqual(center);
    await view.rerender(draw('progress'));
    expect(slides).toHaveLength(2);
    expect(screen.queryByTestId('synthetic-list')).toBeNull();
    expect(screen.getByRole('progressbar').props.accessibilityValue.now).toBe(
      37,
    );
    await act(async () => slides[0]!.finish());
    await view.rerender(draw('progress', true));
    expect(position()).toEqual(center);
    expect(slides[1]!.stop).toHaveBeenCalled();
  },
);

test('requires flat native division on the current window and enough usable room', () => {
  const expanded = createNavigationGeometrySnapshot(openGeometry);
  const current = { width: 951, height: 669 };
  expect(isClassificationExpandedDuo(expanded, current)).toBe(true);
  expect(
    isClassificationExpandedDuo(expanded, { width: 951, height: 540 }),
  ).toBe(false);
  expect(
    isClassificationExpandedDuo(expanded, { width: 466, height: 678 }),
  ).toBe(false);
  expect(
    isClassificationExpandedDuo(expanded, { width: 678, height: 466 }),
  ).toBe(false);
  expect(isClassificationExpandedDuo(null, current)).toBe(false);
  expect(
    isClassificationExpandedDuo(
      createNavigationGeometrySnapshot(dividedGeometry),
      dividedGeometry.windowBounds,
    ),
  ).toBe(false);
  const dock = classificationDockGeometry(819, 402, 1, true);
  const left = (819 - dock.size) / 2 + dock.x;
  expect(left).toBe(32);
  expect(dock.size).toBe(160);
  expect(classificationDockGeometry(334, 402, 1).size).toBe(dock.size);
  expect(dock.listStart - left - dock.size).toBe(44);
  expect(classificationDockGeometry(361, 504, 1, true).side).toBe(false);
  expect(classificationDockGeometry(500, 504, 2, true).side).toBe(false);
  expect(classificationDockGeometry(700, 125, 1, true).side).toBe(false);
  expect(classificationDockGeometry(819, 402, 1, false).side).toBe(false);
});

test('adds folded vertical clearance only when the original circle and a complete row still fit', () => {
  expect(classificationDockGeometry(334, 402, 1)).toMatchObject({
    size: 160,
    centerOffset: 16,
    captionTop: 200,
    bottomInset: 16,
  });
  const constrained = classificationDockGeometry(334, 276, 1.6);
  expect(constrained.size).toBeCloseTo(96.8);
  expect(constrained).toMatchObject({ centerOffset: 11, bottomInset: 11 });
  expect(
    276 - constrained.captionTop - constrained.bottomInset,
  ).toBeGreaterThanOrEqual(136);
  expect(classificationDockGeometry(430, 402, 1, true)).toMatchObject({
    side: true,
    size: 160,
    listStart: 216,
  });
  expect(classificationDockGeometry(334, 125, 2)).toMatchObject({
    inline: true,
    centerOffset: 0,
    bottomInset: 0,
  });
});
