import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { NativeModules } from 'react-native';
import type { AgentMemoryService } from '@orot/agent-memory';
import type { RecordRepository } from '@orot/storage';
import RecordingLibraryPanel from '../RecordingLibraryPanel';
import { createRecordingLibraryService } from '../recordingLibraryService';
import { withRecordingDeletionTiming } from '../recordingDeletionTiming';
import { processRecordingDeletionProbe } from '../processRecordingDeletionProbe';
import { savedSource } from '../recordingScreenSupport';
import {
  confirmNativeDeletion,
  mockNativeDeletionAlert,
} from '../testSupport/nativeDeletionAlert';

test('the real recording screen distinguishes SQL commit from held audio cleanup in opt-in process diagnostics', async () => {
  const previous = NativeModules.OrotProviderDiagnostics;
  const report = jest.fn();
  NativeModules.OrotProviderDiagnostics = { enabled: true, report };
  const alert = mockNativeDeletionAlert();
  let release!: () => void;
  const cleanup = new Promise<void>(resolve => {
    release = resolve;
  });
  let persisted = true;
  // Native I/O is held after the protected source cascade receipt; the screen and service are real.
  const service = createRecordingLibraryService({
    loadRepository: async () =>
      ({
        list: async () => (persisted ? [savedSource] : []),
        get: async () => (persisted ? savedSource : null),
      }) as unknown as RecordRepository,
    assertRecordingStopped: async () => {},
    openMemory: async () => ({}) as AgentMemoryService,
    removeSource: async (_source, _memory, probe) =>
      withRecordingDeletionTiming(probe, 'database-delete-commit', async () => {
        persisted = false;
        return { sourceDeleted: true, memoriesDeleted: 0 };
      }),
    audioDeletion: {
      stage: async () => {},
      commit: () => cleanup,
      reconcile: async () => {},
      restore: async () => {},
    },
  });
  const calls = () => report.mock.calls;
  try {
    await render(
      <RecordingLibraryPanel
        service={{
          list: service.list,
          deleteRecording: service.deleteRecording,
        }}
      />,
    );
    await fireEvent.press(
      await screen.findByTestId(`recording-delete-${savedSource.id}`),
    );
    await confirmNativeDeletion(alert);
    await waitFor(() =>
      expect(calls()).toContainEqual([
        'recording_delete',
        'audio_cleanup',
        'started',
      ]),
    );
    expect(calls()).toContainEqual([
      'recording_delete',
      'database_delete_commit',
      'completed',
    ]);
    expect(calls()).toContainEqual([
      'recording_delete',
      'busy_committed',
      'completed',
    ]);
    expect(calls()).not.toContainEqual([
      'recording_delete',
      'audio_cleanup',
      'completed',
    ]);
    expect(calls()).not.toContainEqual([
      'recording_delete',
      'busy_settled',
      'completed',
    ]);
    expect(
      await screen.findByTestId('recording-delete-progress'),
    ).toBeVisible();

    await act(async () => {
      release();
      await cleanup;
    });
    await waitFor(() =>
      expect(calls()).toContainEqual([
        'recording_delete',
        'busy_settled',
        'completed',
      ]),
    );
    expect(calls()).toContainEqual([
      'recording_delete',
      'audio_cleanup',
      'completed',
    ]);
    expect(calls()).toContainEqual([
      'recording_delete',
      'operation',
      'completed',
    ]);
    expect(calls()).toContainEqual([
      'recording_delete',
      'list_refresh',
      'completed',
    ]);
    expect(JSON.stringify(calls())).not.toContain(savedSource.id);
    expect(
      screen.queryByTestId(`recording-library-item-${savedSource.id}`),
    ).toBeNull();
  } finally {
    await act(async () => {
      release();
      await cleanup;
    });
    alert.mockRestore();
    NativeModules.OrotProviderDiagnostics = previous;
  }
});

test('no process probe exists without opt-in, and native diagnostic exceptions do not escape it', () => {
  const previous = NativeModules.OrotProviderDiagnostics;
  const report = jest.fn(() => {
    throw new Error('synthetic bridge error');
  });
  try {
    NativeModules.OrotProviderDiagnostics = { enabled: false, report };
    expect(processRecordingDeletionProbe()).toBeUndefined();
    expect(report).not.toHaveBeenCalled();
    NativeModules.OrotProviderDiagnostics = { enabled: true, report };
    expect(() =>
      processRecordingDeletionProbe()?.mark('confirmation-tap'),
    ).not.toThrow();
  } finally {
    NativeModules.OrotProviderDiagnostics = previous;
  }
});
