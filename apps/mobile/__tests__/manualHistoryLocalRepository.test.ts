import {
  openLocalAgentMemoryDatabase,
  openLocalStorage,
} from '../src/storage/secureDatabase';
import { createLocalE5RagService } from '../src/rag/localE5RagService';
import { openLocalManualHistoryRepository } from '../src/manualHistory/localRepository';
import type { ManualHistoryScreenDraft } from '../src/manualHistory/types';

jest.mock('../src/storage/secureDatabase', () => ({
  openLocalStorage: jest.fn(),
  openLocalAgentMemoryDatabase: jest.fn(),
}));
jest.mock('../src/rag/localE5RagService', () => ({
  createLocalE5RagService: jest.fn(),
}));

const mockedOpenLocalStorage = jest.mocked(openLocalStorage);
const mockedOpenLocalAgentMemoryDatabase = jest.mocked(
  openLocalAgentMemoryDatabase,
);
const mockedCreateLocalE5RagService = jest.mocked(createLocalE5RagService);
type LocalStorage = Awaited<ReturnType<typeof openLocalStorage>>;

const originalEntry = {
  id: 'synthetic-manual-history-original',
  kind: 'diagnosis_history' as const,
  title: 'Synthetic medical history',
  details: 'Synthetic original details.',
  effectiveDate: { status: 'unknown' } as const,
  recordedAt: '2026-09-15T10:20:00Z',
  ingestedAt: '2026-09-15T10:20:00Z',
  provenance: { origin: 'user_reported' as const, sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' as const },
};

const correctedEntry = {
  ...originalEntry,
  id: 'synthetic-manual-history-corrected',
  title: 'Corrected synthetic medical history',
  details: 'Corrected synthetic details.',
  recordedAt: '2026-09-16T11:20:00Z',
  ingestedAt: '2026-09-16T11:20:00Z',
  supersedesId: originalEntry.id,
  correctionNote: 'Corrected the title.',
};

const draft: ManualHistoryScreenDraft = {
  kind: 'diagnosis_history',
  title: correctedEntry.title,
  details: correctedEntry.details,
  effectiveDate: { status: 'unknown' },
  correctionNote: correctedEntry.correctionNote,
};

describe('openLocalManualHistoryRepository', () => {
  it('maps persisted records and forwards create, correction, and lineage calls', async () => {
    const transaction = { execute: jest.fn() };
    const database = {
      async transaction(
        operation: (value: typeof transaction) => Promise<void>,
      ) {
        await operation(transaction);
      },
    };
    const manualHistory = {
      list: jest.fn().mockResolvedValue([correctedEntry]),
      create: jest.fn().mockResolvedValue(originalEntry),
      correct: jest.fn().mockResolvedValue(correctedEntry),
      history: jest.fn().mockResolvedValue([originalEntry, correctedEntry]),
      delete: jest.fn().mockResolvedValue(true),
    };
    const deleteChunks = jest.fn().mockResolvedValue(undefined);
    mockedOpenLocalStorage.mockResolvedValue({
      manualHistory,
    } as unknown as LocalStorage);
    mockedOpenLocalAgentMemoryDatabase.mockResolvedValue(
      database as unknown as Awaited<
        ReturnType<typeof openLocalAgentMemoryDatabase>
      >,
    );
    mockedCreateLocalE5RagService.mockReturnValue({
      deleteChunks,
    } as unknown as ReturnType<typeof createLocalE5RagService>);

    const repository = await openLocalManualHistoryRepository();

    await expect(repository.list()).resolves.toEqual([
      {
        id: correctedEntry.id,
        kind: correctedEntry.kind,
        title: correctedEntry.title,
        details: correctedEntry.details,
        effectiveDate: correctedEntry.effectiveDate,
        recordedAt: correctedEntry.recordedAt,
        provenance: { origin: 'user_reported' },
        reviewState: { status: 'unreviewed' },
        supersedesId: originalEntry.id,
        correctionNote: correctedEntry.correctionNote,
      },
    ]);

    await repository.create(draft);
    expect(manualHistory.create).toHaveBeenCalledWith({
      kind: draft.kind,
      title: draft.title,
      details: draft.details,
      effectiveDate: draft.effectiveDate,
    });

    await repository.correct(originalEntry.id, draft);
    expect(manualHistory.correct).toHaveBeenCalledWith(originalEntry.id, {
      kind: draft.kind,
      title: draft.title,
      details: draft.details,
      effectiveDate: draft.effectiveDate,
      correctionNote: draft.correctionNote,
    });

    await expect(repository.history(correctedEntry.id)).resolves.toEqual([
      expect.objectContaining({
        id: originalEntry.id,
        recordedAt: originalEntry.recordedAt,
        provenance: { origin: 'user_reported' },
        reviewState: { status: 'unreviewed' },
      }),
      expect.objectContaining({
        id: correctedEntry.id,
        recordedAt: correctedEntry.recordedAt,
        provenance: { origin: 'user_reported' },
        reviewState: { status: 'unreviewed' },
        supersedesId: originalEntry.id,
        correctionNote: correctedEntry.correctionNote,
      }),
    ]);
    expect(manualHistory.history).toHaveBeenCalledWith(correctedEntry.id);

    await expect(repository.delete(correctedEntry.id)).resolves.toBe(true);
    expect(manualHistory.history).toHaveBeenCalledWith(
      correctedEntry.id,
      transaction,
    );
    expect(manualHistory.delete).toHaveBeenCalledWith(
      correctedEntry.id,
      transaction,
    );
    expect(deleteChunks).toHaveBeenCalledWith(
      [],
      [originalEntry.id, correctedEntry.id],
      transaction,
    );
  });

  it('does not touch the evidence index when the requested entry is missing', async () => {
    const transaction = { execute: jest.fn() };
    const database = {
      async transaction(
        operation: (value: typeof transaction) => Promise<void>,
      ) {
        await operation(transaction);
      },
    };
    const manualHistory = {
      list: jest.fn(),
      create: jest.fn(),
      correct: jest.fn(),
      history: jest
        .fn()
        .mockRejectedValue(new Error('Manual history entry not found.')),
      delete: jest.fn(),
    };
    const deleteChunks = jest.fn();
    mockedOpenLocalStorage.mockResolvedValue({
      manualHistory,
    } as unknown as LocalStorage);
    mockedOpenLocalAgentMemoryDatabase.mockResolvedValue(
      database as unknown as Awaited<
        ReturnType<typeof openLocalAgentMemoryDatabase>
      >,
    );
    mockedCreateLocalE5RagService.mockReturnValue({
      deleteChunks,
    } as unknown as ReturnType<typeof createLocalE5RagService>);

    const repository = await openLocalManualHistoryRepository();

    await expect(repository.delete('missing-entry')).resolves.toBe(false);
    expect(manualHistory.history).toHaveBeenCalledWith(
      'missing-entry',
      transaction,
    );
    expect(manualHistory.delete).not.toHaveBeenCalled();
    expect(deleteChunks).not.toHaveBeenCalled();
  });
});
