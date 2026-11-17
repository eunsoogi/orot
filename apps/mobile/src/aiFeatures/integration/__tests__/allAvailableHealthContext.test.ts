import { createHealthContextTool } from '../healthContextTool';
import { bindSummaryWindow } from '../summaryWindowTool';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import type { HealthContextReader } from '../../../healthEvidence/healthContext/reader';
import { healthContextDays } from '../../../healthEvidence/healthContext/window';

const window = {
  fromInclusive: '2025-01-01T00:00:00Z',
  toExclusive: '2026-11-17T00:00:00Z',
  timeZone: 'UTC',
  dataAvailableThrough: '2026-11-17T00:00:00Z',
};
function fixture() {
  const read = jest.fn<
    ReturnType<HealthContextReader>,
    Parameters<HealthContextReader>
  >(async period => ({
    window: period,
    days: healthContextDays(period),
    quantities: [],
    medications: [],
    sleep: [],
    symptoms: { entryCount: 0, recordedDays: 0, latest: [] },
    limitations: [],
    mutationGeneration: 1,
    deletionGeneration: 0,
  }));
  const resolve = jest.fn(async () => window);
  const registry = new LocalEvidenceReferenceRegistry();
  const request = {
    operationRunId: 'run',
    operationKey: 'read',
    input: { topics: ['symptoms'] },
    allowedScope: { sourceKinds: ['personal_record' as const] },
    resultLimit: 8,
    maxPayloadBytes: 65536,
    executionLimits: 'unbounded' as const,
    signal: new AbortController().signal,
  };
  return { read, resolve, registry, request };
}

test.each(['rag', 'disease', 'visit'] as const)(
  'defaults %s to available history and preserves explicit clinical periods',
  async feature => {
    const f = fixture();
    const tool = createHealthContextTool(
      f.read,
      f.registry,
      feature,
      false,
      f.resolve,
    );
    expect(tool.parseInput({})).not.toHaveProperty('days');
    await tool.search(f.request);
    expect(f.read.mock.calls[0]?.[0]).toEqual(window);
    expect(f.read.mock.results).toHaveLength(1);
    const explicit = { ...window, fromInclusive: '2026-10-01T00:00:00Z' };
    await tool.search({
      ...f.request,
      input: { window: explicit, topics: ['symptoms'] },
    });
    expect(f.read.mock.calls[1]?.[0]).toEqual(explicit);
    expect(f.resolve).toHaveBeenCalledTimes(1);
    expect(tool.parseInput({ days: 365 })).toMatchObject({ days: 365 });
  },
);

test('empty availability and missing capability never invent a recent period; restricted scopes never resolve', async () => {
  const f = fixture();
  const empty = jest.fn(async () => null);
  const tool = createHealthContextTool(f.read, f.registry, 'rag', false, empty);
  expect(await tool.search(f.request)).toMatchObject({ items: [] });
  expect(f.read).not.toHaveBeenCalled();
  await expect(
    createHealthContextTool(f.read, f.registry, 'rag').search(f.request),
  ).rejects.toThrow('explicit');
  empty.mockClear();
  await tool.search({
    ...f.request,
    allowedScope: { sourceKinds: ['personal_record'], sourceIds: ['only'] },
  });
  expect(empty).not.toHaveBeenCalled();
});

test('summary resolves one fixed all-topic period and rejects a changed period', async () => {
  const f = fixture();
  const bound = bindSummaryWindow(
    createHealthContextTool(f.read, f.registry, 'rag', false, f.resolve),
    { endAt: window.toExclusive, timeZone: 'UTC', resolveWindow: f.resolve },
  );
  expect(bound.tool.parseInput(f.request.input)).not.toHaveProperty('window');
  await bound.tool.search(f.request);
  await bound.tool.search({
    ...f.request,
    input: { topics: ['measurements'] },
  });
  expect(f.resolve).toHaveBeenCalledTimes(1);
  expect(bound.admittedWindow()).toEqual(window);
  expect(f.read.mock.calls.map(call => call[0])).toEqual([window, window]);
  await expect(
    bound.tool.search({ ...f.request, input: { days: 7 } }),
  ).rejects.toThrow('changed');
});
