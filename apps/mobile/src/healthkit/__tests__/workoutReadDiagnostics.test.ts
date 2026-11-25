import { NativeModules } from 'react-native';
import { workoutReadDiagnostics } from '../workoutReadDiagnostics';

const original = NativeModules.OrotProviderDiagnostics;

afterEach(() => {
  NativeModules.OrotProviderDiagnostics = original;
});

test('disabled tracing does not attach work or emit tokens', async () => {
  const sink = jest.fn();
  NativeModules.OrotProviderDiagnostics = { enabled: false, report: sink };
  const read = Promise.resolve({ syntheticValue: 'only for the listener' });
  const trace = workoutReadDiagnostics('records');
  const witnessed = trace.observe('cohort', () => read);
  expect(witnessed).toBe(read);
  await expect(witnessed).resolves.toBe(await read);
  expect(sink).not.toHaveBeenCalled();
});

test('trace reports fixed stages without data or errors and preserves rejected work', async () => {
  const sink = jest.fn();
  NativeModules.OrotProviderDiagnostics = { enabled: true, report: sink };
  const trace = workoutReadDiagnostics('overview');
  const original = new Error('synthetic message must not be logged');
  await expect(
    trace.observe('database', () => Promise.reject(original)),
  ).rejects.toBe(original);
  const payload = { syntheticID: 'must stay local' };
  await expect(
    trace.observe(
      'cohort',
      () => Promise.resolve(payload),
      () => false,
    ),
  ).resolves.toBe(payload);
  expect(sink.mock.calls).toEqual([
    ['workout_period', 'overview_database', 'started'],
    ['workout_period', 'overview_database', 'failed'],
    ['workout_period', 'overview_cohort', 'started'],
    ['workout_period', 'overview_cohort', 'cancelled'],
  ]);
});

test('observer failure or an independently changing witness cannot replace the result', async () => {
  NativeModules.OrotProviderDiagnostics = {
    enabled: true,
    report() {
      throw new Error('test sink failed');
    },
  };
  await expect(
    workoutReadDiagnostics('shared').observe(
      'cohort',
      () => Promise.resolve('synthetic'),
      () => {
        throw new Error('optional classification failed');
      },
    ),
  ).resolves.toBe('synthetic');
});
