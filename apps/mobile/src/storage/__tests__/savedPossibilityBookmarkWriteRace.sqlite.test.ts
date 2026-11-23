import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';
import { readHealthContextGeneration } from '../../healthEvidence/healthContext/generation';
import {
  join,
  mkdtempSync,
  rmSync,
  tmpdir,
} from '../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';

function gate() {
  let release!: () => void;
  const wait = new Promise<void>(done => {
    release = done;
  });
  return { wait, release };
}

test.each(['changed facts', 'same facts'] as const)(
  'the actual prepared link rolls back on a new SQLite generation with %s and an active owner',
  async mode => {
    const directory = mkdtempSync(
      join(tmpdir(), 'orot-possibility-write-race-'),
    );
    const path = join(directory, 'records.sqlite');
    try {
      const f = await healthContextFixture(undefined, path);
      const store = createConversationArtifactStorage(f.database);
      const prepared = gate();
      const continueWrite = gate();
      try {
        const original = {
          ...f.saved,
          analysis: {
            hypotheses: f.saved.analysis.hypotheses.map(section => ({
              ...section,
              uncertainty: 'Synthetic uncertainty.',
            })),
          },
        };
        await f.storage.append(original);
        await store.currentGeneration();
        const before = await readHealthContextGeneration(f.database);
        const transaction = f.database.transaction.bind(f.database);
        const intercept = jest
          .spyOn(f.database, 'transaction')
          .mockImplementation(work =>
            transaction(tx =>
              work({
                ...tx,
                async execute(sql, values) {
                  const result = await tx.execute(sql, values);
                  if (
                    sql.includes('INSERT INTO saved_disease_possibility_refs')
                  ) {
                    prepared.release();
                    await continueWrite.wait;
                    // A native direct statement on this connection joins the pending writer.
                    // Use the existing health trigger, not a mocked generation response.
                    const updated = await tx.execute(
                      mode === 'changed facts'
                        ? "UPDATE health_observations SET payload_json = json_set(payload_json, '$.value.amount', 90) WHERE id = ?"
                        : 'UPDATE health_observations SET payload_json = payload_json WHERE id = ?',
                      [f.inside.id],
                    );
                    expect(updated.rowsAffected).toBe(1);
                    expect(await readHealthContextGeneration(tx)).toEqual({
                      ...before,
                      mutationGeneration: before.mutationGeneration + 1,
                    });
                  }
                  return result;
                },
              }),
            ),
          );
        try {
          // No UI invalidation or cancellation participates in this regression.
          const save = store.bookmarkDiseasePossibilities({
            id: original.id,
            revision: fingerprint(original),
            current: () => true,
          });
          await Promise.race([
            prepared.wait,
            save.then(() => {
              throw new Error('The production bookmark insert was not held.');
            }),
          ]);
          continueWrite.release();
          await expect(save).resolves.toBe(false);
          expect(await store.listSavedGeneratedReportReferences()).toEqual([]);
          expect(await readHealthContextGeneration(f.database)).toEqual(before);
        } finally {
          continueWrite.release();
          intercept.mockRestore();
        }
      } finally {
        f.close();
      }
      const reopened = openSqliteTestDatabase(path);
      try {
        expect(
          await createConversationArtifactStorage(
            reopened.database,
          ).listSavedGeneratedReportReferences(),
        ).toEqual([]);
      } finally {
        reopened.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
