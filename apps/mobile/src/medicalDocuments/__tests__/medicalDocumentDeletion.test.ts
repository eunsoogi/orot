import type { RecordRepository } from '@orot/storage';
import { createMedicalDocumentDeletion } from '../medicalDocumentDeletion';
import {
  currentMedicalDocumentGeneration,
  canUseMedicalDocumentGeneration,
} from '../medicalDocumentLifecycle';

function fixture(kind = 'medical_document') {
  let source: { sourceKind: string } | null = { sourceKind: kind };
  const get = jest.fn(async () => source);
  const repository = { sourceRecords: { get } } as unknown as RecordRepository;
  const files = {
    stage: jest.fn(async () => {}),
    restore: jest.fn(async () => {}),
    commit: jest.fn(async () => {}),
    reconcile: jest.fn(),
    ensureOriginal: jest.fn(),
    discard: jest.fn(),
  };
  const removeSource = jest.fn(async () => {
    source = null;
    return { sourceDeleted: true };
  });
  return {
    files,
    removeSource,
    get,
    setSource: (value: null) => {
      source = value;
    },
    run: createMedicalDocumentDeletion({
      repository: async () => repository,
      files,
      removeSource,
    }),
  };
}

test('stages selected local original, cascades source deletion, then commits cleanup', async () => {
  const f = fixture();
  await expect(f.run('synthetic-document')).resolves.toEqual({
    cleanupPending: false,
  });
  expect(f.files.stage).toHaveBeenCalledWith('synthetic-document');
  expect(f.removeSource).toHaveBeenCalledWith('synthetic-document');
  expect(f.files.commit).toHaveBeenCalledWith('synthetic-document');
  expect(f.files.restore).not.toHaveBeenCalled();
  expect(f.files.stage.mock.invocationCallOrder[0]).toBeLessThan(
    f.removeSource.mock.invocationCallOrder[0]!,
  );
  expect(f.removeSource.mock.invocationCallOrder[0]).toBeLessThan(
    f.files.commit.mock.invocationCallOrder[0]!,
  );
  expect(
    canUseMedicalDocumentGeneration(currentMedicalDocumentGeneration()),
  ).toBe(true);
});

test('rejects wrong source kinds and missing records without touching files', async () => {
  const f = fixture('audio_recording');
  await expect(f.run('audio')).rejects.toThrow('unavailable');
  f.setSource(null);
  await expect(f.run('missing')).rejects.toThrow('unavailable');
  expect(f.files.stage).not.toHaveBeenCalled();
  expect(f.removeSource).not.toHaveBeenCalled();
});

test('restores only a confirmed retained source after cascade failure', async () => {
  const f = fixture();
  f.removeSource.mockRejectedValueOnce(new Error('cascade failed'));
  await expect(f.run('document')).rejects.toThrow('cascade failed');
  expect(f.files.restore).toHaveBeenCalledWith('document');
  expect(f.files.commit).not.toHaveBeenCalled();
  await expect(f.run('document')).resolves.toEqual({ cleanupPending: false });
});

test('does not restore a committed deletion even if the cascade response throws', async () => {
  const f = fixture();
  f.removeSource.mockImplementationOnce(async () => {
    f.setSource(null);
    throw new Error('response lost');
  });
  await expect(f.run('document')).resolves.toEqual({ cleanupPending: false });
  expect(f.files.restore).not.toHaveBeenCalled();
});

test('keeps unknown database results hidden and reports pending native cleanup', async () => {
  const f = fixture();
  f.removeSource.mockRejectedValueOnce(new Error('unknown'));
  f.get
    .mockResolvedValueOnce({ sourceKind: 'medical_document' })
    .mockRejectedValueOnce(new Error('database unavailable'));
  await expect(f.run('document')).rejects.toThrow('database unavailable');
  expect(f.files.restore).not.toHaveBeenCalled();
  expect(f.files.commit).not.toHaveBeenCalled();
  const cleanup = fixture();
  cleanup.files.commit.mockRejectedValueOnce(new Error('file locked'));
  await expect(cleanup.run('document')).resolves.toEqual({
    cleanupPending: true,
  });
  expect(cleanup.files.restore).not.toHaveBeenCalled();
});

test('excludes a second deletion while a source cascade is pending', async () => {
  const f = fixture();
  let finish!: () => void;
  const wait = new Promise<void>(resolve => {
    finish = resolve;
  });
  f.removeSource.mockImplementationOnce(async () => {
    await wait;
    f.setSource(null);
    return { sourceDeleted: true };
  });
  const first = f.run('document');
  await expect(f.run('document')).rejects.toThrow('already active');
  finish();
  await first;
  expect(f.files.stage).toHaveBeenCalledTimes(1);
});
