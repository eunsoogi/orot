import { providerSuccess } from '@orot/model-runtime';
import type { LanguageModelProvider } from '@orot/model-runtime';
import type { EvidenceSearchTool } from '@orot/agent-runtime';
import { openLocalStorage } from '../../storage/secureDatabase';
import { runLocalHealthReview } from '../../agent/healthReview/workflow';
import { createHealthReviewService } from '../service';

/** Only inference is scripted. Requests, health tools, checkpoints and deletion use production SQLCipher services. */
export function nativeHealthReviewService(
  fixture: string,
  mode: string,
  resources: Pick<
    NonNullable<Parameters<typeof createHealthReviewService>[0]>,
    'resources' | 'data'
  > = {},
) {
  let calls = 0;
  let ids: string[] = [];
  const provider: LanguageModelProvider = {
    id: 'synthetic-health-review-ui',
    kind: 'language-model',
    displayName: 'Synthetic health review',
    capabilities: {
      inputTypes: ['text'],
      streaming: false,
      structuredOutput: false,
      toolCalling: false,
    },
    async generate(_request, options) {
      ++calls;
      if (mode === 'restore') throw new Error('Restore cannot infer.');
      if (mode === 'waiting') {
        await new Promise<void>((_resolve, reject) => {
          if (options?.signal?.aborted) reject(new Error('Cancelled'));
          else
            options?.signal?.addEventListener(
              'abort',
              () => reject(new Error('Cancelled')),
              { once: true },
            );
        });
      }
      return providerSuccess({
        text: JSON.stringify({
          type: 'result',
          citations: ids,
          value: {
            observedChanges: [
              { text: '저장된 심박 측정 기록을 확인했어요.', evidenceIds: ids },
            ],
            unresolvedItems: ['기록이 없는 날은 알 수 없어요.'],
            questions: ['측정 당시 상황을 확인할까요?'],
          },
        }),
        toolCalls: [],
        finishReason: 'complete',
      });
    },
  };
  const service = createHealthReviewService({
    ...resources,
    resolveSelected: async () => ({
      status: 'ready',
      selection: { providerId: provider.id, modelId: 'synthetic' },
      option: {
        provider,
        modelId: 'synthetic',
        displayName: 'Synthetic',
        privacyBoundary:
          mode === 'remote' ? 'selected-context-remote' : 'on-device',
        availability: { status: 'available' },
      },
      provider,
      modelId: 'synthetic',
      recipient: mode === 'remote' ? 'Synthetic test recipient' : 'on-device',
      remoteProcessing: mode === 'remote',
    }),
    run: async input => {
      ids = [];
      if (!input.evidence) throw new Error('Real health tools required.');
      const capture = (tool: EvidenceSearchTool): EvidenceSearchTool => ({
        ...tool,
        async search(request, runtime) {
          const result = await tool.search(request, runtime);
          if (!('status' in result))
            ids.push(...result.items.map(item => item.evidenceId));
          return result;
        },
      });
      return runLocalHealthReview({
        ...input,
        evidence: {
          ...input.evidence,
          trends: capture(input.evidence.trends),
          records: capture(input.evidence.records),
        },
      });
    },
  });
  const observationId = fixture + ':healthkit-pulse';
  return {
    service,
    async seed() {
      if (!/^test-persistence-[a-f0-9-]{36}$/i.test(fixture))
        throw new Error('Owned fixture required.');
      const repository = await openLocalStorage();
      if (mode === 'restore') return;
      const now = new Date().toISOString();
      await repository.put('health_observation', {
        id: observationId,
        observationKind: 'measurement',
        concept: 'heart_rate',
        value: { kind: 'quantity', amount: 70, unit: 'count/min' },
        effectiveAt: new Date(Date.now() - 1000).toISOString(),
        ingestedAt: now,
        reviewState: { status: 'unreviewed' },
        provenance: {
          origin: 'imported',
          sourceRecordIds: [],
          source: {
            system: 'com.apple.healthkit',
            sourceIdentifier: observationId,
          },
        },
      });
    },
    async readback(sequence: number) {
      const repository = await openLocalStorage();
      const requests = (await service.list()).filter(
        row => row.source.title === fixture,
      );
      return JSON.stringify({
        readback: sequence,
        modelCalls: calls,
        pending: requests.filter(row => row.pending).length,
        requests: requests.length,
        observationPresent: Boolean(
          await repository.get('health_observation', observationId),
        ),
      });
    },
    async removeObservation() {
      await (
        await openLocalStorage()
      ).delete('health_observation', observationId);
    },
    async cleanup() {
      for (const { source } of await service.list())
        if (source.title === fixture) await service.delete(source.id);
      await (
        await openLocalStorage()
      ).delete('health_observation', observationId);
    },
  };
}
