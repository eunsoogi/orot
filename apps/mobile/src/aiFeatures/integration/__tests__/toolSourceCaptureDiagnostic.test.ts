import { NativeModules } from 'react-native';
import { observeCapturedToolSource } from '../toolSourceCaptureDiagnostic';
import { RetainedSourceInvalidError } from '../retainedSourceError';

afterEach(() => {
  delete NativeModules.OrotProviderDiagnostics;
});

test.each([
  ['The cited source changed before saving.', 'tool_cited_changed'],
  ['Conversation photos require their request owner.', 'tool_photo_owner'],
  [
    'The filtered tool source cannot be retained as a new citation.',
    'tool_filter_rejected',
  ],
  ['The generated source changed before saving.', 'tool_generated_changed'],
  ['The generated source identity is invalid.', 'tool_generated_identity'],
  [
    'The generated summary has incomplete input lineage.',
    'tool_generated_lineage',
  ],
  ['The attached photo changed before saving.', 'tool_photo_changed'],
  ['The generated parent changed or was removed.', 'tool_parent_changed'],
  ['The generated parent cannot be retained.', 'tool_parent_invalid'],
  ['private unknown text', 'other'],
  ['The cited source changed before saving. private suffix', 'other'],
  ['__proto__', 'other'],
])('emits only the exact closed category for %s', async (message, code) => {
  const report = jest.fn();
  NativeModules.OrotProviderDiagnostics = { report };
  const error = new RetainedSourceInvalidError(message);
  await expect(
    observeCapturedToolSource('personal_record', async () => {
      throw error;
    }),
  ).rejects.toBe(error);
  expect(report.mock.calls).toEqual([
    ['storage', 'tool_capture_personal', code],
  ]);
});

test.each([
  ['personal_record', 'tool_capture_personal'],
  ['reviewed_memory', 'tool_capture_memory'],
  ['generated_artifact', 'tool_capture_generated'],
  ['external_medical', 'tool_capture_external'],
] as const)(
  'uses the fixed %s kind without reading source identifiers',
  async (kind, stage) => {
    const report = jest.fn();
    NativeModules.OrotProviderDiagnostics = { report };
    const error = new Error('private value');
    await expect(
      observeCapturedToolSource(kind, async () => {
        throw error;
      }),
    ).rejects.toBe(error);
    expect(report.mock.calls).toEqual([['storage', stage, 'other']]);
  },
);

test('success is silent and a throwing diagnostic sink preserves the original error', async () => {
  const report = jest.fn(() => {
    throw new Error('sink');
  });
  NativeModules.OrotProviderDiagnostics = { report };
  const value = { private: 'synthetic data' };
  expect(
    await observeCapturedToolSource('personal_record', async () => value),
  ).toBe(value);
  expect(report).not.toHaveBeenCalled();
  const error = new Error('private error');
  await expect(
    observeCapturedToolSource('personal_record', async () => {
      throw error;
    }),
  ).rejects.toBe(error);
});
