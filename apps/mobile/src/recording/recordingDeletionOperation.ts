import type { AgentMemoryService } from '@orot/agent-memory';
import type { RecordRepository } from '@orot/storage';
import type { SourceMemoryDeletionResult } from '../memory/removeSourceWithMemory';
import type { RecordingDeletionTimingProbe } from './recordingDeletionTiming';
import type {
  RecordingAudioDeletion,
  RecordingDeletionResult,
} from './recordingLibraryServiceTypes';
import {
  finishRecordingDeletionTiming,
  withRecordingDeletionTiming,
} from './recordingDeletionTiming';

type SourceRemover = (
  sourceId: string,
  memory: AgentMemoryService,
  timingProbe?: RecordingDeletionTimingProbe,
) => Promise<SourceMemoryDeletionResult>;

interface RecordingDeletionOperationDependencies {
  readonly loadRepository: () => Promise<RecordRepository>;
  readonly openMemory: () => Promise<AgentMemoryService>;
  readonly removeSource: SourceRemover;
  readonly audioDeletion: RecordingAudioDeletion;
  readonly ensureStopped: () => Promise<void>;
}

/** Times the existing ordered delete cascade without changing its recovery decisions. */
export async function performRecordingDeletion(
  sourceId: string,
  timingProbe: RecordingDeletionTimingProbe | undefined,
  dependencies: RecordingDeletionOperationDependencies,
): Promise<RecordingDeletionResult> {
  const {
    loadRepository,
    openMemory,
    removeSource,
    audioDeletion,
    ensureStopped,
  } = dependencies;

  try {
    const repository = await withRecordingDeletionTiming(
      timingProbe,
      'source-read',
      async () => {
        const loaded = await loadRepository();
        const source = await loaded.get('source_record', sourceId);
        if (!source || source.sourceKind !== 'audio_recording') {
          throw new Error('The selected recording is no longer available.');
        }
        return loaded;
      },
    );
    await withRecordingDeletionTiming(timingProbe, 'stop-check', ensureStopped);
    await withRecordingDeletionTiming(timingProbe, 'audio-staging', () =>
      audioDeletion.stage(sourceId),
    );

    let sourceRemoved = false;
    try {
      const memory = await withRecordingDeletionTiming(
        timingProbe,
        'memory-open',
        openMemory,
      );
      const result = await removeSource(sourceId, memory, timingProbe);
      if (!result.sourceDeleted) {
        sourceRemoved =
          (await repository.get('source_record', sourceId)) === null;
        if (!sourceRemoved) {
          throw new Error('The recording source could not be removed.');
        }
      } else {
        sourceRemoved = true;
      }
    } catch (error) {
      // Restore staged audio unless the existing cascade confirmed source deletion.
      if (!sourceRemoved) {
        await withRecordingDeletionTiming(timingProbe, 'audio-cleanup', () =>
          audioDeletion.restore(sourceId),
        );
      }
      throw error;
    }

    let audioCleanupPending = false;
    try {
      await withRecordingDeletionTiming(timingProbe, 'audio-cleanup', () =>
        audioDeletion.commit(sourceId),
      );
    } catch {
      // Keep staged audio hidden; list/relaunch reconciliation owns this recovery.
      audioCleanupPending = true;
    }
    finishRecordingDeletionTiming(timingProbe, 'success');
    return { audioCleanupPending };
  } catch (error) {
    finishRecordingDeletionTiming(timingProbe, 'failure');
    throw error;
  }
}
