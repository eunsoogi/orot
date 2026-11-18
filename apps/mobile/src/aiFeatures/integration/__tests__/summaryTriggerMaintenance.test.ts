import { healthContextFixture } from '../testSupport/healthContextPersistenceFixture';
import { createSymptomSummaryStorage } from '../../../storage/symptomSummaryStorage';

/** Exact trigger reuse must still run fresh-instance legacy maintenance. */
test('quarantines newly restored legacy rows even when trigger definitions are unchanged', async () => {
  const f = await healthContextFixture();
  try {
    const initial = createSymptomSummaryStorage(f.database);
    await initial.list();
    const original = JSON.stringify(f.saved);
    await f.database.execute('DELETE FROM health_observations WHERE id = ?', [
      f.inside.id,
    ]);
    await f.database.execute(
      'INSERT INTO symptom_summary_runs (id, created_at, model_name, result_json) VALUES (?, ?, ?, ?)',
      [f.saved.id, f.saved.createdAt, f.saved.modelName, original],
    );
    expect(
      await createSymptomSummaryStorage(f.database).read(f.saved.id),
    ).toBeNull();
    expect(
      (
        await f.database.execute(
          'SELECT result_json FROM symptom_summary_runs WHERE id = ?',
          [f.saved.id],
        )
      ).rows[0]?.result_json,
    ).toBe(original);
  } finally {
    f.close();
  }
});
