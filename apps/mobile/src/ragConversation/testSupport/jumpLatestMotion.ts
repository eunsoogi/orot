import { Animated } from 'react-native';
import { jumpLatestFadeDuration } from '../ConversationJumpToLatest';

/** Let geometry tests settle only this decorative motion. Dedicated tests hold the callbacks. */
export function trackJumpLatestMotion(instant = false) {
  const realTiming = Animated.timing;
  const transitions: {
    target: number;
    stop: jest.Mock;
    finish: (finished?: boolean) => void;
  }[] = [];
  jest.spyOn(Animated, 'timing').mockImplementation((value, config) => {
    if (
      config.duration !== jumpLatestFadeDuration ||
      (config.toValue !== 0 && config.toValue !== 1)
    )
      return realTiming(value, config);
    let complete: Parameters<ReturnType<typeof Animated.timing>['start']>[0];
    const stop = jest.fn();
    const finish = (finished = true) => complete?.({ finished });
    transitions.push({ target: config.toValue, stop, finish });
    return {
      start(callback) {
        complete = callback;
        if (instant) finish();
      },
      stop,
      reset() {},
      _startNativeLoop() {},
      _isUsingNativeDriver: () => config.useNativeDriver,
    };
  });
  return transitions;
}
