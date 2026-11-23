import { runMigrations } from '@orot/storage';
import { readSelectedStaleArtifacts } from '../currentEvidenceChunks';
import type { EvidenceRecordIdentity } from '../currentEvidenceChunks';
import { createHealthEvidenceTestDatabase } from '../localEvidenceTestSupport';

const observation = (id: string): EvidenceRecordIdentity => ({
  kind: 'health_observation',
  id,
});

const unicode = observation("한א😀' id");
const mixed: EvidenceRecordIdentity = {
  kind: 'medication_assertion',
  id: unicode.id,
};
const second = observation('second');

async function withDatabase(
  testBody: (
    db: ReturnType<typeof createHealthEvidenceTestDatabase>['database'],
  ) => Promise<void>,
) {
  const { database, close } = createHealthEvidenceTestDatabase();
  try {
    await runMigrations(database);
    for (const [identity, revision] of [
      [unicode, 'v1'],
      [unicode, 'v2'],
      [second, 'v1'],
    ] as const) {
      await database.execute(
        "INSERT INTO transcript_artifact_staleness VALUES ('transcript', ?, ?, 'superseded', ?, '2026-11-23')",
        [identity.kind, identity.id, revision],
      );
    }
    await testBody(database);
  } finally {
    close();
  }
}

test('bounds selected typed lookup while returning the exact ordered matching inputs', () =>
  withDatabase(async database => {
    const execute = jest.spyOn(database, 'execute');
    const input = [
      second,
      mixed,
      unicode,
      ...Array.from({ length: 20 }, (_, index) =>
        observation('absent-' + index),
      ),
      unicode,
    ];
    const expected = [second, unicode, unicode];
    expect(await readSelectedStaleArtifacts(database, [])).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
    expect(await readSelectedStaleArtifacts(database, [unicode])).toEqual([
      unicode,
    ]);
    expect(execute).toHaveBeenCalledTimes(1);
    execute.mockClear();
    expect(await readSelectedStaleArtifacts(database, input)).toEqual(expected);
    expect(execute).toHaveBeenCalledTimes(2);
    // Do not cache stale membership: a later exact owned database read sees edits.
    await database.execute(
      'DELETE FROM transcript_artifact_staleness WHERE artifact_kind = ? AND artifact_id = ?',
      [unicode.kind, unicode.id],
    );
    expect(await readSelectedStaleArtifacts(database, input)).toEqual([second]);
  }));

test('discards a read on cancellation before another page can start', () =>
  withDatabase(async database => {
    const abort = new AbortController();
    const execute = database.execute.bind(database);
    let finishRead!: () => void;
    const held = new Promise<void>(resolve => {
      finishRead = resolve;
    });
    const read = jest
      .spyOn(database, 'execute')
      .mockImplementation(async (...args) => {
        await held;
        return execute(...args);
      });
    const input = [unicode, ...Array.from({ length: 20 }, () => second)];
    const requested = readSelectedStaleArtifacts(database, input, abort.signal);
    abort.abort();
    finishRead();
    await expect(requested).rejects.toMatchObject({ name: 'AbortError' });
    expect(read).toHaveBeenCalledTimes(1);
    await expect(
      readSelectedStaleArtifacts(database, input, abort.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(read).toHaveBeenCalledTimes(1);
  }));

test('a protected lookup failure rejects rather than returning partial results', () =>
  withDatabase(async database => {
    const read = jest
      .spyOn(database, 'execute')
      .mockRejectedValue(new Error('Unavailable fixture database.'));
    await expect(
      readSelectedStaleArtifacts(database, [unicode, second]),
    ).rejects.toThrow('Unavailable fixture database.');
    expect(read).toHaveBeenCalledTimes(1);
  }));

test.each([-1, 2, 0.2, '0', null])(
  'rejects an invalid returned position (%p)',
  position =>
    withDatabase(async database => {
      jest
        .spyOn(database, 'execute')
        .mockResolvedValue({ rows: [{ position }] });
      await expect(
        readSelectedStaleArtifacts(database, [unicode, second]),
      ).rejects.toThrow('Invalid selected evidence staleness result.');
    }),
);
