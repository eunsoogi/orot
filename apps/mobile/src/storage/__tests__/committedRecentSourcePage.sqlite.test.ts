import {
  createRecordRepository,
  listRecentSourcePage,
  runMigrations,
} from '@orot/storage';
import { readCommittedRecentSourcePage } from '../committedRecentSourcePage';
import { openInterleavableRecentSourceDatabase } from '../testSupport/interleavableRecentSourceDatabase';

const fixture = {
  id: 'synthetic-import',
  sourceKind: 'medical_document' as const,
  ingestedAt: '2026-11-22T09:31:00.000Z',
  title: 'Synthetic imported file',
  provenance: { origin: 'imported' as const, sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' as const },
};

test.each(['rollback', 'commit'] as const)(
  'a direct same-handle SELECT can see a held write; the Recent Records reader waits for %s',
  async action => {
    const f = openInterleavableRecentSourceDatabase();
    let entered!: () => void;
    let release!: () => void;
    const inserted = new Promise<void>(done => {
      entered = done;
    });
    const hold = new Promise<void>(done => {
      release = done;
    });
    try {
      await runMigrations(f.database);
      const records = createRecordRepository(f.database);
      const aborted = new Error('Synthetic import rollback.');
      const writer = records
        .transaction(async tx => {
          await tx.put('source_record', fixture);
          entered();
          await hold;
          if (action === 'rollback') throw aborted;
        })
        .catch(error => {
          expect(error).toBe(aborted);
        });
      await inserted;
      // Positive control: the old direct path sees the same uncommitted writer row.
      expect(
        (await listRecentSourcePage(f.database)).map(row => row.id),
      ).toEqual([fixture.id]);
      const published = jest.fn();
      const committed = readCommittedRecentSourcePage(f.database).then(
        published,
      );
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(published).not.toHaveBeenCalled();
      release();
      await writer;
      await committed;
      expect(published).toHaveBeenCalledTimes(1);
      expect(published).toHaveBeenCalledWith(
        action === 'commit'
          ? [
              {
                id: fixture.id,
                kind: fixture.sourceKind,
                createdAt: fixture.ingestedAt,
                title: fixture.title,
              },
            ]
          : [],
      );
    } finally {
      release();
      f.close();
    }
  },
);

test('a deferred direct startup PRAGMA must not settle the first media page as failed', async () => {
  let entered!: () => void;
  let release!: () => void;
  const dispatched = new Promise<void>(done => {
    entered = done;
  });
  const held = new Promise<void>(done => {
    release = done;
  });
  const f = openInterleavableRecentSourceDatabase(query => {
    if (query !== 'PRAGMA temp_store = MEMORY') return;
    entered();
    return held;
  });
  let drainStartup: Promise<unknown> | undefined;
  let drainPage: Promise<unknown> | undefined;
  try {
    await runMigrations(f.database);
    await createRecordRepository(f.database).put('source_record', fixture);
    const startup = f.database.execute('PRAGMA temp_store = MEMORY');
    drainStartup = startup;
    await dispatched;
    const settled = jest.fn();
    const page = readCommittedRecentSourcePage(f.database).then(
      settled,
      settled,
    );
    drainPage = page;
    // Let the first queued read execute and its native callback settle.
    await new Promise<void>(resolve => setImmediate(resolve));
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(settled).not.toHaveBeenCalled();
    release();
    await startup;
    await page;
    expect(settled).toHaveBeenCalledWith([
      {
        id: fixture.id,
        kind: fixture.sourceKind,
        createdAt: fixture.ingestedAt,
        title: fixture.title,
      },
    ]);
  } finally {
    release();
    await Promise.allSettled([drainStartup, drainPage]);
    f.close();
  }
});

test('changing owners cancels the queued first-page deferral without issuing the second query', async () => {
  let release!: () => void;
  const held = new Promise<void>(done => {
    release = done;
  });
  const f = openInterleavableRecentSourceDatabase(query =>
    query === 'PRAGMA temp_store = MEMORY' ? held : undefined,
  );
  const owner = new AbortController();
  let startup: Promise<unknown> | undefined;
  try {
    await runMigrations(f.database);
    await createRecordRepository(f.database).put('source_record', fixture);
    startup = f.database.execute('PRAGMA temp_store = MEMORY');
    const check = jest.fn(async () => true);
    const page = readCommittedRecentSourcePage(
      f.database,
      undefined,
      owner.signal,
      check,
    );
    await new Promise<void>(resolve => setImmediate(resolve));
    await new Promise<void>(resolve => setImmediate(resolve));
    owner.abort();
    // Resolve before the old startup call, not at the full timeout.
    await expect(page).resolves.toEqual([]);
    expect(check).not.toHaveBeenCalled();
  } finally {
    owner.abort();
    release();
    await startup?.catch(() => undefined);
    f.close();
  }
});

test.each(['current', 'revoked', 'deadline'] as const)(
  'two separate settled startup crossings recheck the same first-page owner: %s',
  async owner => {
    function deferred() {
      let resolve!: () => void;
      const promise = new Promise<void>(done => {
        resolve = done;
      });
      return { promise, resolve };
    }
    const crossings = [
      { started: deferred(), settle: deferred() },
      { started: deferred(), settle: deferred() },
    ];
    let next = 0;
    const f = openInterleavableRecentSourceDatabase(query => {
      if (query !== 'PRAGMA temp_store = MEMORY') return;
      const crossing = crossings[next++]!;
      crossing.started.resolve();
      return crossing.settle.promise;
    });
    const result = jest.fn();
    const flushQueue = async () => {
      await new Promise<void>(resolve => setImmediate(resolve));
      await new Promise<void>(resolve => setImmediate(resolve));
    };
    let first: Promise<unknown> | undefined;
    let another: Promise<unknown> | undefined;
    let page: Promise<unknown> | undefined;
    let elapsed = 0;
    const clock = jest
      .spyOn(performance, 'now')
      .mockImplementation(() => elapsed);
    const check = jest.fn(async () => true);
    check
      .mockImplementationOnce(async () => {
        // A different startup owner can submit while the route revalidates
        // its first fresh attempt; this second mutation is real SQLite.
        another = f.database.execute('PRAGMA temp_store = MEMORY');
        await crossings[1]!.started.promise;
        return true;
      })
      .mockImplementationOnce(async () => {
        // A slow owner read does not extend the original startup window.
        if (owner === 'deadline') elapsed = 1_001;
        return owner !== 'revoked';
      });
    try {
      await runMigrations(f.database);
      await createRecordRepository(f.database).put('source_record', fixture);
      first = f.database.execute('PRAGMA temp_store = MEMORY');
      await crossings[0]!.started.promise;
      page = readCommittedRecentSourcePage(
        f.database,
        undefined,
        undefined,
        check,
      ).then(result, result);
      await flushQueue();
      expect(result).not.toHaveBeenCalled();
      crossings[0]!.settle.resolve();
      await first;
      await crossings[1]!.started.promise;
      await flushQueue();
      crossings[1]!.settle.resolve();
      await another;
      await page;
      expect(result).toHaveBeenCalledTimes(1);
      if (owner === 'current')
        expect(result).toHaveBeenCalledWith([
          expect.objectContaining({ id: fixture.id }),
        ]);
      else expect(result).toHaveBeenCalledWith(expect.any(Error));
      expect(check).toHaveBeenCalledTimes(2);
    } finally {
      clock.mockRestore();
      for (const crossing of crossings) crossing.settle.resolve();
      await Promise.allSettled([first, another, page]);
      f.close();
    }
  },
);
