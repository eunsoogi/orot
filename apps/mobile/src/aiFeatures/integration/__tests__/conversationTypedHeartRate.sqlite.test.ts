import { createLocalEvidenceData } from '../../../healthEvidence/localEvidenceData';
import { guardedNativeDatabase } from '../../../storage/protectedReadEpoch';
import {
  assertTypedHeartRateRetention,
  fixtureBpm,
  record,
  scope,
} from '../testSupport/typedHeartRateRetentionFixture';
import { actualSendRetentionFixture } from '../testSupport/actualSendRetentionFixture';
import { createRagConversationService } from '../ragConversationService';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { publicEvidenceFixture } from '../testSupport/publicWebEvidenceTestSupport';
import type { RagConversationObserver } from '../../../ragConversation/conversationObserver';
const mockBridgeAvailable = jest.fn(() => true);
const mockProtection = jest.fn(async () => true);
const mockLoadChoice = jest.fn();
const mockSelectionWitness = jest.fn(() => () => true);
const mockCredential = jest.fn(async () => ({
  epoch: 'synthetic',
  isCurrent: () => true,
}));
jest.mock('../../../providers/selection/keychainSelectionStore', () => ({
  ...jest.requireActual('../../../providers/selection/keychainSelectionStore'),
  providerSelectionStore: {
    load: () => mockLoadChoice(),
    liveWitness: () => mockSelectionWitness(),
  },
}));
jest.mock('../../../providers/chatGPTConsentIdentity', () => ({
  ...jest.requireActual('../../../providers/chatGPTConsentIdentity'),
  readChatGPTConsentCredential: () => mockCredential(),
}));
jest.mock('../../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: () => ({
    bridgeAvailable: mockBridgeAvailable(),
    protectedDataAvailable: mockProtection,
  }),
}));
const operationRunId = 'synthetic-typed-heart-rate-turn';
const typedTool = 'local-typed-heart-rate';
test.each([
  'approved',
  'declined',
  'retired',
  'workout',
  'shortcut',
  'wrong-owner',
  'locked',
  'bridge-unavailable',
  'changed-after-read',
  'recipient-changed',
  'too-wide',
] as const)(
  'ordinary send: %s never bypasses typed approval or exact source ownership',
  async mode => {
    mockProtection.mockReset().mockResolvedValue(true);
    mockBridgeAvailable.mockReturnValue(mode !== 'bridge-unavailable');
    const { f, data } = await actualSendRetentionFixture('one');
    const guardedDatabase = guardedNativeDatabase(f.database);
    const protectedData = createLocalEvidenceData(guardedDatabase);
    data.readHealthContext = protectedData.readHealthContext!;
    Object.assign(data, {
      acquireHeartRateSourceEpoch: protectedData.acquireHeartRateSourceEpoch,
    });
    const { consent, selected } = publicEvidenceFixture();
    mockLoadChoice.mockReset().mockResolvedValue(selected.selection);
    const controller = new AbortController();
    const registry = new LocalEvidenceReferenceRegistry();
    const externalSearch = jest.fn(async () => {
      throw new Error('Unexpected external search.');
    });
    const sourceRead = data.readHealthContext!;
    const read = jest.spyOn(data, 'readHealthContext');
    let changed = false;
    if (mode === 'changed-after-read')
      read.mockImplementation(async (...args) => {
        const result = await sourceRead(...args);
        if (args[0].typedHeartRateCategory && !changed) {
          changed = true;
          await f.repository.put('health_observation', {
            ...record,
            value: { kind: 'quantity', amount: 71, unit: 'count/min' },
          });
        }
        return result;
      });
    let whilePending: (() => Promise<void>) | undefined;
    const confirm = jest.fn(
      async (_proposal: unknown, _recipient: unknown, _signal: AbortSignal) => {
        expect(
          read.mock.calls.filter(call => call[0].typedHeartRateCategory),
        ).toHaveLength(0);
        if (mode === 'retired') controller.abort();
        if (mode === 'locked') mockProtection.mockResolvedValue(false);
        if (mode === 'recipient-changed')
          mockLoadChoice.mockResolvedValue({
            ...selected.selection,
            modelId: 'other',
          });
        if (mode === 'approved') await whilePending?.();
        return mode !== 'declined';
      },
    );
    try {
      await f.repository.put('health_observation', record);
      let returned = false;
      let acceptedSnapshot:
        ReturnType<LocalEvidenceReferenceRegistry['snapshot']> | undefined;
      const send = createRagConversationService({
        consent,
        queryConsent: { authorize: async () => 'denied' },
        externalEvidence: { search: externalSearch },
        loadLocalData: async () => data,
        selectedAi: async () => selected,
        registry,
        createOperationRunId: () => operationRunId,
        ragRunner: async options => {
          const tool = options.workflow.tools.find(
            item => item.id === typedTool,
          );
          if (mode === 'shortcut') {
            expect(tool).toBeUndefined();
            return { status: 'failure', kind: 'validation_failed' };
          }
          expect(tool).toBeDefined();
          const input =
            mode === 'workout'
              ? { ...scope, category: 'workout_heart_rate' }
              : mode === 'too-wide'
                ? { ...scope, toExclusive: '2026-12-01T00:00:00Z' }
                : scope;
          const request = {
            operationRunId:
              mode === 'wrong-owner' ? 'foreign-turn' : operationRunId,
            operationKey: 'typed-read',
            input,
            signal: controller.signal,
            allowedScope: { sourceKinds: ['personal_record'] as const },
            resultLimit: 6,
            maxPayloadBytes: 20480,
          };
          whilePending = async () => {
            const duplicate = await tool!.search({
              ...request,
              operationKey: 'concurrent',
            });
            expect(duplicate).toMatchObject({ items: [] });
          };
          const batch = await tool!.search(request);
          if (mode === 'declined') {
            expect(batch).toEqual({ status: 'consent_required' });
            return { status: 'failure', kind: 'validation_failed' };
          }
          expect('status' in batch).toBe(false);
          if ('status' in batch)
            throw new Error('Synthetic result is not a batch.');
          if (mode !== 'approved') {
            expect(batch.items).toEqual([]);
            return { status: 'failure', kind: 'validation_failed' };
          }
          expect(batch.items).toHaveLength(1);
          expect(
            JSON.parse(batch.items[0]!.content.split(': ').slice(1).join(': ')),
          ).toMatchObject({
            ...scope,
            unit: 'BPM',
            meanBpm: fixtureBpm,
            sampleCount: 1,
          });
          expect(JSON.stringify(batch)).not.toContain('private-source');
          const alreadyRead = read.mock.calls.length;
          const duplicate = await tool!.search({
            ...request,
            operationKey: 'sequential',
          });
          expect(duplicate).toMatchObject({ items: [] });
          expect(read).toHaveBeenCalledTimes(alreadyRead);
          acceptedSnapshot = registry.snapshot();
          options.onValidatedEvidence?.(batch.items);
          returned = true;
          return {
            status: 'answer',
            answer: 'Synthetic answer',
            citations: batch.items,
          };
        },
      });
      const save: RagConversationObserver['onRetentionCandidate'] =
        async candidate => {
          await f.storage.append({
            ...candidate,
            id: 'typed-answer',
            sessionId: 'session',
            createdAt: '2026-11-02T00:00:00.000Z',
            status: 'complete',
          });
        };
      await send(
        mode === 'workout'
          ? '운동 중 심박수를 알려주세요'
          : '휴식기 심박수의 이틀 평균을 알려주세요',
        [],
        controller.signal,
        {
          retentionSession: {
            id: 'session',
            version: (await f.storage.activeSessionVersion('session'))!,
          },
          retentionRequestId: 'typed-request',
          inputOrigin: mode === 'shortcut' ? 'shortcut' : 'composer',
          confirmTypedHeartRate: confirm,
          onRetentionCandidate: save,
        },
      );
      expect(externalSearch).not.toHaveBeenCalled();
      const preflightRejected =
        /^(workout|shortcut|wrong-owner|bridge-unavailable|too-wide)$/.test(
          mode,
        );
      expect(confirm).toHaveBeenCalledTimes(preflightRejected ? 0 : 1);
      if (mode === 'bridge-unavailable')
        expect(mockProtection).not.toHaveBeenCalled();
      if (mode === 'approved') {
        expect(returned).toBe(true);
        expect(confirm.mock.calls[0]?.[0]).toMatchObject(scope);
        expect(confirm.mock.calls[0]?.[1]).toMatchObject({
          recipient: selected.recipient,
          modelId: selected.modelId,
          remoteProcessing: true,
        });
        await assertTypedHeartRateRetention(
          f,
          data,
          acceptedSnapshot!,
          controller.signal,
        );
      } else {
        if (mode !== 'changed-after-read')
          expect(
            read.mock.calls.filter(call => call[0].typedHeartRateCategory),
          ).toHaveLength(0);
        else expect(changed).toBe(true);
        expect(returned).toBe(false);
      }
    } finally {
      f.close();
    }
  },
);
