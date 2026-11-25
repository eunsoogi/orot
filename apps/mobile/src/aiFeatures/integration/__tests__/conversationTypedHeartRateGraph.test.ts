import { createLocalEvidenceData } from '../../../healthEvidence/localEvidenceData';
import { guardedNativeDatabase } from '../../../storage/protectedReadEpoch';
import { HealthObservationSchema } from '@orot/domain';
import {
  providerFailure,
  providerSuccess,
  type LanguageModelRequest,
} from '@orot/model-runtime';
import { createRagConversationService } from '../ragConversationService';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { actualSendRetentionFixture } from '../testSupport/actualSendRetentionFixture';
import { publicEvidenceFixture } from '../testSupport/publicWebEvidenceTestSupport';
import { runRagConversationTurn } from '../../../ragConversation/service';

const mockLoadChoice = jest.fn();
const mockSelectionWitness = jest.fn(() => () => true);
jest.mock('../../../providers/selection/keychainSelectionStore', () => ({
  ...jest.requireActual('../../../providers/selection/keychainSelectionStore'),
  providerSelectionStore: {
    load: () => mockLoadChoice(),
    liveWitness: () => mockSelectionWitness(),
  },
}));
jest.mock('../../../providers/chatGPTConsentIdentity', () => ({
  ...jest.requireActual('../../../providers/chatGPTConsentIdentity'),
  readChatGPTConsentCredential: async () => ({
    epoch: 'synthetic',
    isCurrent: () => true,
  }),
}));
const mockProtectedData = jest.fn(async () => true);
jest.mock('../../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: () => ({
    bridgeAvailable: true,
    protectedDataAvailable: mockProtectedData,
  }),
}));

const scope = {
  category: 'walking_heart_rate_average',
  fromInclusive: '2026-10-01T00:00:00Z',
  toExclusive: '2026-10-03T00:00:00Z',
};
const at = '2026-10-02T00:00:00Z';
const metric = HealthObservationSchema.parse({
  id: 'healthkit:walkingHeartRateAverage:private-fixture',
  effectiveAt: at,
  recordedAt: at,
  ingestedAt: at,
  provenance: {
    origin: 'imported',
    sourceRecordIds: ['private-fixture'],
    source: { system: 'healthkit' },
  },
  reviewState: { status: 'unreviewed' },
  observationKind: 'measurement',
  concept: scope.category,
  value: { kind: 'quantity', amount: 137, unit: 'count/min' },
});

test.each([
  'authorized',
  'denied',
  'recipient-replaced',
  'source-deleted-during-final-check',
  'locked-during-final-recipient-check',
] as const)('text graph %s gates exact typed outgoing evidence', async mode => {
  const { f, data } = await actualSendRetentionFixture('one');
  const guardedDatabase = guardedNativeDatabase(f.database);
  const protectedData = createLocalEvidenceData(guardedDatabase);
  data.readHealthContext = protectedData.readHealthContext!;
  Object.assign(data, {
    acquireHeartRateSourceEpoch: protectedData.acquireHeartRateSourceEpoch,
  });
  let enteredProtectedFinalWindow = false;
  let lateDeletion = false;
  let lockedDuringFinalCheck = false;
  mockProtectedData.mockReset().mockImplementation(async () => {
    if (
      mode === 'source-deleted-during-final-check' &&
      enteredProtectedFinalWindow &&
      !lateDeletion
    ) {
      lateDeletion = true;
      await guardedDatabase.execute(
        'DELETE FROM health_observations WHERE id = ?',
        [metric.id],
      );
    }
    return true;
  });
  Object.assign(data, {
    acquireHeartRateSourceEpoch: () => {
      enteredProtectedFinalWindow = true;
      return protectedData.acquireHeartRateSourceEpoch!();
    },
  });
  try {
    await f.repository.put('health_observation', metric);
    const fake = publicEvidenceFixture();
    mockLoadChoice.mockReset().mockImplementation(async () => {
      if (
        mode === 'locked-during-final-recipient-check' &&
        enteredProtectedFinalWindow
      ) {
        // Native event delivery can lag the positive probe while the owner recheck is pending.
        await Promise.resolve();
        lockedDuringFinalCheck = true;
        mockProtectedData.mockResolvedValue(false);
      }
      return fake.selected.selection;
    });
    const confirm = jest.fn(async () => mode !== 'denied');
    const generate = jest.fn(async (request: LanguageModelRequest) => {
      if (generate.mock.calls.length === 1) {
        expect(JSON.stringify(request)).not.toContain('meanBpm');
        return providerSuccess({
          text: '',
          finishReason: 'tool_calls' as const,
          toolCalls: [
            {
              id: 'typed-proposal',
              name: 'local-typed-heart-rate',
              arguments: scope,
            },
          ],
        });
      }
      // The fake transport records the request; it never calls a provider.
      return providerFailure({
        code: 'provider_unavailable',
        message: 'Synthetic transport stop.',
        retryable: false,
      });
    });
    const provider = {
      ...fake.selected.provider,
      searchPublicWeb: undefined,
      generate,
      capabilities: {
        ...fake.selected.provider.capabilities,
        toolCalling: true,
        streaming: false,
        structuredOutput: false,
      },
    };
    const external = jest.fn(async () => {
      throw new Error('Unexpected public query.');
    });
    const send = createRagConversationService({
      consent: fake.consent,
      queryConsent: { authorize: async () => 'denied' },
      externalEvidence: { search: external },
      loadLocalData: async () => data,
      selectedAi: async () => ({
        ...fake.selected,
        provider,
        option: { ...fake.selected.option, provider },
      }),
      registry: new LocalEvidenceReferenceRegistry(),
      ragRunner: runRagConversationTurn,
    });
    let changedAtHandoff = false;
    await send(
      '10월 1일에서 2일까지 걷기 평균 심박수를 알려 주세요.',
      [],
      new AbortController().signal,
      {
        inputOrigin: 'composer',
        suppressContextualOpening: true,
        confirmTypedHeartRate: confirm,
        onToolEvent: event => {
          if (
            mode === 'recipient-replaced' &&
            event.toolName === 'local-typed-heart-rate' &&
            event.status === 'completed'
          ) {
            changedAtHandoff = true;
            mockLoadChoice.mockResolvedValue({
              ...fake.selected.selection,
              modelId: 'different',
            });
          }
        },
      },
    );
    expect(changedAtHandoff).toBe(mode === 'recipient-replaced');
    expect(lateDeletion).toBe(mode === 'source-deleted-during-final-check');
    expect(lockedDuringFinalCheck).toBe(
      mode === 'locked-during-final-recipient-check',
    );
    expect(generate).toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledTimes(1);
    const calls = generate.mock.calls.map(([call]) => JSON.stringify(call));
    const scoped = calls.filter(call => call.includes('meanBpm'));
    expect(scoped.length).toBe(mode === 'authorized' ? 1 : 0);
    expect(scoped.join()).not.toContain('private-fixture');
    if (mode === 'authorized') expect(scoped[0]).toContain('137');
    expect(external).not.toHaveBeenCalled();
  } finally {
    f.close();
  }
});
