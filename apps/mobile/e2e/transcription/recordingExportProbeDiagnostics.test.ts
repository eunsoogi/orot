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

test.each([
  'RECORDING_EXPORT_PROTECTION_NOT_APPLIED',
  'RECORDING_EXPORT_BACKUP_EXCLUSION_NOT_APPLIED',
  'RECORDING_EXPORT_BACKUP_ELIGIBILITY_NOT_APPLIED',
])('reports the known Simulator file-security category %s', code => {
  expect(formatAudioExportProbeDiagnostic({ code })).toBe(
    `stage=audio-share-promise code=${code}`,
  );
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

test('redacts code-shaped values outside the native audio export contract', () => {
  const diagnostic = formatAudioExportProbeDiagnostic({
    code: 'AUDIO_KEY_7F8A',
  });

  expect(diagnostic).toBe('stage=audio-share-promise code=unavailable');
  expect(diagnostic).not.toContain('AUDIO_KEY_7F8A');
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
