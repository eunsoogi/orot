import {
  providerSuccess,
  type LanguageModelRequest,
} from '@orot/model-runtime';
import { runMultiAgentWorkflow, type EvidenceBatch } from '@orot/agent-runtime';
import {
  workflowOptions,
  makeProvider,
} from '../../../../../../packages/agent-runtime/__tests__/multiAgent-external-evidence-fixtures';
import { toolsFor } from '../featureServiceExecution';
import { localData } from '../featureServiceFixtures';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { healthContextDays } from '../../../healthEvidence/healthContext/window';
import type { HealthContextReader } from '../../../healthEvidence/healthContext/reader';

/** Real runtime and production local tool, scripted model: consent, not answer quality. */
test.each(['accept', 'deny', 'second_change'] as const)(
  'refreshed aggregate requires a new exact-payload decision: %s',
  async mode => {
    const window = {
      fromInclusive: '2026-10-01T00:00:00Z',
      toExclusive: '2026-10-02T00:00:00Z',
      timeZone: 'UTC',
    };
    const report = (count: number) => ({
      window,
      days: healthContextDays(window),
      quantities: [],
      medications: [],
      sleep: [],
      symptoms: { entryCount: count, recordedDays: 0, latest: [] },
      limitations: [],
      mutationGeneration: count,
      deletionGeneration: 0,
    });
    const read = jest
      .fn<ReturnType<HealthContextReader>, Parameters<HealthContextReader>>()
      .mockResolvedValueOnce(report(1))
      .mockResolvedValueOnce(report(2))
      .mockResolvedValue(report(mode === 'second_change' ? 3 : 2));
    const registry = new LocalEvidenceReferenceRegistry();
    const original = toolsFor(
      undefined,
      { ...localData([]).data, readHealthContext: read },
      registry,
      6,
      true,
      'rag',
    )[0]!;
    let batch: EvidenceBatch | undefined;
    const tool = {
      ...original,
      search: jest.fn(async (...args: Parameters<typeof original.search>) => {
        const result = await original.search(...args);
        if ('items' in result) batch = result;
        return result;
      }),
    };
    const provider = {
      ...makeProvider([]).provider,
      capabilities: {
        ...makeProvider([]).provider.capabilities,
        toolCalling: true,
      },
      generate: jest.fn(async () =>
        providerSuccess(
          batch
            ? {
                text: JSON.stringify({
                  type: 'result',
                  value: { summary: 'Synthetic local result.' },
                  citations: batch.items.map(
                    ({ content: _content, ...reference }) => reference,
                  ),
                }),
                toolCalls: [],
                finishReason: 'complete' as const,
              }
            : {
                text: '',
                toolCalls: [
                  {
                    id: 'synthetic-call',
                    name: tool.id,
                    arguments: { window, topics: ['symptoms'] },
                  },
                ],
                finishReason: 'tool_calls' as const,
              },
        ),
      ),
    };
    const approvals: LanguageModelRequest[] = [];
    const base = workflowOptions(provider, tool);
    const result = await runMultiAgentWorkflow({
      ...base,
      request: 'Synthetic current-record follow-up.',
      execution: {
        ...base.execution,
        allowedScope: { sourceKinds: ['personal_record'] },
      },
      consent: {
        authorize: async request => {
          approvals.push(request.payload);
          return mode === 'deny' && approvals.length === 2
            ? 'renewal_required'
            : 'authorized';
        },
      },
      revalidateEvidence: (references, signal) =>
        registry.revalidateEvidence(references, signal),
    });
    expect(tool.search).toHaveBeenCalledTimes(1);
    if (mode === 'second_change') {
      expect(result.status).toBe('stale_evidence');
      expect(provider.generate).toHaveBeenCalledTimes(1);
      expect(approvals).toHaveLength(1);
    } else {
      expect(approvals).toHaveLength(2);
      expect(JSON.stringify(approvals[0])).not.toContain('entryCount');
      expect(JSON.stringify(approvals[1])).toContain('entryCount');
      expect(JSON.stringify(approvals[1])).toContain('\\"entryCount\\":2');
      expect(result.status).toBe(
        mode === 'deny' ? 'consent_required' : 'result',
      );
      expect(provider.generate).toHaveBeenCalledTimes(mode === 'deny' ? 1 : 2);
    }
  },
);
