import { createHealthContextTool } from '../healthContextTool';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import type { HealthContextReader } from '../../../healthEvidence/healthContext/reader';
import { healthContextDays } from '../../../healthEvidence/healthContext/window';
import { HEALTH_CONTEXT_TOPICS } from '../../../healthEvidence/healthContext/types';
import { ragConversationTask } from '../../../ragConversation/task';

const window = {
  fromInclusive: '2026-03-01T00:00:00Z',
  toExclusive: '2026-03-08T00:00:00Z',
  timeZone: 'UTC',
};

test('accepts an explicit historical window for non-medication health topics', () => {
  const read = jest.fn() as unknown as HealthContextReader;
  const tool = createHealthContextTool(
    read,
    new LocalEvidenceReferenceRegistry(),
    'rag',
  );
  expect(tool.parseInput({ window, topics: ['sleep'] })).toEqual({
    window,
    topics: ['sleep'],
    detail: 'summary',
  });
});

test('forwards the exact period to every selected topic and retains relative defaults', async () => {
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
  const tool = createHealthContextTool(
    read,
    new LocalEvidenceReferenceRegistry(),
    'rag',
  );
  const request = {
    input: { window },
    operationRunId: 'test',
    operationKey: 'test',
    allowedScope: { sourceKinds: ['personal_record' as const] },
    resultLimit: 8,
    maxPayloadBytes: 20480,
    signal: new AbortController().signal,
  };
  await tool.search(request);
  expect(
    read.mock.calls.map(([period, topics]) => [period, topics[0]]),
  ).toEqual(HEALTH_CONTEXT_TOPICS.map(topic => [window, topic]));
  for (const days of [7, 30, 90] as const) {
    read.mockClear();
    await tool.search({
      ...request,
      input: { days, topics: ['sleep'] } as never,
    });
    expect(healthContextDays(read.mock.calls[0]![0])).toHaveLength(days);
  }
  expect(tool.parseInput({})).toMatchObject({ days: 30 });
});

test('validates periods, dose history and the published schema without widening other features', () => {
  const read = jest.fn() as unknown as HealthContextReader;
  const registry = new LocalEvidenceReferenceRegistry();
  const tool = createHealthContextTool(read, registry, 'rag');
  const dose = { ...window, doseHistory: { page: 0, pageSize: 20 } };
  expect(tool.parseInput({ window: dose })).toMatchObject({
    topics: ['medications'],
    window: dose,
  });
  for (const input of [
    { window, days: 7 },
    { window: { ...window, timeZone: 'Not/AZone' } },
    { window: { ...window, toExclusive: window.fromInclusive } },
    { window: { ...window, toExclusive: '2027-03-01T00:00:00Z' } },
    { window: dose, topics: ['sleep'] },
    { window: { ...window, doseHistory: { page: 0, pageSize: 0 } } },
  ])
    expect(tool.parseInput(input)).toBeUndefined();
  expect(
    createHealthContextTool(read, registry, 'disease').parseInput({ window }),
  ).toBeUndefined();
  expect(
    createHealthContextTool(read, registry, 'visit').parseInput({ window }),
  ).toBeUndefined();
  const schema = tool.inputSchema as {
    properties: { window: { required: string[] } };
  };
  expect(schema.properties.window.required).toEqual([
    'fromInclusive',
    'toExclusive',
    'timeZone',
  ]);
  expect(ragConversationTask.systemPrompt).toContain(
    'an explicit window for a requested period',
  );
  expect(ragConversationTask.systemPrompt).toContain('select only medications');
});
