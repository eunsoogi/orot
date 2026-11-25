import { createLocalEvidenceData } from '../../../healthEvidence/localEvidenceData';
import { guardedNativeDatabase } from '../../../storage/protectedReadEpoch';
import { createConversationHeartRateTool } from '../conversationHeartRateTool';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { createTypedHeartRateDispatch } from '../typedHeartRateReusePolicy';
import { actualSendRetentionFixture } from '../testSupport/actualSendRetentionFixture';
import { record, scope } from '../testSupport/typedHeartRateRetentionFixture';

const mockProtection = jest.fn<Promise<boolean>, []>();
jest.mock('../../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: () => ({
    bridgeAvailable: true,
    protectedDataAvailable: mockProtection,
  }),
}));

it.each([false, true])(
  'only returns a typed local batch when the SQL owner survives the last native check (mutation=%s)',
  async mutate => {
    const { f } = await actualSendRetentionFixture('one');
    try {
      await f.repository.put('health_observation', record);
      const db = guardedNativeDatabase(f.database);
      const data = createLocalEvidenceData(db);
      const read = jest.fn(data.readHealthContext!);
      const dispatch = createTypedHeartRateDispatch();
      const registry = new LocalEvidenceReferenceRegistry();
      const signal = new AbortController().signal;
      const operationRunId = 'typed-heart-rate-batch';
      let mutatedAfterReproof = false;
      mockProtection.mockReset().mockImplementation(async () => {
        if (mutate && read.mock.calls.length === 2 && !mutatedAfterReproof) {
          // This protected mutation enters after both reads, while the
          // independent native protection check is still pending.
          await db.execute(
            "UPDATE health_observations SET payload_json = json_set(payload_json, '$.value.amount', ?) WHERE id = ?",
            [71, record.id],
          );
          mutatedAfterReproof = true;
        }
        return true;
      });
      const tool = createConversationHeartRateTool({
        read,
        acquireSourceEpoch: data.acquireHeartRateSourceEpoch!,
        registry,
        owner: { signal, operationRunId },
        observer: { confirmTypedHeartRate: async () => true },
        dispatch,
        model: {
          current: () => true,
          recheck: async () => true,
          details: {
            providerId: 'synthetic-local',
            modelId: 'synthetic-model',
            modelName: 'Synthetic model',
            recipient: 'This device',
            remoteProcessing: false,
          },
        },
      });
      const result = await tool.search({
        operationRunId,
        operationKey: 'explicit-typed-read',
        input: scope,
        signal,
        allowedScope: { sourceKinds: ['personal_record'] },
        resultLimit: 1,
        maxPayloadBytes: 1000,
      });
      expect(read).toHaveBeenCalledTimes(2);
      expect(mutatedAfterReproof).toBe(mutate);
      if (mutate) {
        expect(result).toMatchObject({
          items: [],
          coverage: [{ gaps: ['typed_heart_rate_proof_unavailable'] }],
        });
        expect(dispatch.active()).toBeUndefined();
      } else {
        expect(result).toMatchObject({
          items: [{ content: expect.stringContaining('"meanBpm":63') }],
        });
        expect(dispatch.active()).toBeDefined();
      }
    } finally {
      f.close();
    }
  },
);
