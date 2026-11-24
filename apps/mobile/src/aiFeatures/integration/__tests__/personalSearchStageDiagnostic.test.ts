import { NativeModules } from 'react-native';
import type { AiFeatureLocalData } from '../localData';
import { personalSearchTiming } from '../personalSearchStageDiagnostic';
import { toolsFor } from '../featureServiceExecution';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import {
  localData,
  memoryRecord,
  completeInventory,
  candidatesForInventory,
} from '../featureServiceFixtures';

const at = '2026-11-01T00:00:00Z';
function fixture(feature: 'rag' | 'disease' = 'rag') {
  const source = localData(
    Array.from({ length: 100 }, (_, index) => memoryRecord(index)),
  );
  const record = {
    kind: 'symptom_entry' as const,
    record: {
      id: 'synthetic-personal-note',
      status: 'active' as const,
      description:
        'Synthetic note includes memory-private-0 and source-private-0.',
      effectiveAt: at,
      recordedAt: at,
      ingestedAt: at,
      provenance: { origin: 'user_reported' as const, sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' as const },
    },
  };
  source.data.readCandidates = jest.fn(async () =>
    candidatesForInventory({
      ...completeInventory,
      records: [record],
      recordCount: 1,
    }),
  );
  source.data.loadCurrentChunks = jest.fn(async () => [
    {
      id: 'synthetic-chunk',
      text: record.record.description,
      metadata: {
        recordType: 'symptom_entry' as const,
        sourceId: record.record.id,
        evidenceId: record.record.id,
        effectiveTime: at,
        sourceRecordIds: [],
        reviewState: { status: 'unreviewed' as const },
        evidenceLocator: {
          kind: 'structured_record' as const,
          recordId: record.record.id,
        },
      },
    },
  ]);
  const registry = new LocalEvidenceReferenceRegistry();
  const tools = toolsFor(undefined, source.data, registry, 8, true, feature);
  return { ...source, tools, registry };
}
const request = {
  operationRunId: 'synthetic-index-measurement',
  operationKey: 'local-tool',
  input: { query: 'synthetic note' },
  allowedScope: { sourceKinds: ['personal_record' as const] },
  resultLimit: 8,
  maxPayloadBytes: 65536,
  signal: new AbortController().signal,
};

const original = NativeModules.OrotProviderDiagnostics;
afterEach(() => {
  NativeModules.OrotProviderDiagnostics = original;
});
const probe = (feature: 'rag' | 'disease' = 'rag') => {
  const source = fixture(feature);
  const tool = source.tools.find(
    candidate => candidate.id === 'local-personal-records',
  )!;
  return { source, tool };
};

test('opt-in ordinary search traces only its three actual waits without changing data or call counts', async () => {
  const report = jest.fn();
  NativeModules.OrotProviderDiagnostics = { enabled: false, report };
  const normal = probe();
  const expected = await normal.tool.search(request);
  expect(report).not.toHaveBeenCalled();
  NativeModules.OrotProviderDiagnostics.enabled = true;
  const instrumented = probe();
  expect(await instrumented.tool.search(request)).toEqual(expected);
  const stages = [
    'personal_search_snapshot',
    'personal_search_index',
    'personal_search_rank_adapter',
  ];
  expect(report.mock.calls).toEqual(
    stages.map(stage => ['rag', stage, expect.stringMatching(/^\d+$/)]),
  );
  expect(instrumented.source.eventOrder).toEqual(normal.source.eventOrder);
  expect(instrumented.source.data.readCandidates).toHaveBeenCalledTimes(1);
  expect(instrumented.source.data.findIdentifiers).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(report.mock.calls)).not.toContain('synthetic');
  report.mockClear();
  expect(await probe('disease').tool.search(request)).toEqual(expected);
  expect(report).not.toHaveBeenCalled();
});

test('a cancelled index does not create a rank span or alter the original cancellation', async () => {
  const report = jest.fn();
  NativeModules.OrotProviderDiagnostics = { enabled: true, report };
  const source = probe();
  const controller = new AbortController();
  const data: AiFeatureLocalData = source.source.data;
  jest.spyOn(data.rag, 'index').mockImplementation(async () => {
    controller.abort();
  });
  await expect(
    source.tool.search({ ...request, signal: controller.signal }),
  ).resolves.toMatchObject({ items: [] });
  expect(report.mock.calls).toEqual([
    ['rag', 'personal_search_snapshot', expect.stringMatching(/^\d+$/)],
  ]);
  expect(source.source.searchedChunks).toHaveLength(0);
});

test.each([false, true])(
  'never retries work after a synchronous throw (opt-in: %p)',
  async enabled => {
    NativeModules.OrotProviderDiagnostics = {
      enabled,
      report() {
        throw Error('test logger failure');
      },
    };
    const expected = new Error('fixture-work-error');
    const work = jest.fn(() => {
      throw expected;
    });
    await expect(
      Promise.resolve().then(() =>
        personalSearchTiming(true, request.signal)(
          'personal_search_snapshot',
          work,
        ),
      ),
    ).rejects.toBe(expected);
    expect(work).toHaveBeenCalledTimes(1);
  },
);

test('late cancelled adapter cannot emit a sample among newer valid samples', async () => {
  const report = jest.fn();
  NativeModules.OrotProviderDiagnostics = { enabled: true, report };
  const { source, tool } = probe();
  const data: AiFeatureLocalData = source.data;
  const search = data.rag.search.bind(data.rag);
  let release!: () => void;
  let entered!: () => void;
  const held = new Promise<void>(resolve => {
    release = resolve;
  });
  const waiting = new Promise<void>(resolve => {
    entered = resolve;
  });
  jest.spyOn(data.rag, 'search').mockImplementationOnce(async (...args) => {
    entered();
    await held;
    return search(...args);
  });
  const controller = new AbortController();
  const old = tool.search({ ...request, signal: controller.signal });
  await waiting;
  controller.abort();
  report.mockClear();
  await tool.search({
    ...request,
    operationKey: 'next',
    signal: new AbortController().signal,
  });
  const fresh = [...report.mock.calls];
  expect(fresh.map(call => call[1])).toEqual([
    'personal_search_snapshot',
    'personal_search_index',
    'personal_search_rank_adapter',
  ]);
  release();
  await old;
  expect(report.mock.calls).toEqual(fresh);
});

test('ordinary and scoped overview requests take the existing paths without overview samples', async () => {
  const report = jest.fn();
  NativeModules.OrotProviderDiagnostics = { enabled: true, report };
  const { tool } = probe();
  const found = await tool.search(request);
  if ('status' in found || !found.items[0])
    throw Error('fixture missing exact source');
  report.mockClear();
  const input = { ...request.input, view: 'health_overview' };
  await tool.search({ ...request, input });
  await tool.search({
    ...request,
    input,
    allowedScope: {
      ...request.allowedScope,
      sourceIds: [found.items[0].sourceId],
    },
  });
  expect(
    report.mock.calls.filter(call =>
      String(call[1]).startsWith('personal_search_'),
    ),
  ).toEqual([]);
});

test.each([Number.NaN, -0.1, 300_000.1])(
  'suppresses a nonportable elapsed sample (%p)',
  async end => {
    const report = jest.fn();
    NativeModules.OrotProviderDiagnostics = { enabled: true, report };
    const clock = jest
      .spyOn(performance, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(end);
    try {
      await expect(
        personalSearchTiming(true, request.signal)(
          'personal_search_snapshot',
          async () => 1,
        ),
      ).resolves.toBe(1);
      expect(report).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore();
    }
  },
);
