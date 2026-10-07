import {
  formatAudioExportProbeDiagnostic,
  installAudioExportProbeDiagnostics,
} from './recordingExportProbeDiagnostics';

test('reports only the safe stage and rejection code while preserving the error', async () => {
  const failure = Object.assign(
    new Error('The file at /private/tmp/recording.m4a could not be read.'),
    { code: 'RECORDING_EXPORT_FAILED' },
  );
  const originalShareAudio = jest.fn(async (_recordingId: string) => {
    throw failure;
  });
  const service = { shareAudio: originalShareAudio };
  const onDiagnostic = jest.fn();
  const log = jest.fn();
  const restore = installAudioExportProbeDiagnostics(
    service,
    onDiagnostic,
    log,
  );

  await expect(service.shareAudio('synthetic-id')).rejects.toBe(failure);
  expect(originalShareAudio).toHaveBeenCalledWith('synthetic-id');

  const diagnostic = 'stage=audio-share-promise code=RECORDING_EXPORT_FAILED';
  expect(onDiagnostic).toHaveBeenCalledWith(diagnostic);
  expect(log).toHaveBeenCalledWith(
    `RECORDING_EXPORT_PROBE_DIAGNOSTIC ${diagnostic}`,
  );
  expect(log.mock.calls.flat().join(' ')).not.toContain('/private/tmp');
  restore();
  expect(service.shareAudio).toBe(originalShareAudio);
});

test('redacts unsafe codes and non-error rejection details', () => {
  const diagnostic = formatAudioExportProbeDiagnostic({
    code: '/private/recordings/secret.m4a',
    message: 'Authorization token: hidden',
  });

  expect(diagnostic).toBe('stage=audio-share-promise code=unavailable');
  expect(diagnostic).not.toContain('/private');
  expect(diagnostic).not.toContain('Authorization');
});

test('keeps successful synthetic cancellation results unchanged', async () => {
  const originalShareAudio = jest.fn(
    async (_recordingId: string) => 'cancelled' as const,
  );
  const service = { shareAudio: originalShareAudio };
  const onDiagnostic = jest.fn();
  const restore = installAudioExportProbeDiagnostics(service, onDiagnostic);

  await expect(service.shareAudio('synthetic-id')).resolves.toBe('cancelled');
  expect(onDiagnostic).not.toHaveBeenCalled();
  restore();
  expect(service.shareAudio).toBe(originalShareAudio);
});
