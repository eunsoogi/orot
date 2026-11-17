import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { conversationSelectedIds } from '../conversationSelectedIds';

test('binds selected identities beyond the former fifty-item ceiling without interpolating values', async () => {
  const f = await healthContextFixture();
  try {
    const ids = Array.from({ length: 75 }, (_, index) => `turn-${index}`);
    const query = conversationSelectedIds('id', ids);
    expect(query.parameters).toHaveLength(1);
    const result = await f.database.execute(
      `SELECT id FROM (SELECT value AS id FROM json_each(?)) WHERE 1 = 1${query.clause}`,
      [JSON.stringify([...ids, 'unrelated']), ...query.parameters],
    );
    expect(result.rows.map(row => row.id)).toEqual(ids);
    const empty = conversationSelectedIds('id', []);
    expect(
      (
        await f.database.execute(
          `SELECT 'unrelated' AS id WHERE 1 = 1${empty.clause}`,
          empty.parameters,
        )
      ).rows,
    ).toEqual([]);
    expect(() => conversationSelectedIds('id', [''])).toThrow();
  } finally {
    f.close();
  }
});
