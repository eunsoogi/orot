import { createAgentMemory } from '@orot/agent-memory';
import type { AgentMemoryInput } from '@orot/agent-memory';
import {
  providerSuccess,
  type LanguageModelProvider,
} from '@orot/model-runtime';
import {
  runMultiAgentWorkflow,
  SqliteCheckpointSaver,
  type EvidenceBatch,
  type EvidenceReference,
} from '@orot/agent-runtime';
import { createLangGraphCheckpointStorage } from '@orot/storage';
import type { SqlDatabase } from '@orot/storage';
import { createPersistentDeletionWorkflow } from './deletionAwareEvidenceTestSupport';
import { createLocalE5RagService } from '../../rag/localE5RagService';
import { SqlCipherAgentMemoryStorage } from '../../storage/agentMemoryStorage';
import {
  openLocalAgentMemoryDatabase,
  openLocalStorage,
} from '../../storage/secureDatabase';
import {
  removeLocalSourceWithMemory,
  type SourceMemoryDeletionResult,
} from '../removeSourceWithMemory';

const initialResponses = [
  JSON.stringify({ type: 'request_evidence', need: 'missing_coverage' }),
  JSON.stringify({
    toolId: 'local-search',
    sourceKind: 'personal_record',
    input: { query: 'synthetic source' },
  }),
];

export function providerFor(responses: string[]) {
  const generate = jest.fn(async () => {
    const text =
      responses.shift() ??
      JSON.stringify({
        type: 'result',
        value: { summary: 'Prepared.' },
        citations: [],
      });
    return providerSuccess({
      text,
      toolCalls: [],
      finishReason: 'complete' as const,
    });
  });
  const provider: LanguageModelProvider = {
    kind: 'language-model',
    id: 'synthetic-provider',
    displayName: 'Synthetic provider',
    capabilities: {
      inputTypes: ['text'],
      streaming: false,
      structuredOutput: false,
      toolCalling: false,
    },
    generate,
  };
  return { provider, generate };
}

export function evidenceFor(reference: EvidenceReference): EvidenceBatch {
  return {
    items: [{ ...reference, content: 'Synthetic retained evidence.' }],
    coverage: [
      {
        sourceKind: reference.sourceKind,
        searchedSourceIds: [reference.sourceId],
        gaps: [],
        truncated: false,
        resultLimit: 5,
        returnedCount: 1,
      },
    ],
    conflicts: [],
  };
}

/** Persists a real graph boundary before simulating process interruption. */
export async function persistGraphResumeBoundary(
  database: SqlDatabase,
  reference: EvidenceReference,
  operationRunId: string,
  boundary: 'safe_revision' | 'pending_model' = 'safe_revision',
): Promise<string> {
  const saver = new SqliteCheckpointSaver(
    createLangGraphCheckpointStorage(database),
  );
  const config = { configurable: { thread_id: operationRunId } };
  const scripted = providerFor([...initialResponses]);
  const options = createPersistentDeletionWorkflow(
    reference,
    scripted.provider,
    saver,
    jest.fn(async () => true),
    jest.fn(async () => evidenceFor(reference)),
    operationRunId,
  );
  const persist = saver.put.bind(saver);
  let boundarySaved = false;
  jest.spyOn(saver, 'put').mockImplementation(async (...args) => {
    const [, checkpoint] = args;
    const channels = checkpoint.channel_values as Record<string, unknown>;
    const pending = channels.pendingOperation as { kind?: unknown } | undefined;
    const next = await persist(...args);
    if (
      !boundarySaved &&
      channels.phase === 'revised_response' &&
      (boundary === 'pending_model' ? pending?.kind === 'model' : !pending)
    ) {
      // Simulate process termination only after the selected graph state is durable.
      boundarySaved = true;
      throw new Error('Synthetic stop after a graph checkpoint.');
    }
    return next;
  });

  await expect(
    runMultiAgentWorkflow(options, { config }),
  ).resolves.toMatchObject({
    status: 'unavailable',
  });
  expect(boundarySaved).toBe(true);
  const saved = await saver.getTuple(config);
  expect(saved?.checkpoint.channel_values).toMatchObject({
    phase: 'revised_response',
    terminal: false,
  });
  expect(saved?.checkpoint.channel_values).toMatchObject({
    evidenceReferences: [
      expect.objectContaining({
        sourceId: reference.sourceId,
        evidenceId: reference.evidenceId,
      }),
    ],
  });
  const pending = (saved?.checkpoint.channel_values as Record<string, unknown>)
    .pendingOperation;
  if (boundary === 'pending_model')
    expect(pending).toMatchObject({ kind: 'model' });
  else expect(pending).toBeUndefined();
  return saved!.checkpoint.id;
}

/** Adds a newer pending snapshot while retaining the earlier safe checkpoint for replay tests. */
export async function appendPendingModelCheckpoint(
  database: SqlDatabase,
  threadId: string,
): Promise<{ safeCheckpointId: string; pendingCheckpointId: string }> {
  const saver = new SqliteCheckpointSaver(
    createLangGraphCheckpointStorage(database),
  );
  const config = { configurable: { thread_id: threadId } };
  const safe = await saver.getTuple(config);
  if (!safe?.metadata)
    throw new Error(
      'A safe checkpoint with metadata is required before adding a pending snapshot.',
    );
  const pendingCheckpoint = {
    ...safe.checkpoint,
    id: `${safe.checkpoint.id}-pending-model`,
    channel_values: {
      ...safe.checkpoint.channel_values,
      pendingOperation: {
        kind: 'model' as const,
        operationKey: `${threadId}:pending-model`,
      },
    },
  };
  await saver.put(
    safe.config,
    pendingCheckpoint,
    safe.metadata,
    safe.checkpoint.channel_versions,
  );
  const latest = await saver.getTuple(config);
  if (!latest) throw new Error('The pending checkpoint was not persisted.');
  return {
    safeCheckpointId: safe.checkpoint.id,
    pendingCheckpointId: latest.checkpoint.id,
  };
}

/** Removes a checkpoint source through the app service and its real memory library boundary. */
export async function removePersistedSourceThroughApplicationPath(
  database: SqlDatabase,
  repository: Awaited<ReturnType<typeof openLocalStorage>>,
  sourceId: string,
  evidenceId: string,
): Promise<SourceMemoryDeletionResult> {
  const storage = new SqlCipherAgentMemoryStorage(database);
  const memory = await createAgentMemory({
    // Keep the service-path fixture deterministic and local without a model provider.
    embedder: {
      async embed(texts: string[]) {
        return texts.map(text => {
          const vector = new Float32Array(16);
          for (const character of text)
            vector[character.charCodeAt(0) % vector.length] += 1;
          return vector;
        });
      },
    },
    storage,
  });
  try {
    const linkedMemory: AgentMemoryInput = {
      memoryKey: `source:${sourceId}`,
      text: 'Synthetic memory linked to a source and evidence span.',
      kind: 'task_context',
      provenance: {
        sourceIds: [sourceId, evidenceId],
        reviewState: 'human_reviewed',
      },
    };
    await memory.remember(linkedMemory);
    jest.mocked(openLocalAgentMemoryDatabase).mockResolvedValue(database);
    jest.mocked(openLocalStorage).mockResolvedValue(repository);
    jest.mocked(createLocalE5RagService).mockReturnValue({
      prepare: jest.fn().mockResolvedValue(undefined),
      deleteChunks: jest.fn().mockResolvedValue(undefined),
    } as never);

    // The recording-library service emits durable source tombstones before graph resume.
    return await removeLocalSourceWithMemory(sourceId, memory);
  } finally {
    await memory.close();
  }
}
