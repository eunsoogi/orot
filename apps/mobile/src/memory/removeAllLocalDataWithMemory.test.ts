import type { AgentMemoryService } from '@orot/agent-memory';
import type { RecordRepository, SqlExecutor } from '@orot/storage';
import { createLocalE5RagService } from '../rag/localE5RagService';
import {
  openLocalAgentMemoryDatabase,
  openLocalStorage,
} from '../storage/secureDatabase';
import { removeAllLocalDataWithMemory } from './removeAllLocalDataWithMemory';

jest.mock('../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
  openLocalStorage: jest.fn(),
}));

jest.mock('../rag/localE5RagService', () => ({
  createLocalE5RagService: jest.fn(),
}));

jest.mock('../medicalDocuments/medicalDocumentNativeBridge', () => ({
  medicalDocumentFileDeletion: {
    reconcile: jest.fn().mockResolvedValue(undefined),
    stage: jest.fn(),
    restore: jest.fn(),
    commit: jest.fn(),
    discard: jest.fn(),
  },
}));

describe('removeAllLocalDataWithMemory', () => {
  const sourceRecordIds = ['synthetic-source-1', 'synthetic-source-2'];
  const deletionReferenceIds = [
    ...sourceRecordIds,
    'synthetic-manual-encounter',
    'synthetic-transcript-revision',
  ];
  type DeletedLocalDataReferences = Awaited<
    ReturnType<RecordRepository['deleteAllLocalData']>
  >;
  const deleted: DeletedLocalDataReferences = {
    sourceRecordIds,
  };
  const transaction = { execute: jest.fn() } as unknown as SqlExecutor;
  const events: string[] = [];
  const prepare = jest.fn<Promise<void>, []>();
  const clear = jest.fn<Promise<void>, [readonly string[], SqlExecutor]>();
  const audioDeletion = {
    reconcile: jest.fn<Promise<void>, [readonly string[]]>(),
    stage: jest.fn<Promise<void>, [string]>(),
    restore: jest.fn<Promise<void>, [string]>(),
    commit: jest.fn<Promise<void>, [string]>(),
  };
  const deleteAllLocalData = jest.fn<
    Promise<DeletedLocalDataReferences>,
    [
      (
        transaction: SqlExecutor,
        sourceRecordIds: readonly string[],
        deletionReferenceIds: readonly string[],
      ) => Promise<void>,
    ]
  >();

  beforeEach(() => {
    events.length = 0;
    prepare.mockReset().mockImplementation(async () => {
      events.push('rag-prepare');
    });
    clear.mockReset().mockImplementation(async () => {
      events.push('rag-clear');
    });
    deleteAllLocalData
      .mockReset()
      .mockImplementation(async clearRelatedData => {
        events.push('local-delete');
        await clearRelatedData(
          transaction,
          sourceRecordIds,
          deletionReferenceIds,
        );
        return deleted;
      });
    jest.mocked(openLocalAgentMemoryDatabase).mockResolvedValue({} as never);
    jest.mocked(openLocalStorage).mockResolvedValue({
      list: jest
        .fn()
        .mockResolvedValue([
          ...sourceRecordIds.map(id => ({ id, sourceKind: 'audio_recording' })),
        ]),
      listAllLocalDeletionReferences: jest
        .fn()
        .mockResolvedValue(deletionReferenceIds),
      deleteAllLocalData,
    } as never);
    jest
      .mocked(createLocalE5RagService)
      .mockReturnValue({ prepare, clear } as never);
    audioDeletion.stage.mockReset().mockImplementation(async sourceId => {
      events.push(`audio-stage:${sourceId}`);
    });
    audioDeletion.restore.mockReset().mockImplementation(async sourceId => {
      events.push(`audio-restore:${sourceId}`);
    });
    audioDeletion.commit.mockReset().mockImplementation(async sourceId => {
      events.push(`audio-commit:${sourceId}`);
    });
    audioDeletion.reconcile.mockReset().mockImplementation(async sourceIds => {
      events.push(`audio-reconcile:${sourceIds.join(',')}`);
    });
  });

  // Keep memory deletion deterministic; selected cases can inject its storage failure.
  function makeMemory(failure?: Error): AgentMemoryService {
    const forgetAll = failure
      ? jest.fn().mockRejectedValue(failure)
      : jest.fn(async () => {
          events.push('memory-forget-all');
          return 3;
        });
    return { forgetAll } as unknown as AgentMemoryService;
  }

  // Exercise audio cleanup through the shared data-removal boundary.
  function deleteAllWithAudio(memory: AgentMemoryService) {
    return removeAllLocalDataWithMemory(memory, {
      audioDeletion,
    });
  }

  it('forgets memory before clearing local records and shared-transaction RAG state', async () => {
    const memory = makeMemory();

    await expect(deleteAllWithAudio(memory)).resolves.toEqual({
      ...deleted,
      memoriesDeleted: 3,
      audioCleanupPending: false,
      medicalDocumentCleanupPending: false,
    });

    expect(events).toEqual([
      'rag-prepare',
      'audio-reconcile:synthetic-source-1,synthetic-source-2',
      'audio-stage:synthetic-source-1',
      'audio-stage:synthetic-source-2',
      'memory-forget-all',
      'local-delete',
      'rag-clear',
      'audio-commit:synthetic-source-1',
      'audio-commit:synthetic-source-2',
    ]);
    expect(memory.forgetAll).toHaveBeenCalledWith(deletionReferenceIds);
    expect(clear).toHaveBeenCalledWith(deletionReferenceIds, transaction);
  });

  it('keeps source records when persistent memory removal fails', async () => {
    const memory = makeMemory(new Error('Synthetic memory-storage failure.'));

    await expect(deleteAllWithAudio(memory)).rejects.toThrow(
      'Synthetic memory-storage failure.',
    );

    expect(audioDeletion.restore).toHaveBeenNthCalledWith(
      1,
      'synthetic-source-2',
    );
    expect(audioDeletion.restore).toHaveBeenNthCalledWith(
      2,
      'synthetic-source-1',
    );
    expect(deleteAllLocalData).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
  });

  it('restores every staged recording when the local-data transaction fails', async () => {
    const memory = makeMemory();
    deleteAllLocalData.mockImplementationOnce(async clearRelatedData => {
      events.push('local-delete');
      await clearRelatedData(
        transaction,
        sourceRecordIds,
        deletionReferenceIds,
      );
      throw new Error('Synthetic local-store failure.');
    });

    await expect(deleteAllWithAudio(memory)).rejects.toThrow(
      'Synthetic local-store failure.',
    );

    expect(audioDeletion.restore).toHaveBeenNthCalledWith(
      1,
      'synthetic-source-2',
    );
    expect(audioDeletion.restore).toHaveBeenNthCalledWith(
      2,
      'synthetic-source-1',
    );
    expect(audioDeletion.commit).not.toHaveBeenCalled();
  });

  it('reports pending audio cleanup without restoring files after data deletion', async () => {
    const memory = makeMemory();
    jest
      .mocked(audioDeletion.commit)
      .mockRejectedValueOnce(new Error('Synthetic file cleanup failure.'));

    await expect(deleteAllWithAudio(memory)).resolves.toEqual({
      ...deleted,
      memoriesDeleted: 3,
      audioCleanupPending: true,
      medicalDocumentCleanupPending: false,
    });

    expect(audioDeletion.restore).not.toHaveBeenCalled();
    expect(audioDeletion.commit).toHaveBeenCalledTimes(2);
  });

  it('restores already staged audio when a later file cannot be staged', async () => {
    const memory = makeMemory();
    jest
      .mocked(audioDeletion.stage)
      .mockImplementationOnce(async () => {})
      .mockRejectedValueOnce(new Error('Synthetic stage failure.'));

    await expect(deleteAllWithAudio(memory)).rejects.toThrow(
      'Synthetic stage failure.',
    );

    expect(audioDeletion.restore).toHaveBeenCalledTimes(1);
    expect(audioDeletion.restore).toHaveBeenCalledWith('synthetic-source-1');
    expect(memory.forgetAll).not.toHaveBeenCalled();
    expect(deleteAllLocalData).not.toHaveBeenCalled();
  });
});
