/* global beforeEach, jest */

const { Animated } = require('react-native');

/** Settles short route transitions so app tests see final tabs while motion tests supply their own driver. */
const navigationAnimationDurations = new Set([90, 140]);
const originalTiming = Animated.timing.bind(Animated);

beforeEach(() => {
  jest.spyOn(Animated, 'timing').mockImplementation((value, config) => {
    if (!navigationAnimationDurations.has(config.duration)) {
      return originalTiming(value, config);
    }

    return {
      start: callback => {
        value.setValue(config.toValue);
        callback?.({ finished: true });
      },
      stop: () => undefined,
      reset: () => undefined,
    };
  });
});
