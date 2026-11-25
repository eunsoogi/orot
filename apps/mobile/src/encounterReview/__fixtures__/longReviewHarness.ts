import { APPLE_PCC_PROVIDER_ID, APPLE_PROVIDER_ID } from '@orot/provider-apple';
import { APPLE_PCC_MODEL_ID } from '../../providers/selection/privateCloudCompute';
import { providerSuccess } from '@orot/model-runtime';
import type { LanguageModelProvider } from '@orot/model-runtime';
import { resolveSelectedAiProvider } from '../../aiFeatures/integration/provider';
import { providerSelectionStore } from '../../providers/selection/keychainSelectionStore';
import { conversationExecutionNative } from '../../ragConversation/conversationExecutionNative';
import { guardedNativeDatabase } from '../../storage/protectedReadEpoch';
import { openLocalAgentMemoryDatabase } from '../../storage/secureDatabase';
import { sourceId, sqliteReviewFixture } from './sqliteReview';
import { EncounterReviewController } from '../controller';
import { createEncounterReviewService } from '../service';

export const fixture = sqliteReviewFixture();
afterEach(() => jest.restoreAllMocks());
export const recordingId = sourceId + ':long-route';
const dataText = 'Synthetic ninth line only.';

export async function harness(
  count = 9,
  lane: 'local' | 'pcc' | 'unsupported' = 'local',
) {
  const remote = lane !== 'local';
  const choice =
    lane === 'pcc'
      ? { providerId: APPLE_PCC_PROVIDER_ID, modelId: APPLE_PCC_MODEL_ID }
      : {
          providerId: remote
            ? 'chatgpt-plan:synthetic:choice'
            : APPLE_PROVIDER_ID,
          modelId: remote ? 'synthetic-remote' : 'synthetic-local',
        };
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
    id: choice.providerId,
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
      privacyBoundary: remote ? 'selected-context-remote' : 'on-device',
      availability: { status: 'available' },
    },
    recipient: remote ? 'synthetic-recipient' : 'on-device',
    remoteProcessing: remote,
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
  return {
    controller,
    final,
    repository,
    calls: () => calls,
    listeners,
    service,
    choice,
  };
}
