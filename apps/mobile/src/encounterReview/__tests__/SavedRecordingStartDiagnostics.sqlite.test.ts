import { providerSuccess } from '@orot/model-runtime';
import { resolveSelectedAiProvider } from '../../aiFeatures/integration/provider';
import { conversationExecutionNative } from '../../ragConversation/conversationExecutionNative';
import { providerDiagnostic } from '../../providers/diagnostics';
import {
  sqliteReviewFixture,
  sourceId,
  consent,
} from '../__fixtures__/sqliteReview';
import { createEncounterReviewService } from '../service';

jest.mock('../../aiFeatures/integration/provider', () => ({
  resolveSelectedAiProvider: jest.fn(),
}));
jest.mock('../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: jest.fn(),
}));
jest.mock('../../providers/diagnostics', () => ({
  ...jest.requireActual('../../providers/diagnostics'),
  providerDiagnostic: jest.fn(),
}));
jest.mock('../../agent/encounter/syntheticFixture', () => ({
  async seedSyntheticEncounter(
    repository: import('@orot/storage').RecordRepository,
    id: string,
  ) {
    const at = '2035-01-02T00:00:00Z';
    const metadata = {
      effectiveAt: at,
      recordedAt: at,
      ingestedAt: at,
      reviewState: { status: 'unreviewed' as const },
    };
    await repository.put('source_record', {
      ...metadata,
      id,
      sourceKind: 'audio_recording',
      recordingDurationMs: 3000,
      provenance: { origin: 'user_reported', sourceRecordIds: [] },
    });
    await repository.transcripts.append([
      {
        ...metadata,
        id: id + ':segment:r1',
        transcriptId: id + ':segment',
        recordingSourceId: id,
        segmentOrdinal: 0,
        revision: 1,
        text: '합성 항목을 언급했어요. 다음 기록을 확인해요.',
        language: 'ko',
        recordingDurationMs: 3000,
        audioRange: { startMs: 100, endMs: 2900 },
        provenance: {
          origin: 'derived',
          sourceRecordIds: [id],
          source: {
            system: 'synthetic-speech',
            sourceIdentifier: 'synthetic',
            sourceVersion: '1',
          },
        },
      },
    ]);
  },
}));

const fixture = sqliteReviewFixture();
const stages = () =>
  jest
    .mocked(providerDiagnostic)
    .mock.calls.filter(([, stage]) => stage.startsWith('encounter_review_'));

test.each(['current', 'locked', 'revised'])(
  'reports rejected evidence only while the selected source stays current: %s',
  async state => {
    let protectedAvailable = true;
    let correction: Promise<unknown> | undefined;
    jest
      .mocked(providerDiagnostic)
      .mockClear()
      .mockImplementation((_provider, stage, outcome) => {
        if (
          stage !== 'encounter_review_extraction' ||
          outcome !== 'invalid_output'
        )
          return;
        if (state === 'locked') protectedAvailable = false;
        if (state === 'revised')
          correction = fixture
            .repository()
            .transcripts.correct(
              sourceId + ':segment:r1',
              'Corrected synthetic statement.',
              '2035-01-02T00:00:12Z',
            );
      });
    const service = createEncounterReviewService();
    const start = () =>
      service.start(sourceId, consent, new AbortController().signal);
    jest
      .mocked(resolveSelectedAiProvider)
      .mockResolvedValueOnce({ status: 'unavailable' });
    expect(await start()).toEqual({ status: 'unavailable' });
    expect(stages()).toEqual([
      ['storage', 'encounter_review_selection', 'unavailable'],
    ]);

    const generate = jest.fn(async () =>
      providerSuccess({
        text: JSON.stringify({
          type: 'result',
          value: {
            candidates: [
              {
                kind: 'plan',
                text: '합성 계획',
                speaker: 'unknown',
                evidence: [
                  {
                    segmentId: sourceId + ':segment:r1',
                    startOffset: 0,
                    endOffset: 1,
                    quote: '불일치',
                  },
                ],
              },
            ],
          },
          citations: [sourceId + ':segment:r1'],
        }),
        toolCalls: [],
        finishReason: 'complete' as const,
      }),
    );
    const provider = {
      id: 'synthetic-encounter',
      kind: 'language-model' as const,
      displayName: 'Synthetic encounter',
      capabilities: {
        inputTypes: ['text' as const],
        streaming: false,
        structuredOutput: false,
        toolCalling: false,
      },
      generate,
    };
    jest.mocked(resolveSelectedAiProvider).mockResolvedValue({
      status: 'ready',
      selection: { providerId: provider.id, modelId: 'synthetic' },
      option: {
        provider,
        modelId: 'synthetic',
        displayName: 'Synthetic encounter',
        privacyBoundary: 'on-device',
        availability: { status: 'available' },
      },
      provider,
      modelId: 'synthetic',
      recipient: 'on-device',
      remoteProcessing: false,
      onDeviceSelectionWitness: {
        isCurrent: () => true,
        subscribe: () => () => {},
      },
    });
    jest.mocked(conversationExecutionNative).mockReturnValue({
      bridgeAvailable: true,
      currentPhase: () => 'active',
      begin: async () => true,
      end: () => {},
      isActive: async () => true,
      protectedDataAvailable: jest
        .fn(async () => {
          await correction;
          return protectedAvailable;
        })
        .mockResolvedValueOnce(false),
      subscribe: () => () => {},
    });
    expect(await start()).toEqual({ status: 'unavailable' });
    expect(generate).not.toHaveBeenCalled();
    expect(await start()).toEqual({
      status: state === 'current' ? 'invalid-candidates' : 'unavailable',
    });
    expect(generate).toHaveBeenCalled();
    expect(Boolean(correction)).toBe(state === 'revised');
    expect(stages()).toEqual([
      ['storage', 'encounter_review_selection', 'unavailable'],
      ['storage', 'encounter_review_native_admission', 'unavailable'],
      ['storage', 'encounter_review_extraction', 'invalid_output'],
      ...(state === 'locked'
        ? [['storage', 'encounter_review_native_admission', 'unavailable']]
        : []),
    ]);
    expect(await fixture.rows()).toEqual([]);
    expect(consent.authorize).not.toHaveBeenCalled();
  },
);
