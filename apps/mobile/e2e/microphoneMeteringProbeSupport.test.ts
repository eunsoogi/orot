import { NativeModules } from 'react-native';
import {
  addMeterSample,
  emptyMeterStats,
  meteringProbeModule,
} from './microphoneMeteringProbeSupport';

test('empty and silent observations do not manufacture microphone activity', () => {
  const empty = emptyMeterStats();
  expect(empty).toEqual({ samples: 0, min: null, max: null, nonzero: 0 });
  expect(addMeterSample(addMeterSample(empty, 0), 0)).toEqual({
    samples: 2,
    min: 0,
    max: 0,
    nonzero: 0,
  });
  expect(empty.samples).toBe(0);
});

test('statistics preserve the actual observed range and sample count', () => {
  const result = [0.02, 0.5, 0.1, 0].reduce(addMeterSample, emptyMeterStats());
  expect(result).toEqual({ samples: 4, min: 0, max: 0.5, nonzero: 3 });
});

test('an ordinary build without the diagnostic module has no fallback', () => {
  expect(NativeModules.RecordingMeteringProbeModule).toBeUndefined();
  expect(() => meteringProbeModule()).toThrow('METERING_UNAVAILABLE');
});
