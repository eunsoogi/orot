import {
  healthContextFixture,
  window,
  signal,
} from '../testSupport/healthContextPersistenceFixture';
import {
  capturedPeriodReader,
  createCapturePeriodReads,
} from '../conversationPeriodReadLease';

/** Real SQLite DELETE interleaves in a native-style connection; never interrupt SQL. */
test.each(['abort', 'generation'] as const)(
  'interleaved delete plus %s cannot publish or roll back deletion',
  async mode => {
    const f = await healthContextFixture();
    const controller = new AbortController();
    const scope = createCapturePeriodReads(controller.signal);
    const transaction = f.database.transaction.bind(f.database);
    await f.repository.put('health_observation', {
      ...f.inside,
      id: 'outside',
      effectiveAt: '2028-01-01T00:00:00Z',
    });
    let changed = false;
    f.database.transaction = work =>
      transaction(async tx => {
        const execute = tx.execute.bind(tx);
        tx.execute = async (...args) => {
          const value = await execute(...args);
          if (!changed && /WITH days\(/.test(args[0])) {
            changed = true;
            await execute('DELETE FROM health_observations WHERE id = ?', [
              f.inside.id,
            ]);
            if (mode === 'abort') controller.abort();
          }
          return value;
        };
        await work(tx);
      });
    try {
      const read = scope.forReader(
        f.read,
        f.registry,
        capturedPeriodReader(f.read),
      );
      await expect(read(window, ['measurements'], signal)).rejects.toThrow();
      expect(
        (
          await f.database.execute(
            'SELECT id FROM health_observations WHERE id = ?',
            [f.inside.id],
          )
        ).rows,
      ).toHaveLength(0);
      expect(
        (await f.read(window, ['measurements'], signal)).deletionGeneration,
      ).not.toBe(f.report.deletionGeneration);
    } finally {
      scope.dispose();
      f.database.transaction = transaction;
      f.close();
    }
  },
);

test('dispose during a query cannot seed the next capture or lend a late cached result', async () => {
  const f = await healthContextFixture();
  const first = createCapturePeriodReads(signal),
    second = createCapturePeriodReads(signal);
  const transaction = f.database.transaction.bind(f.database);
  await f.repository.put('health_observation', {
    ...f.inside,
    id: 'outside',
    effectiveAt: '2028-01-01T00:00:00Z',
  });
  let count = 0;
  f.database.transaction = work =>
    transaction(async tx => {
      const execute = tx.execute.bind(tx);
      tx.execute = async (...args) => {
        const value = await execute(...args);
        if (/WITH days\(/.test(args[0]) && ++count === 1) first.dispose();
        return value;
      };
      await work(tx);
    });
  try {
    const one = first.forReader(
      f.read,
      f.registry,
      capturedPeriodReader(f.read),
    );
    await one(window, ['measurements'], signal);
    expect(count).toBe(2);
    await second.forReader(f.read, f.registry, capturedPeriodReader(f.read))(
      window,
      ['measurements'],
      signal,
    );
    expect(count).toBe(4);
    await one(window, ['measurements'], signal);
    expect(count).toBe(6);
  } finally {
    first.dispose();
    second.dispose();
    f.database.transaction = transaction;
    f.close();
  }
});

test('same capture cannot share calculation authority between independent databases', async () => {
  const a = await healthContextFixture(),
    b = await healthContextFixture();
  const scope = createCapturePeriodReads(signal);
  try {
    await b.repository.delete('health_observation', b.inside.id);
    const ar = scope.forReader(
      a.read,
      a.registry,
      capturedPeriodReader(a.read),
    );
    // Even using the same registry identity cannot collapse distinct factory owners.
    const br = scope.forReader(
      b.read,
      a.registry,
      capturedPeriodReader(b.read),
    );
    expect(
      (await ar(window, ['measurements'], signal)).deletionGeneration,
    ).toBe(a.report.deletionGeneration);
    expect(
      (await br(window, ['measurements'], signal)).deletionGeneration,
    ).not.toBe(b.report.deletionGeneration);
  } finally {
    scope.dispose();
    a.close();
    b.close();
  }
});
