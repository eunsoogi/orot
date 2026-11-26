import { NativeModules } from 'react-native';
import { startLiveCommonHealthTiming } from '../liveCommonHealthTiming';

test.each([
  [false, 20, false],
  [true, 20.9, true],
  [true, -1, false],
  [true, 300_001, false],
  [true, Infinity, false],
] as const)(
  'timing is opt-in, monotonic and bounded: enabled=%s elapsed=%s',
  (enabled, elapsed, expected) => {
    const previous = NativeModules.OrotProviderDiagnostics;
    const report = jest.fn();
    const clock = jest
      .spyOn(performance, 'now')
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(10 + elapsed);
    NativeModules.OrotProviderDiagnostics = { enabled, report };
    try {
      startLiveCommonHealthTiming('data_open')();
      if (expected)
        expect(report).toHaveBeenCalledWith('live_health', 'data_open', '20');
      else expect(report).not.toHaveBeenCalled();
      if (!enabled) expect(clock).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore();
      NativeModules.OrotProviderDiagnostics = previous;
    }
  },
);
