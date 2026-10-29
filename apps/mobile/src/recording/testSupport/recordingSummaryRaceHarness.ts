import type { AgentMemoryService } from '@orot/agent-memory';
import type { RecordRepository, RecordWriter } from '@orot/storage';
import { openEncryptedStorage } from '@orot/storage';
import {
  createDatabase,
  options,
  audioSourceRecord,
} from '../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { original } from '../../transcription/testSupport/transcriptEvidenceServiceFixtures';
import { createRecordingLibraryService } from '../recordingLibraryService';

declare const require: (specifier: string) => unknown;
const { setImmediate } = require('node:timers') as {
  setImmediate(callback: () => void): unknown;
};

/** Drain synchronous SQLite promise work by one event-loop turn, not by an elapsed-time budget. */
export function completeSynchronousSqlWork(): Promise<void> {
  return new Promise(resolve => {
    setImmediate(resolve);
  });
}

/** Explicit result gates keep SQL completed while callers control promise delivery; no wall-clock delays. */
export function resultGate() {
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>(resolve => {
    enter = resolve;
  });
  const held = new Promise<void>(resolve => {
    release = resolve;
  });
  return {
    entered,
    release,
    wait: async () => {
      enter();
      await held;
    },
  };
}

export async function recordingSummaryRaceHarness() {
  const database = createDatabase();
  // Match the installed op-sqlite transaction queue; raw execute still shares the active connection.
  const runTransaction = database.transaction.bind(database);
  let transactionTail: Promise<void> = Promise.resolve();
  database.transaction = operation => {
    const result = transactionTail.then(() => runTransaction(operation));
    transactionTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  const repository = await openEncryptedStorage(options(database));
  const audioOrder: string[] = [];
  const failures = {
    commit: null as Error | null,
    reconcile: null as Error | null,
  };
  const library = createRecordingLibraryService({
    loadRepository: async () => repository,
    openMemory: async () => ({}) as AgentMemoryService,
    assertRecordingStopped: async () => {},
    removeSource: async id => ({
      sourceDeleted: await repository.sourceRecords.delete(id),
      memoriesDeleted: 0,
    }),
    audioDeletion: {
      stage: async () => {
        audioOrder.push('stage');
      },
      restore: async () => {
        audioOrder.push('restore');
      },
      commit: async () => {
        audioOrder.push('commit');
        if (failures.commit) throw failures.commit;
      },
      reconcile: async () => {
        audioOrder.push('reconcile');
        if (failures.reconcile) throw failures.reconcile;
      },
    },
  });
  async function appendTranscript(id: string) {
    await repository.transcripts.append([
      {
        ...original,
        id: `${id}:segment:0:r1`,
        transcriptId: `${id}:segment:0`,
        recordingSourceId: id,
        text: 'Synthetic transcript',
        recordingDurationMs: 2000,
        provenance: { ...original.provenance, sourceRecordIds: [id] },
      },
    ]);
  }
  async function seed(id: string, withTranscript = true) {
    const source = {
      ...audioSourceRecord(id),
      contentHash: undefined,
      recordingDurationMs: 2000,
    };
    await repository.put('source_record', source);
    if (withTranscript) await appendTranscript(id);
    return source;
  }
  return {
    database,
    repository,
    library,
    audioOrder,
    seed,
    appendTranscript,
    failures,
  };
}

/** Gate either repository read route after its SQL snapshot has finished, including a committed read transaction. */
export function holdMetadataResult(repository: RecordRepository) {
  const gate = resultGate();
  let used = false;
  const holdOnce = async () => {
    if (used) return;
    used = true;
    await gate.wait();
  };
  const list = repository.list.bind(repository);
  const transaction = repository.transaction.bind(repository);
  const read = jest.spyOn(repository, 'list').mockImplementation(async kind => {
    const rows = await list(kind);
    if (kind === 'transcript_segment') await holdOnce();
    return rows;
  });
  const gatedTransaction: RecordRepository['transaction'] = async operation => {
    let readMetadata = false;
    const result = await transaction((writer, sql) => {
      const observed: RecordWriter = {
        ...writer,
        list: async kind => {
          const rows = await writer.list(kind);
          if (kind === 'transcript_segment') readMetadata = true;
          return rows;
        },
      };
      return operation(observed, sql);
    });
    if (readMetadata) await holdOnce();
    return result;
  };
  const tx = jest
    .spyOn(repository, 'transaction')
    .mockImplementation(gatedTransaction);
  return {
    ...gate,
    restore: () => {
      read.mockRestore();
      tx.mockRestore();
    },
  };
}
