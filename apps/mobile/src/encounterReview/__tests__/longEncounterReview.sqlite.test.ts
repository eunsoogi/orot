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

jest.mock('../../storage/secureDatabase', () => ({
  openLocalStorage: jest.fn(),
  openLocalAgentMemoryDatabase: jest.fn(),
}));
jest.mock('../../aiFeatures/integration/provider', () => ({
  resolveSelectedAiProvider: jest.fn(),
}));
jest.mock('../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: jest.fn(),
}));

const fixture = sqliteReviewFixture();
afterEach(() => jest.restoreAllMocks());
const recordingId = sourceId + ':long-route';
const dataText = 'Synthetic ninth line only.';
const choice = { providerId: APPLE_PROVIDER_ID, modelId: 'synthetic-local' };

async function harness(count = 9) {
  const repository = fixture.repository();
  const recording = await repository.get('source_record', sourceId);
  const [first] = await repository.transcripts.listForRecording(sourceId);
  if (!recording || !first) throw new Error('Synthetic seed missing.');
  await repository.put('source_record', { ...recording, id: recordingId });
  const segments = Array.from({ length: count }, (_, i) => {
    const transcriptId = recordingId + ':segment-' + i;
    return {
      ...first,
      id: transcriptId + ':r1',
      transcriptId,
      recordingSourceId: recordingId,
      provenance: { ...first.provenance, sourceRecordIds: [recordingId] },
      segmentOrdinal: i,
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
      if (calls > Math.ceil(count / 8)) throw new Error('No model replay.');
      const included =
        count > 32
          ? segments.slice((calls - 1) * 8, calls * 8)
          : calls === 2
            ? [final]
            : [];
      return providerSuccess({
        text: JSON.stringify({
          type: 'result',
          value: {
            candidates: included.map(segment => ({
              kind: 'plan',
              speaker: 'unknown',
              text: dataText,
              evidence: [
                {
                  segmentId: segment.id,
                  startOffset: 0,
                  endOffset: dataText.length,
                  quote: dataText,
                },
              ],
            })),
          },
          citations: included.map(segment => segment.id),
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
    recordingId,
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

test('reviews all 33 on-device candidates; explicitly saves only the terminal evidence', async () => {
  const f = await harness(33);
  try {
    await f.controller.start(consent);
    expect(f.controller.state.status).toBe('pending');
    expect(f.controller.state.candidates).toHaveLength(33);
    expect(f.controller.state.selected).toEqual([]);
    expect(f.calls()).toBe(5);
    expect(await fixture.rows()).toHaveLength(0);
    await f.controller.decide('approve');
    expect(f.controller.state.status).toBe('pending');
    expect(await fixture.rows()).toHaveLength(0);
    const last = f.controller.state.candidates.at(-1)!;
    expect(last.evidence[0]?.segmentId).toBe(f.final.id);
    f.controller.toggle(last.id);
    await f.controller.decide('approve');
    expect(f.controller.state.status).toBe('saved');
    expect(await fixture.rows()).toHaveLength(1);
    expect(f.calls()).toBe(5);
  } finally {
    f.controller.dispose();
  }
});
