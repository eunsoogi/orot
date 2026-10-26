import type { AgentMemoryService } from '@orot/agent-memory';
import type { RecordRepository, SqlExecutor } from '@orot/storage';
import { getProtectedMedicalDocumentSourceIds } from '../medicalDocuments/medicalDocumentNativeBridge';
import {
  openLocalAgentMemoryDatabase,
  openLocalStorage,
} from '../storage/secureDatabase';
import { createLocalE5RagService } from '../rag/localE5RagService';
import { removeAllLocalDataWithMemory } from './removeAllLocalDataWithMemory';

jest.mock('../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
  openLocalStorage: jest.fn(),
}));
jest.mock('../rag/localE5RagService', () => ({
  createLocalE5RagService: jest.fn(),
}));
jest.mock('../medicalDocuments/medicalDocumentNativeBridge', () => ({
  getProtectedMedicalDocumentSourceIds: jest.fn(async () => []),
}));

const sourceIDs = [
  'synthetic-medical-document-1',
  'synthetic-medical-document-2',
];

function setup() {
  jest
    .mocked(getProtectedMedicalDocumentSourceIds)
    .mockReset()
    .mockResolvedValue([]);
  const events: string[] = [];
  const transaction = {} as SqlExecutor;
  const deletionReferences = [...sourceIDs];
  const deleted = { sourceRecordIds: sourceIDs };
  const prepare = jest.fn(async () => {
    events.push('rag-prepare');
  });
  const clear = jest.fn(async () => {
    events.push('rag-clear');
  });
  const audioDeletion = {
    reconcile: jest.fn(async () => {
      events.push('audio-reconcile');
    }),
    stage: jest.fn(),
    restore: jest.fn(),
    commit: jest.fn(),
  };
  const medicalDocumentDeletion = {
    reconcile: jest.fn(async () => {
      events.push('documents-reconcile');
    }),
    stage: jest.fn(async (id: string) => {
      events.push(`document-stage:${id}`);
    }),
    restore: jest.fn(async (id: string) => {
      events.push(`document-restore:${id}`);
    }),
    commit: jest.fn(async (id: string) => {
      events.push(`document-commit:${id}`);
    }),
    ensureOriginal: jest.fn().mockResolvedValue(undefined),
    discard: jest.fn(),
  };
  const deleteAllLocalData = jest.fn(
    async (
      clearRelatedData: (
        transaction: SqlExecutor,
        sourceIDs: readonly string[],
        localIDs: readonly string[],
      ) => Promise<void>,
    ) => {
      events.push('local-delete');
      await clearRelatedData(transaction, sourceIDs, deletionReferences);
      return deleted;
    },
  );
  const repository = {
    list: jest
      .fn()
      .mockResolvedValue(
        sourceIDs.map(id => ({ id, sourceKind: 'medical_document' })),
      ),
    listAllLocalDeletionReferences: jest
      .fn()
      .mockResolvedValue(deletionReferences),
    deleteAllLocalData,
  } as unknown as RecordRepository;
  jest.mocked(openLocalAgentMemoryDatabase).mockResolvedValue({} as never);
  jest.mocked(openLocalStorage).mockResolvedValue(repository);
  jest
    .mocked(createLocalE5RagService)
    .mockReturnValue({ prepare, clear } as never);
  const memory = {
    forgetAll: jest.fn(async () => {
      events.push('memory-forget-all');
      return 2;
    }),
  } as unknown as AgentMemoryService;
  return {
    audioDeletion,
    clear,
    deleteAllLocalData,
    events,
    medicalDocumentDeletion,
    memory,
    prepare,
  };
}

describe('medical document file lifecycle during local data deletion', () => {
  it('stages protected active sources missing from the saved-source snapshot', async () => {
    const context = setup();
    const activeDocumentID = 'synthetic-active-medical-document';
    jest
      .mocked(getProtectedMedicalDocumentSourceIds)
      .mockResolvedValue([activeDocumentID]);

    await expect(
      removeAllLocalDataWithMemory(context.memory, {
        audioDeletion: context.audioDeletion,
        medicalDocumentDeletion: context.medicalDocumentDeletion,
      }),
    ).resolves.toMatchObject({ medicalDocumentCleanupPending: false });

    expect(context.medicalDocumentDeletion.reconcile).toHaveBeenCalledWith([
      ...sourceIDs,
      activeDocumentID,
    ]);
    expect(context.medicalDocumentDeletion.stage).toHaveBeenCalledWith(
      activeDocumentID,
    );
    expect(context.medicalDocumentDeletion.commit).toHaveBeenCalledWith(
      activeDocumentID,
    );
  });

  it('keeps staged originals hidden when cleanup must retry after the database commit', async () => {
    const context = setup();
    context.medicalDocumentDeletion.commit.mockRejectedValueOnce(
      new Error('Synthetic protected-file cleanup failure.'),
    );

    await expect(
      removeAllLocalDataWithMemory(context.memory, {
        audioDeletion: context.audioDeletion,
        medicalDocumentDeletion: context.medicalDocumentDeletion,
      }),
    ).resolves.toEqual({
      sourceRecordIds: sourceIDs,
      memoriesDeleted: 2,
      audioCleanupPending: false,
      medicalDocumentCleanupPending: true,
    });

    expect(context.medicalDocumentDeletion.restore).not.toHaveBeenCalled();
    expect(context.medicalDocumentDeletion.commit).toHaveBeenCalledTimes(2);
    expect(context.clear).toHaveBeenCalledTimes(1);
  });

  it('restores earlier staged originals when a later document cannot be staged', async () => {
    const context = setup();
    context.medicalDocumentDeletion.stage
      .mockImplementationOnce(async id => {
        context.events.push(`document-stage:${id}`);
      })
      .mockRejectedValueOnce(new Error('Synthetic document stage failure.'));

    await expect(
      removeAllLocalDataWithMemory(context.memory, {
        audioDeletion: context.audioDeletion,
        medicalDocumentDeletion: context.medicalDocumentDeletion,
      }),
    ).rejects.toThrow('Synthetic document stage failure.');

    expect(context.medicalDocumentDeletion.restore).toHaveBeenCalledWith(
      sourceIDs[0],
    );
    expect(context.memory.forgetAll).not.toHaveBeenCalled();
    expect(context.deleteAllLocalData).not.toHaveBeenCalled();
  });
});
