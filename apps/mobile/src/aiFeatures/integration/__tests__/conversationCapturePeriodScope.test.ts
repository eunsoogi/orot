import { captureConversationSources } from '../captureConversationSources';
import { registerHealthContextEvidence } from '../healthContextEvidence';
import { healthContextFixture } from '../testSupport/healthContextPersistenceFixture';

function deferred() {
  let settle!: () => void;
  const wait = new Promise<void>(resolve => {
    settle = resolve;
  });
  return { wait, settle };
}

test('one owned capture reuses typed period calculations but rejects removed evidence', async () => {
  const fixture = await healthContextFixture();
  const { database, registry, repository, read } = fixture;
  const firstAggregate = deferred();
  const releaseAggregate = deferred();
  try {
    const start = Date.parse('2023-06-01T00:00:00Z');
    const time = (i: number) => new Date(start + i * 60_000).toISOString();
    const rows = Array.from({ length: 360 }, (_, i) => ({
      ...fixture.inside,
      id: `synthetic-history-${i}`,
      effectiveAt: time(i),
      recordedAt: time(i),
      ingestedAt: time(i),
    }));
    await database.execute(
      "INSERT INTO health_observations(id,effective_at,recorded_at,ingested_at,payload_json) SELECT json_extract(value,'$.id'),json_extract(value,'$.effectiveAt'),json_extract(value,'$.recordedAt'),json_extract(value,'$.ingestedAt'),value FROM json_each(?)",
      [JSON.stringify(rows)],
    );
    const periods = [];
    for (let index = 0; index < 6; index++) {
      const scope = {
        kind: 'health_context_period' as const,
        version: 1 as const,
        topic: 'measurements' as const,
        window: {
          fromInclusive: time(index),
          toExclusive: '2026-10-02T00:00:00Z',
          timeZone: 'UTC',
        },
      };
      periods.push({
        scope,
        report: await read(scope.window, ['measurements']),
      });
    }
    // Cross the shared five-entry cache repeatedly, within one authorized read owner.
    const refs = [...periods, ...periods, ...periods].map(period =>
      registerHealthContextEvidence({ registry, read, ...period }),
    );
    let aggregate = 0;
    const transaction = database.transaction.bind(database);
    database.transaction = async operation =>
      transaction(async tx => {
        const execute = tx.execute.bind(tx);
        return operation({
          ...tx,
          async execute(sql, params) {
            if (/WITH days\(/.test(sql)) {
              aggregate++;
              if (aggregate === 1) {
                firstAggregate.settle();
                await releaseAggregate.wait;
              }
            }
            return execute(sql, params);
          },
        });
      });
    const signal = new AbortController().signal;
    const capture = captureConversationSources(refs, registry, signal);
    await Promise.race([firstAggregate.wait, capture]);
    expect(aggregate).toBe(1);
    releaseAggregate.settle();
    const result = await capture;
    expect(aggregate).toBe(2);
    expect(result.sources).toHaveLength(6);
    expect(result.mapping.size).toBe(18);
    await repository.delete('health_observation', fixture.inside.id);
    await expect(
      captureConversationSources(refs, registry, signal),
    ).rejects.toThrow(/changed|unavailable/i);
  } finally {
    releaseAggregate.settle();
    fixture.close();
  }
});

test('keeps custom reader arguments and deletion behavior on the exact legacy path', async () => {
  const fixture = await healthContextFixture();
  const { registry, repository } = fixture;
  try {
    const readSource = registry.readSource.bind(registry);
    const custom = jest.fn(readSource);
    registry.readSource = custom;
    const signal = new AbortController().signal;
    const result = await captureConversationSources(
      [fixture.item],
      registry,
      signal,
    );
    expect(result.sources).toHaveLength(1);
    expect(custom.mock.calls).toEqual([[fixture.item, signal]]);
    await repository.delete('health_observation', fixture.inside.id);
    await expect(
      captureConversationSources([fixture.item], registry, signal),
    ).rejects.toThrow(/changed|unavailable/i);
    expect(custom.mock.calls).toEqual([
      [fixture.item, signal],
      [fixture.item, signal],
    ]);
  } finally {
    fixture.close();
  }
});
