import { refreshHealthContextRead } from '../refreshHealthContextRead';
import { createHealthContextTool } from '../healthContextTool';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { healthContextDays } from '../../../healthEvidence/healthContext/window';
import type { HealthContextReader } from '../../../healthEvidence/healthContext/reader';
import type { HealthContextScope } from '../../../healthEvidence/healthContext/scope';

const scope: HealthContextScope = {
  kind: 'health_context_period',
  version: 1,
  topic: 'symptoms',
  window: {
    fromInclusive: '2026-10-01T00:00:00Z',
    toExclusive: '2026-10-02T00:00:00Z',
    timeZone: 'UTC',
  },
};
function report(count: number, deletionGeneration = 0) {
  return {
    window: scope.window,
    days: healthContextDays(scope.window),
    quantities: [],
    medications: [],
    sleep: [],
    symptoms: { entryCount: count, recordedDays: 0, latest: [] },
    limitations: [],
    mutationGeneration: count,
    deletionGeneration,
  };
}
function setup(values = [report(2), report(2)]) {
  const controller = new AbortController();
  const read = jest.fn<
    ReturnType<HealthContextReader>,
    Parameters<HealthContextReader>
  >();
  for (const value of values) read.mockResolvedValueOnce(value);
  return {
    controller,
    read,
    input: { initial: report(1), scope, read, signal: controller.signal },
  };
}
test('replaces a changed unexposed aggregate once in the identical period and topic', async () => {
  const f = setup();
  expect(await refreshHealthContextRead(f.input)).toEqual(report(2));
  expect(f.read.mock.calls).toEqual([
    [scope.window, [scope.topic], f.controller.signal],
    [scope.window, [scope.topic], f.controller.signal],
  ]);
});
test('does not chase a second change or cross a deletion generation', async () => {
  for (const values of [[report(2), report(3)], [report(2, 1)]]) {
    const f = setup(values);
    expect(await refreshHealthContextRead(f.input)).toBe(f.input.initial);
    expect(f.read).toHaveBeenCalledTimes(values.length);
  }
});
test('stable data needs no replacement and cancellation cannot adopt a late result', async () => {
  const stable = setup([report(1)]);
  expect(await refreshHealthContextRead(stable.input)).toBe(
    stable.input.initial,
  );
  expect(stable.read).toHaveBeenCalledTimes(1);
  const f = setup();
  f.read.mockReset().mockImplementation(async () => {
    f.controller.abort();
    return report(2);
  });
  expect(await refreshHealthContextRead(f.input)).toBe(f.input.initial);
  expect(f.read).toHaveBeenCalledTimes(1);
});
test('a local read error is not converted into authorization or a usable source', async () => {
  const f = setup();
  f.read.mockReset().mockRejectedValue(new Error('synthetic unavailable'));
  await expect(refreshHealthContextRead(f.input)).rejects.toThrow(
    'synthetic unavailable',
  );
  expect(f.read).toHaveBeenCalledTimes(1);
});
test('the RAG tool registers only refreshed content and leaves ordinary freshness checks active', async () => {
  const f = setup([report(1), report(2), report(2)]);
  f.read.mockResolvedValue(report(2));
  const registry = new LocalEvidenceReferenceRegistry();
  const tool = createHealthContextTool(f.read, registry, 'rag', true);
  const result = await tool.search({
    input: { topics: ['symptoms'], window: { ...scope.window } },
    operationRunId: 'synthetic',
    operationKey: 'synthetic',
    allowedScope: { sourceKinds: ['personal_record'] },
    resultLimit: 1,
    maxPayloadBytes: 20_480,
    signal: f.controller.signal,
  });
  if ('status' in result) throw new Error('Expected local batch');
  expect(result.items).toHaveLength(1);
  expect(result.items[0]!.content).toContain('"entryCount":2');
  expect(
    await registry.revalidateEvidence(result.items, f.controller.signal),
  ).toBe(true);
  f.read.mockResolvedValue(report(3));
  expect(
    await registry.revalidateEvidence(result.items, f.controller.signal),
  ).toBe(false);
});

test('confirmation cannot cross deletion or Stop after the replacement read', async () => {
  const deleted = setup([report(2), report(2, 1)]);
  expect(await refreshHealthContextRead(deleted.input)).toBe(
    deleted.input.initial,
  );
  const stopped = setup([report(2)]);
  stopped.read.mockImplementationOnce(async () => {
    stopped.controller.abort();
    return report(2);
  });
  expect(await refreshHealthContextRead(stopped.input)).toBe(
    stopped.input.initial,
  );
  expect(stopped.read).toHaveBeenCalledTimes(2);
});

test('restriction never reads, other feature reads once, and larger replacement remains payload bounded', async () => {
  const f = setup([report(1), report(1)]);
  f.read.mockResolvedValue(report(1));
  const registry = new LocalEvidenceReferenceRegistry();
  const request = {
    input: { topics: ['symptoms'], window: { ...scope.window } },
    operationRunId: 'synthetic',
    operationKey: 'synthetic',
    allowedScope: { sourceKinds: ['personal_record' as const] },
    resultLimit: 1,
    maxPayloadBytes: 20_480,
    signal: f.controller.signal,
  };
  await createHealthContextTool(f.read, registry, 'rag', true).search({
    ...request,
    allowedScope: { ...request.allowedScope, sourceIds: ['restricted'] },
  });
  expect(f.read).not.toHaveBeenCalled();
  await createHealthContextTool(f.read, registry, 'visit').search(request);
  expect(f.read).toHaveBeenCalledTimes(1);
  const larger = { ...report(2), limitations: ['synthetic'.repeat(10_000)] };
  f.read.mockReset().mockResolvedValueOnce(report(1)).mockResolvedValue(larger);
  const result = await createHealthContextTool(
    f.read,
    registry,
    'rag',
    true,
  ).search(request);
  if ('status' in result) throw new Error('Expected bounded batch');
  expect(result.items).toEqual([]);
  expect(result.coverage[0]?.gaps).toContain(
    'period_detail_exceeds_payload_limit_choose_fewer_topics_or_summary',
  );
  expect(f.read).toHaveBeenCalledTimes(3);
});
