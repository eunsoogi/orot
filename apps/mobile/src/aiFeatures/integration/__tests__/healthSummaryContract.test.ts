import { createHealthContextTool } from '../healthContextTool';
import { bindSummaryWindow } from '../summaryWindowTool';
import { parseHealthSummaryReference } from '../../../ragConversation/healthSummary';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { restoreHealthSummary } from '../restoreHealthSummary';
import {
  healthContextFixture,
  window,
} from '../testSupport/healthContextPersistenceFixture';
import { localData } from '../featureServiceFixtures';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { decodeConversationArtifact } from '../../../storage/conversationArtifactCodec';

test('binds model-selected topics to the admitted window and rejects a conflicting period', async () => {
  const f = await healthContextFixture();
  try {
    const tool = bindSummaryWindow(
      createHealthContextTool(f.read, f.registry, 'rag'),
      { window, endAt: window.toExclusive, timeZone: 'UTC' },
    ).tool;
    expect(tool.parseInput({ topics: ['sleep'] })).toMatchObject({
      window,
      topics: ['sleep'],
    });
    expect(tool.parseInput({ days: 7 })).toBeUndefined();
    expect(
      tool.parseInput({ window: { ...window, timeZone: 'Asia/Seoul' } }),
    ).toBeUndefined();
    expect(parseHealthSummaryReference({ summaryId: 'saved', window })).toEqual(
      { summaryId: 'saved', window },
    );
    expect(
      parseHealthSummaryReference({
        summaryId: 'saved',
        window: { ...window, timeZone: 'wrong' },
      }),
    ).toBeUndefined();
  } finally {
    f.close();
  }
});

test('freezes relative days once, rejects later changes and never reads restricted sources', async () => {
  const f = await healthContextFixture();
  try {
    const read = jest.fn(f.read);
    const bound = bindSummaryWindow(
      createHealthContextTool(read, f.registry, 'rag'),
      { endAt: '2026-03-09T04:00:00Z', timeZone: 'America/New_York' },
    );
    const request = {
      input: { days: 7, topics: ['sleep'] },
      operationRunId: 'test',
      operationKey: 'test',
      allowedScope: {
        sourceKinds: ['personal_record' as const],
        sourceIds: ['restricted'],
      },
      resultLimit: 8,
      maxPayloadBytes: 20480,
      signal: new AbortController().signal,
    };
    const denied = await bound.tool.search(request);
    if ('status' in denied) throw new Error('Expected coverage');
    expect(denied.items).toHaveLength(0);
    expect(read).not.toHaveBeenCalled();
    expect(bound.admittedWindow()).toBeUndefined();
    await bound.tool.search({
      ...request,
      allowedScope: { sourceKinds: ['personal_record'] },
    });
    expect(bound.admittedWindow()).toEqual({
      fromInclusive: '2026-03-02T05:00:00.000Z',
      toExclusive: '2026-03-09T04:00:00Z',
      timeZone: 'America/New_York',
    });
    expect(bound.tool.parseInput({ topics: ['activity'] })).toMatchObject({
      window: bound.admittedWindow(),
    });
    await expect(
      bound.tool.search({
        ...request,
        allowedScope: { sourceKinds: ['personal_record'] },
        input: { days: 30, topics: ['sleep'] },
      }),
    ).rejects.toThrow('period changed');
    expect(
      bound.tool.parseInput({ window: { ...window, timeZone: 'bad-zone' } }),
    ).toBeUndefined();
  } finally {
    f.close();
  }
});

test('stores only a typed summary reference in an independent conversation turn', async () => {
  const f = await healthContextFixture();
  try {
    await f.storage.append(f.saved);
    const store = createConversationArtifactStorage(f.database);
    await store.createSession('session', await store.currentGeneration());
    const value = {
      id: 'turn',
      sessionId: 'session',
      createdAt: '2026-10-05T00:00:00.000Z',
      providerId: 'provider',
      modelId: 'model',
      status: 'complete' as const,
      question: '요약',
      answer: '건강 기록 요약',
      sources: [],
      citations: [],
      healthSummary: { summaryId: f.saved.id, window },
    };
    await store.append(value);
    expect(await store.read('turn')).toEqual(value);
    expect(
      decodeConversationArtifact(
        JSON.stringify({
          ...value,
          healthSummary: {
            ...value.healthSummary,
            window: { ...window, timeZone: 'wrong' },
          },
        }),
      ),
    ).toBeNull();
    expect(
      decodeConversationArtifact(
        JSON.stringify({
          ...value,
          healthSummary: { ...value.healthSummary, analysis: f.saved.analysis },
        }),
      ),
    ).toBeNull();
    await f.repository.delete('health_observation', 'inside');
    expect(await f.storage.read(f.saved.id)).toBeNull();
    expect(await store.read('turn')).toEqual(value);
  } finally {
    f.close();
  }
});

test('restores only an existing summary with matching period and fresh source aliases', async () => {
  const f = await healthContextFixture();
  try {
    await f.storage.append(f.saved);
    const registry = new LocalEvidenceReferenceRegistry();
    const data = { ...localData([]).data, readHealthContext: f.read };
    const reference = { summaryId: f.saved.id, window };
    const restored = await restoreHealthSummary({
      reference,
      storage: f.storage,
      registry,
      data,
    });
    expect(restored?.analysis.savedSummary).toMatchObject({
      status: 'saved',
      sourceChanged: false,
    });
    expect(
      restored?.analysis.hypotheses[0]?.supportingEvidence[0],
    ).toBeDefined();
    expect(
      await restoreHealthSummary({
        reference: {
          ...reference,
          window: { ...window, toExclusive: '2026-10-04T00:00:00Z' },
        },
        storage: f.storage,
        registry,
        data,
      }),
    ).toBeNull();
    await f.repository.put('health_observation', {
      ...f.inside,
      value: { kind: 'quantity', amount: 81, unit: 'count/min' },
    });
    const changed = await restoreHealthSummary({
      reference,
      storage: f.storage,
      registry: new LocalEvidenceReferenceRegistry(),
      data,
    });
    expect(changed?.analysis.savedSummary).toMatchObject({
      status: 'saved',
      sourceChanged: true,
    });
    await f.repository.delete('health_observation', 'inside');
    expect(
      await restoreHealthSummary({
        reference,
        storage: f.storage,
        registry,
        data,
      }),
    ).toBeNull();
  } finally {
    f.close();
  }
});
