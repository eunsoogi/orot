import { APPLE_PROVIDER_ID } from '@orot/provider-apple';
import { providerSuccess } from '@orot/model-runtime';
import type { LanguageModelProvider } from '@orot/model-runtime';
import { resolveSelectedAiProvider } from '../../aiFeatures/integration/provider';
import { providerSelectionStore } from '../../providers/selection/keychainSelectionStore';
import { conversationExecutionNative } from '../../ragConversation/conversationExecutionNative';
import { guardedNativeDatabase } from '../../storage/protectedReadEpoch';
import { openLocalAgentMemoryDatabase } from '../../storage/secureDatabase';
import {
  consent,
  sourceId,
  sqliteReviewFixture,
} from '../__fixtures__/sqliteReview';
import { EncounterReviewController } from '../controller';
import { createEncounterReviewService } from '../service';

jest.mock('../../aiFeatures/integration/provider', () => ({
  resolveSelectedAiProvider: jest.fn(),
}));
jest.mock('../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: jest.fn(),
}));

const fixture = sqliteReviewFixture();
afterEach(() => jest.restoreAllMocks());
const dataText = 'Synthetic ninth line only.';
const choice = { providerId: APPLE_PROVIDER_ID, modelId: 'synthetic-local' };

async function harness() {
  const repository = fixture.repository();
  const [first] = await repository.transcripts.listForRecording(sourceId);
  if (!first) throw new Error('Synthetic seed missing.');
  const segments = Array.from({ length: 8 }, (_, i) => {
    const transcriptId = sourceId + ':extra-' + i;
    return {
      ...first,
      id: transcriptId + ':r1',
      transcriptId,
      segmentOrdinal: i + 1,
      text: dataText,
      audioRange: { startMs: 2900 + i, endMs: 2901 + i },
    };
  });
  await repository.transcripts.append(segments);
  const final = segments.at(-1)!;
  const listeners = new Set<
    Parameters<
      NonNullable<ReturnType<typeof conversationExecutionNative>>['subscribe']
    >[0]
  >();
  jest.mocked(conversationExecutionNative).mockReturnValue({
    bridgeAvailable: true,
    currentPhase: () => 'active',
    protectedDataAvailable: async () => true,
    begin: async () => false,
    end: () => {},
    isActive: async () => false,
    subscribe: listener => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  });
  const guarded = guardedNativeDatabase(fixture.database());
  jest.mocked(openLocalAgentMemoryDatabase).mockResolvedValue(guarded);
  jest.spyOn(providerSelectionStore, 'load').mockResolvedValue(choice);
  let calls = 0;
  const provider: LanguageModelProvider = {
    kind: 'language-model',
    id: APPLE_PROVIDER_ID,
    displayName: 'Synthetic local',
    capabilities: {
      inputTypes: ['text'],
      streaming: false,
      structuredOutput: false,
      toolCalling: false,
    },
    async generate() {
      calls++;
      if (calls > 2) throw new Error('No model replay.');
      const terminal = calls === 2;
      return providerSuccess({
        text: JSON.stringify({
          type: 'result',
          value: {
            candidates: terminal
              ? [
                  {
                    kind: 'plan',
                    speaker: 'unknown',
                    text: dataText,
                    evidence: [
                      {
                        segmentId: final.id,
                        startOffset: 0,
                        endOffset: dataText.length,
                        quote: dataText,
                      },
                    ],
                  },
                ]
              : [],
          },
          citations: terminal ? [final.id] : [],
        }),
        toolCalls: [],
        finishReason: 'complete',
      });
    },
  };
  jest.mocked(resolveSelectedAiProvider).mockResolvedValue({
    status: 'ready',
    selection: choice,
    provider,
    modelId: choice.modelId,
    option: {
      provider,
      modelId: choice.modelId,
      displayName: 'Synthetic local',
      privacyBoundary: 'on-device',
      availability: { status: 'available' },
    },
    recipient: 'on-device',
    remoteProcessing: false,
    onDeviceSelectionWitness: {
      isCurrent: () => true,
      subscribe: () => () => {},
    },
  });
  const service = createEncounterReviewService();
  const controller = new EncounterReviewController(
    sourceId,
    service,
    jest.fn(),
  );
  return { controller, final, repository, calls: () => calls, listeners };
}

test.each(['save', 'edit', 'lock', 'dispose'] as const)(
  'production long route reaches only a complete exact review and handles %s',
  async mode => {
    const f = await harness();
    try {
      await f.controller.start(consent);
      expect(f.controller.state.status).toBe('pending');
      expect(f.controller.state.pending?.segments).toHaveLength(9);
      expect(f.controller.state.pending?.segments.at(-1)?.id).toBe(f.final.id);
      expect(f.controller.state.candidates[0]?.evidence[0]?.segmentId).toBe(
        f.final.id,
      );
      expect(f.calls()).toBe(2);
      expect(await fixture.rows()).toHaveLength(0);
      if (mode === 'lock') {
        f.listeners.forEach(listener =>
          listener({ kind: 'protectedData', available: false }),
        );
        expect(f.controller.state.status).toBe('unavailable');
      } else if (mode === 'dispose') {
        f.controller.dispose();
        f.controller.activate();
        await f.controller.restore();
        expect(f.controller.state.status).not.toBe('pending');
      } else {
        if (mode === 'edit')
          await f.repository.transcripts.correct(
            f.final.id,
            'Retired.',
            f.final.recordedAt,
          );
        await f.controller.decide('approve');
        expect(f.controller.state.status).toBe(
          mode === 'save' ? 'saved' : 'unavailable',
        );
      }
      expect(await fixture.rows()).toHaveLength(mode === 'save' ? 1 : 0);
      expect(f.calls()).toBe(2);
    } finally {
      f.controller.dispose();
    }
  },
);
