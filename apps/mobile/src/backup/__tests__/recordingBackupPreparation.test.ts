import { prepareRecordingBackup } from '../recordingBackupPreparation';

test('reports only the explicit Simulator protection readback limitation', async () => {
  const prepare = jest.fn(async () => {
    throw new Error('Unrelated native preparation failure.');
  });

  await expect(prepareRecordingBackup('unverified', prepare)).resolves.toBe(
    'simulator-protection-unverified',
  );
  expect(prepare).not.toHaveBeenCalled();
});

test('does not classify an unrelated native preparation error as a Simulator limit', async () => {
  const prepare = jest.fn(async () => {
    throw new Error('Unrelated native preparation failure.');
  });

  await expect(prepareRecordingBackup('complete', prepare)).rejects.toThrow(
    'Unrelated native preparation failure.',
  );
});

test('keeps a native recording-count mismatch as a preparation failure', async () => {
  await expect(
    prepareRecordingBackup('complete', async () => 0),
  ).rejects.toThrow('The permanent recording count was unexpected.');
});

test('fails closed when the recording protection readback is unknown', async () => {
  const prepare = jest.fn(async () => 1);

  await expect(prepareRecordingBackup('unknown', prepare)).rejects.toThrow(
    'Recording protection is unknown.',
  );
  expect(prepare).not.toHaveBeenCalled();
});

test('reports readiness only after the strict native preparation finds one recording', async () => {
  const prepare = jest.fn(async () => 1);

  await expect(prepareRecordingBackup('complete', prepare)).resolves.toBe(
    'ready',
  );
  expect(prepare).toHaveBeenCalledTimes(1);
});
