import '../polyfills';
import {
  runHealthReviewGraph,
  SqliteCheckpointSaver,
} from '@orot/agent-runtime';
import type { HealthReviewOptions } from '@orot/agent-runtime';
import { createLangGraphCheckpointStorage } from '@orot/storage';
import {
  openLocalAgentMemoryDatabase,
  openLocalStorage,
} from '../../storage/secureDatabase';
import { SqlCipherAgentMemoryStorage } from '../../storage/agentMemoryStorage';
import { openAiFeatureLocalData } from '../../aiFeatures/integration/localData';
import { createHealthReviewEvidence } from './evidence';
import { createHealthReviewPort } from './port';
import type { HealthReviewEvidence, HealthReviewModel } from './port';

/** App-callable review uses the existing encrypted checkpoint tables and standard health/personal evidence tools. */
export async function runLocalHealthReview(input: {
  threadId: string;
  sourceId: string;
  safetyInput: unknown;
  model: HealthReviewModel;
  signal?: AbortSignal;
  clarification?: HealthReviewOptions['clarification'];
  evidence?: HealthReviewEvidence;
}) {
  if (input.signal?.aborted) return { status: 'cancelled' as const };
  const database = await openLocalAgentMemoryDatabase();
  await new SqlCipherAgentMemoryStorage(database).listRemovedSourceIds();
  let evidence = input.evidence;
  if (!evidence) {
    evidence = createHealthReviewEvidence(await openAiFeatureLocalData());
    if (!evidence) return { status: 'unavailable' as const };
  }
  return runHealthReviewGraph({
    ...input,
    store: input.model.store,
    checkpointer: new SqliteCheckpointSaver(
      createLangGraphCheckpointStorage(database, {
        sourceRecordId: input.sourceId,
      }),
    ),
    port: createHealthReviewPort({
      ...input,
      evidence,
      repository: await openLocalStorage(),
    }),
  });
}
