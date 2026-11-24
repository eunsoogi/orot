import type { SqlDatabase, SqlTransaction } from '@orot/storage';

export const settingsConsentReceiptSchema = `CREATE TABLE IF NOT EXISTS settings_joint_activation_receipts (
      activation_id TEXT PRIMARY KEY NOT NULL)`;
export const clearSettingsConsentReceipts =
  'DELETE FROM settings_joint_activation_receipts';

/** Conclude the exact joint decision using the pinned synchronous SQLCipher
 * transaction commit. JS owner checks and COMMIT have no asynchronous gap.
 * The atomic receipt distinguishes a committed result from a rejected call. */
export async function commitSettingsConsentRows(
  database: SqlDatabase,
  update: (tx: SqlTransaction) => Promise<void>,
  receipt: string | null,
  stillValid: () => boolean,
) {
  if (!receipt) return database.transaction(update);
  let commitAttempted = false;
  let committed = false;
  try {
    await database.transaction(async tx => {
      await update(tx);
      await tx.execute(`DELETE FROM settings_joint_activation_receipts
        WHERE activation_id NOT IN
          (SELECT activation_id FROM settings_inference_grants WHERE state = 'active')`);
      await tx.execute(
        'INSERT INTO settings_joint_activation_receipts(activation_id) VALUES (?)',
        [receipt],
      );
      if (!stillValid()) throw new Error('Settings selection changed');
      commitAttempted = true;
      tx.commit();
      // The pinned driver synchronously confirms apply; an outer settlement
      // fault cannot undo this decision. Later invalidations remain independent.
      committed = true;
    });
  } catch (error) {
    if (committed) return;
    if (!commitAttempted) throw error;
    const result = await database.execute(
      'SELECT activation_id FROM settings_joint_activation_receipts WHERE activation_id = ?',
      [receipt],
    );
    if (result.rows.length !== 1 || result.rows[0]?.activation_id !== receipt)
      throw error;
    return;
  }
  if (!committed) throw new Error('Joint permission commit was not confirmed');
}

export const assertSettingsActivationToken = (token: string) => {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(token))
    throw new Error('Invalid activation identity');
};
