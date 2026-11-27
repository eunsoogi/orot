import { APPLE_PROVIDER_ID } from '@orot/provider-apple';
import {
  providerSuccess,
  type LanguageModelRequest,
} from '@orot/model-runtime';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  original,
  source,
} from '../../transcription/testSupport/transcriptEvidenceServiceFixtures';
import { apple } from '../../aiFeatures/integration/featureServiceFixtures';
import type { conversationExecutionNative } from '../../ragConversation/conversationExecutionNative';
import { createRecordingTitleGeneration } from '../recordingTitleGeneration';

test.each([
  'save',
  'correction',
  'deleted source',
  'provider changed',
  'locked',
  'remote',
] as const)('exact current app-owned recording title: %s', async scenario => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const repo = createRecordRepository(connection.database);
    await repo.put('source_record', source);
    const rows = Array.from({ length: 17 }, (_, i) => ({
      ...original,
      id: `${source.id}:segment:${i}:r1`,
      transcriptId: `${source.id}:segment:${i}`,
      segmentOrdinal: i,
      audioRange: { startMs: 100 * i, endMs: 100 * (i + 1) },
      effectiveAt: new Date(
        Date.parse(original.effectiveAt) + 100 * i,
      ).toISOString(),
      text: 'Synthetic topic ' + i,
    }));
    await repo.transcripts.append(rows);
    type Native = NonNullable<ReturnType<typeof conversationExecutionNative>>;
    const handlers = new Set<Parameters<Native['subscribe']>[0]>();
    const native: Native = {
      currentPhase: () => 'active',
      bridgeAvailable: true,
      begin: async () => false,
      end() {},
      isActive: async () => false,
      protectedDataAvailable: async () => true,
      subscribe(handler) {
        handlers.add(handler);
        return () => {
          handlers.delete(handler);
        };
      },
    };
    let current = true;
    let selectionChange: (() => void) | undefined;
    const generate = jest.fn(async (request: LanguageModelRequest) => {
      const wire = JSON.stringify(request);
      expect(wire).toContain('Synthetic topic 16');
      expect(wire).not.toContain(source.id);
      expect(wire).not.toContain(source.title);
      expect(request.tools).toBeUndefined();
      return providerSuccess({
        text: '{"title":"가벼운 운동 상담"}',
        toolCalls: [],
        finishReason: 'complete' as const,
      });
    });
    const provider = { ...apple.provider, id: APPLE_PROVIDER_ID, generate };
    const start = createRecordingTitleGeneration({
      native: () => native,
      readSelection: async () => ({
        providerId:
          scenario === 'remote' ? 'chatgpt-plan:synthetic' : APPLE_PROVIDER_ID,
        modelId: apple.modelId,
      }),
      storage: async () => ({
        openLocalAgentMemoryDatabase: async () => connection.database,
        isCurrentLocalAgentMemoryDatabase: db => db === connection.database,
      }),
      resolve: async () => ({
        status: 'ready',
        selection: { providerId: provider.id, modelId: apple.modelId },
        recipient: 'synthetic',
        modelId: apple.modelId,
        provider,
        option: { ...apple, provider },
        remoteProcessing: scenario === 'remote',
        onDeviceSelectionWitness: {
          isCurrent: () => current,
          subscribe(listener) {
            selectionChange = listener;
            return () => {
              selectionChange = undefined;
            };
          },
        },
      }),
    });
    const result = await start(
      source.id,
      new AbortController().signal,
      () => true,
    );
    if (scenario === 'remote') {
      expect(result).toBeUndefined();
      expect(generate).not.toHaveBeenCalled();
      return;
    }
    expect(result?.title).toBe('가벼운 운동 상담');
    expect(generate).toHaveBeenCalledTimes(1);
    expect((await repo.get('source_record', source.id))?.title).toBe(
      source.title,
    );
    if (scenario === 'correction')
      await repo.transcripts.correct(
        rows[16]!.id,
        'Updated synthetic text',
        '2026-10-05T10:01:00.000Z',
      );
    if (scenario === 'deleted source')
      await repo.delete('source_record', source.id);
    if (scenario === 'provider changed') {
      current = false;
      selectionChange?.();
    }
    if (scenario === 'locked')
      for (const handler of handlers)
        handler({ kind: 'protectedData', available: false });
    expect(await result?.save()).toBe(scenario === 'save');
    expect(await result?.save()).toBe(false);
    if (scenario !== 'deleted source')
      expect((await repo.get('source_record', source.id))?.title).toBe(
        scenario === 'save' ? '가벼운 운동 상담' : source.title,
      );
    expect(handlers.size).toBe(0);
  } finally {
    connection.close();
  }
});
