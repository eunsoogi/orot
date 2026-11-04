import { loadLocalHealthKitAutoSyncStatus } from '../../healthkit/autoSyncLocal';
import { withProviderStage } from '../../providers/diagnostics';
import type { RagConversationOutcome } from '../../ragConversation/service';
import type { AiFeatureLocalData } from './localData';
import { describeLocalRecordAvailability } from './ragConversationAvailability';

/** Availability uses local metadata without selecting or invoking a provider. */
export async function readConversationAvailability(
  data: AiFeatureLocalData,
  signal: AbortSignal,
): Promise<RagConversationOutcome> {
  const inventory = await withProviderStage('rag', 'data', () =>
    data.repository.readInventory({ signal }),
  );
  const history = await withProviderStage('rag', 'data', () =>
    data.manualHistory.listEvidence({ limit: 1 }),
  );
  let syncStatus = null;
  try {
    syncStatus = await withProviderStage(
      'rag',
      'data',
      loadLocalHealthKitAutoSyncStatus,
    );
  } catch (error) {
    if (
      signal.aborted ||
      (error instanceof Error && error.name === 'AbortError')
    )
      throw error;
  }
  if (signal.aborted) return { status: 'failure', kind: 'cancelled' };
  return {
    status: 'answer',
    answer: describeLocalRecordAvailability(
      inventory,
      syncStatus,
      history.length > 0,
    ),
    citations: [],
  };
}
