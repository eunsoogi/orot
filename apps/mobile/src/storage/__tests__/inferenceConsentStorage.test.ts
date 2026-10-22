import { createHash } from '../../agent/execution/consentHashTestSupport';
import { createInferenceConsentStorage } from '../inferenceConsentStorage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  mkdtempSync,
  rmSync,
  join,
  tmpdir,
} from '../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';

/** A real SQLite reopen proves the receipt is durable and contains no request columns. */
test('persists only SHA-256 receipts across reopen, rejects raw text, and clears them', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-consent-'));
  const path = join(directory, 'receipts.sqlite');
  let connection = openSqliteTestDatabase(path);
  const key = createHash('sha256')
    .update('Synthetic private input')
    .digest('hex');
  try {
    const store = createInferenceConsentStorage(connection.database);
    await store.save(key, () => true);
    await expect(
      store.save('Synthetic private input', () => true),
    ).rejects.toThrow();
    connection.close();
    connection = openSqliteTestDatabase(path);
    const restored = createInferenceConsentStorage(connection.database);
    expect(await restored.has(key)).toBe(true);
    const rows = await connection.database.execute(
      'SELECT * FROM inference_consent_receipts',
    );
    expect(rows.rows).toEqual([{ digest: key }]);
    let calls = 0;
    const another = createHash('sha256')
      .update('Another synthetic request')
      .digest('hex');
    await expect(restored.save(another, () => ++calls === 1)).rejects.toThrow();
    expect(await restored.has(another)).toBe(false);
    await restored.clear();
    expect(await restored.has(key)).toBe(false);
  } finally {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
