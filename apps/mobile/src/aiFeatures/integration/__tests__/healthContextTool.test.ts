import { createHealthContextTool } from '../healthContextTool';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { healthContextDays } from '../../../healthEvidence/healthContext/window';
import type { HealthContextReader } from '../../../healthEvidence/healthContext/reader';
import type { EvidenceSearchRequest } from '@orot/agent-runtime';
import { revalidateWithLocalDeletionGuard } from '../deletionAwareEvidence';

const request: EvidenceSearchRequest = {
  input: {},
  operationRunId: 'synthetic',
  operationKey: 'chosen-call',
  allowedScope: { sourceKinds: ['personal_record'] },
  resultLimit: 8,
  maxPayloadBytes: 20_480,
  signal: new AbortController().signal,
};
function fixture() {
  const read = jest.fn<
    ReturnType<HealthContextReader>,
    Parameters<HealthContextReader>
  >(async (window, _topics) => ({
    window,
    days: healthContextDays(window),
    quantities: [],
    medications: [],
    sleep: [],
    symptoms: { entryCount: 0, recordedDays: 0, latest: [] },
    limitations: [],
    mutationGeneration: 1,
    deletionGeneration: 0,
  }));
  const registry = new LocalEvidenceReferenceRegistry();
  return { read, registry, tool: createHealthContextTool(read, registry) };
}

test('does not read before model selection, defaults to 30 days and reads only chosen topics', async () => {
  const f = fixture();
  expect(f.read).not.toHaveBeenCalled();
  const result = await f.tool.search({
    ...request,
    input: { topics: ['medications', 'measurements'] },
  });
  if ('status' in result) throw new Error('Expected period evidence');
  expect(result.items).toHaveLength(2);
  expect(f.read).toHaveBeenCalledTimes(2);
  expect(healthContextDays(f.read.mock.calls[0]![0])).toHaveLength(30);
  expect(f.read.mock.calls.map(call => call[1])).toEqual([
    ['medications'],
    ['measurements'],
  ]);
  expect(JSON.stringify(result)).not.toContain('health_context_period');
  expect(
    await revalidateWithLocalDeletionGuard(
      result.items,
      request.signal,
      (refs, signal) => f.registry.revalidateEvidence(refs, signal),
      ref => f.registry.resolve(ref),
    ),
  ).toBe(true);
});

test('does not widen a source/time restriction and rejects unbounded or malformed tool arguments', async () => {
  const f = fixture();
  for (const input of [
    { days: 365 },
    { days: '30' },
    { topics: ['anything'] },
    { topics: [] },
    { extra: true },
  ])
    expect(f.tool.parseInput(input)).toBeUndefined();
  const result = await f.tool.search({
    ...request,
    allowedScope: { sourceKinds: ['personal_record'], sourceIds: ['s1'] },
  });
  if ('status' in result) throw new Error('Expected coverage');
  expect(result.items).toHaveLength(0);
  expect(result.coverage[0]?.truncated).toBe(true);
  expect(f.read).not.toHaveBeenCalled();
  const invalid = {
    sourceKind: 'personal_record' as const,
    sourceId: 'fake',
    evidenceId: 'fake',
    sourceRevision: '1',
    evidenceRevision: '1',
    reviewState: 'unknown' as const,
    effectiveTime: null,
    locator: { kind: 'health_context_period', version: 1, topic: 'anything' },
  };
  const validate = jest.fn(async () => true);
  expect(
    await revalidateWithLocalDeletionGuard(
      [invalid],
      request.signal,
      validate,
      ref => ref,
    ),
  ).toBe(false);
  expect(validate).not.toHaveBeenCalled();
});
