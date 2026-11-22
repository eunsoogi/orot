import { Animated } from 'react-native';

/** Track only bubble entrances; the independent dot loop uses a different Animated entry point. */
export function trackEntrances() {
  const start = jest.fn();
  const stop = jest.fn();
  const sequence = jest.spyOn(Animated, 'sequence').mockImplementation(() => ({
    start,
    stop,
    reset: jest.fn(),
    _startNativeLoop: jest.fn(),
    _isUsingNativeDriver: () => true,
  }));
  return { start, stop, sequence };
}
