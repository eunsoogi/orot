import { createLocalEvidenceData } from '../../../healthEvidence/localEvidenceData';
import { guardedNativeDatabase } from '../../../storage/protectedReadEpoch';
import { createConversationHeartRateTool } from '../conversationHeartRateTool';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { createTypedHeartRateDispatch } from '../typedHeartRateReusePolicy';
import { actualSendRetentionFixture } from '../testSupport/actualSendRetentionFixture';
import { record, scope } from '../testSupport/typedHeartRateRetentionFixture';

const mockProtection = jest.fn<Promise<boolean>, []>();

it.each(['unchanged', 'sql-mutation', 'native-lock'] as const)(
  'only returns a typed local batch when final SQL and native protection remain current (%s)',
  async scenario => {
    const { f } = await actualSendRetentionFixture('one');
    try {
      await f.repository.put('health_observation', record);
      const db = guardedNativeDatabase(f.database);
      const data = createLocalEvidenceData(db);
      const read = jest.fn(data.readHealthContext!);
      const dispatch = createTypedHeartRateDispatch();
      const registry = new LocalEvidenceReferenceRegistry();
      const before = registry.snapshot();
      const signal = new AbortController().signal;
      const operationRunId = 'typed-heart-rate-batch';
      const mutate = scenario === 'sql-mutation';
      let lockedAfterReproof = false;
      let finalModelCheck = false;
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
        return !lockedAfterReproof;
      });
      const tool = createConversationHeartRateTool({
        read,
        protectedDataAvailable: mockProtection,
        acquireSourceEpoch: data.acquireHeartRateSourceEpoch!,
        registry,
        owner: { signal, operationRunId },
        observer: { confirmTypedHeartRate: async () => true },
        dispatch,
        model: {
          current: () => true,
          recheck: async () => {
            if (read.mock.calls.length === 2) {
              finalModelCheck = true;
              await Promise.resolve();
              lockedAfterReproof = scenario === 'native-lock';
            }
            return true;
          },
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
      expect(finalModelCheck).toBe(true);
      expect(lockedAfterReproof).toBe(scenario === 'native-lock');
      if (scenario !== 'unchanged') {
        expect(result).toMatchObject({
          items: [],
          coverage: [{ gaps: ['typed_heart_rate_proof_unavailable'] }],
        });
        expect(dispatch.active()).toBeUndefined();
        expect(registry.snapshot()).toEqual(before);
      } else {
        expect(result).toMatchObject({
          items: [{ content: expect.stringContaining('"meanBpm":63') }],
        });
        expect(dispatch.active()).toBeDefined();
        expect(registry.snapshot()).not.toEqual(before);
      }
    } finally {
      f.close();
    }
  },
);
