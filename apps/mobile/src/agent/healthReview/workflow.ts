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
import { LocalEvidenceReferenceRegistry } from '../../aiFeatures/integration/evidenceRegistry';
import { openAiFeatureLocalData } from '../../aiFeatures/integration/localData';
import { toolsFor } from '../../aiFeatures/integration/featureServiceExecution';
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
    const registry = new LocalEvidenceReferenceRegistry();
    const tools = toolsFor(
      undefined,
      await openAiFeatureLocalData(),
      registry,
      4,
      true,
    );
    const trends = tools.find(tool => tool.id === 'local-health-context');
    const records = tools.find(tool => tool.id === 'local-personal-records');
    if (!trends || !records) return { status: 'unavailable' as const };
    evidence = {
      trends,
      records,
      revalidate: (references, signal) =>
        registry.revalidateEvidence(references, signal),
    };
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
