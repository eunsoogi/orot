import { NativeModules } from 'react-native';
import { observeToolRetention } from '../conversationToolRetentionDiagnostic';
import { captureConversationToolSources } from '../../aiFeatures/integration/captureConversationToolSources';
import { LocalEvidenceReferenceRegistry } from '../../aiFeatures/integration/evidenceRegistry';
import type { ConversationToolEvent } from '@orot/agent-runtime';

afterEach(() => {
  delete NativeModules.OrotProviderDiagnostics;
});
test.each([
  ['Tool source is unavailable.', 'tool_capture_alias'],
  ['Tool research source is unavailable.', 'tool_capture_research_shape'],
  ['Photo tool sources are unsupported.', 'tool_capture_photo_unsupported'],
  ['Filtered tool source is unavailable.', 'tool_capture_filtered_unavailable'],
  ['Tool source is unavailable. private suffix', 'tool_capture_other'],
  ['Private unexpected error', 'tool_capture_other'],
])(
  'capture diagnostic preserves failure and emits only an exact known code',
  async (message, code) => {
    const report = jest.fn();
    NativeModules.OrotProviderDiagnostics = { report };
    const error = new Error(message);
    await expect(
      observeToolRetention('tool_event_capture', async () => {
        throw error;
      }),
    ).rejects.toBe(error);
    expect(report.mock.calls).toEqual([
      ['storage', 'tool_event_capture', 'started'],
      ['storage', 'tool_event_capture', 'failed'],
      ['storage', 'tool_event_capture', code],
    ]);
  },
);

test('the real missing-alias capture path fails rather than saving an unbound source', async () => {
  const report = jest.fn();
  NativeModules.OrotProviderDiagnostics = { report };
  const event = {
    sources: [{ sourceKind: 'personal_record', sourceId: 'private-synthetic' }],
  } as unknown as ConversationToolEvent;
  await expect(
    observeToolRetention('tool_event_capture', () =>
      captureConversationToolSources(
        event,
        new LocalEvidenceReferenceRegistry(),
      ),
    ),
  ).rejects.toThrow('Tool source is unavailable.');
  expect(report.mock.calls.map(call => call[2])).toEqual([
    'started',
    'failed',
    'tool_capture_alias',
  ]);
  expect(JSON.stringify(report.mock.calls)).not.toContain('private-synthetic');
});

test('sink errors do not replace capture errors and write failures do not claim capture failure', async () => {
  const error = new Error('Tool source is unavailable.');
  NativeModules.OrotProviderDiagnostics = {
    report: () => {
      throw new Error('sink');
    },
  };
  await expect(
    observeToolRetention('tool_event_capture', async () => {
      throw error;
    }),
  ).rejects.toBe(error);
  const report = jest.fn();
  NativeModules.OrotProviderDiagnostics = { report };
  await expect(
    observeToolRetention('tool_event_write', async () => {
      throw error;
    }),
  ).rejects.toBe(error);
  expect(report.mock.calls).toEqual([
    ['storage', 'tool_event_write', 'started'],
    ['storage', 'tool_event_write', 'failed'],
  ]);
});
