import { createManualHistoryRepository, type SqlDatabase } from '@orot/storage';
import { createAppearanceStore } from '../src/assistantAppearance/appearanceStore';
import {
  openLocalStorage,
  openLocalAgentMemoryDatabase,
} from '../src/storage/secureDatabase';
const names = [
  'known',
  'unknown',
  'draft',
  'rail',
  'recovery',
  'Duo',
  'Duo-actions',
] as const;

/** Test-product-only, once per scenario. A deletion must stay deleted after relaunch.
 * The marker is committed with the synthetic original; it never scans or rewrites other records. */
export async function seedMemoryHistory(name: unknown): Promise<void> {
  if (!names.includes(name as (typeof names)[number]))
    throw new Error('Unsupported memory fixture');
  const database: SqlDatabase = await openLocalAgentMemoryDatabase();
  await openLocalStorage();
  await database.execute(
    'CREATE TABLE IF NOT EXISTS memory_native_fixture_seed (name TEXT PRIMARY KEY)',
  );
  await database.transaction(async transaction => {
    const scoped: SqlDatabase = {
      execute: (sql, parameters) => transaction.execute(sql, parameters),
      transaction: operation => operation(transaction),
    };
    // A fresh isolated test product must commit appearance before mounting the real gate.
    // Keep any existing selection; this test-only setup does not alter production onboarding.
    const appearance = createAppearanceStore(async () => scoped);
    if (!(await appearance.load()))
      await appearance.save({ avatar: 'neutral', name: null });
    const prior = await transaction.execute(
      'SELECT name FROM memory_native_fixture_seed WHERE name = ?',
      [String(name)],
    );
    if (prior.rows.length) return;
    const repository = createManualHistoryRepository(scoped);
    await repository.create({
      kind: 'note',
      title: `Synthetic ${String(name)} original`,
      details: 'Synthetic previously stored user statement.',
      effectiveDate: { status: 'unknown' },
    });
    await transaction.execute(
      'INSERT INTO memory_native_fixture_seed (name) VALUES (?)',
      [String(name)],
    );
  });
}
