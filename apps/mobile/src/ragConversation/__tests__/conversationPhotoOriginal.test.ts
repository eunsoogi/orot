import { validateConversationPhotoOriginal } from '../conversationPhotoOriginal';
import {
  endMedicalDocumentDeletion,
  startMedicalDocumentDeletion,
} from '../../medicalDocuments/medicalDocumentLifecycle';

const sourceId = '12345678-1234-4234-8234-123456789abc';
const contentHash = `sha256:${'a'.repeat(64)}`;

test('checks the exact native original between durable ownership reads', async () => {
  const ensureOriginal = jest.fn().mockResolvedValue(undefined);
  const isCurrent = jest.fn().mockResolvedValue(true);
  expect(
    await validateConversationPhotoOriginal({
      sourceId,
      contentHash,
      signal: new AbortController().signal,
      isCurrent,
      files: { ensureOriginal },
    }),
  ).toBe(true);
  expect(ensureOriginal).toHaveBeenCalledWith(
    sourceId,
    sourceId,
    contentHash,
    expect.any(Number),
  );
  expect(isCurrent).toHaveBeenCalledTimes(2);
});

test('fails closed for a missing file, stale owner, or noncanonical source', async () => {
  const ensureOriginal = jest.fn().mockRejectedValue(new Error('missing'));
  const isCurrent = jest.fn().mockResolvedValue(true);
  const base = {
    sourceId,
    contentHash,
    signal: new AbortController().signal,
    isCurrent,
    files: { ensureOriginal },
  };
  expect(await validateConversationPhotoOriginal(base)).toBe(false);
  ensureOriginal.mockResolvedValue(undefined);
  isCurrent.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  expect(await validateConversationPhotoOriginal(base)).toBe(false);
  ensureOriginal.mockClear();
  expect(
    await validateConversationPhotoOriginal({
      ...base,
      sourceId: sourceId.toUpperCase(),
    }),
  ).toBe(false);
  expect(ensureOriginal).not.toHaveBeenCalled();
});

test('rejects a deletion or cancellation while native verification is pending', async () => {
  let complete!: () => void;
  const ensureOriginal = jest.fn(
    () =>
      new Promise<void>(resolve => {
        complete = resolve;
      }),
  );
  const controller = new AbortController();
  const task = validateConversationPhotoOriginal({
    sourceId,
    contentHash,
    signal: controller.signal,
    isCurrent: async () => true,
    files: { ensureOriginal },
  });
  await Promise.resolve();
  startMedicalDocumentDeletion();
  complete();
  expect(await task).toBe(false);
  endMedicalDocumentDeletion();
  const cancelled = new AbortController();
  cancelled.abort();
  expect(
    await validateConversationPhotoOriginal({
      sourceId,
      contentHash,
      signal: cancelled.signal,
      isCurrent: async () => true,
      files: { ensureOriginal },
    }),
  ).toBe(false);
});
