import type { SqlDatabase } from '@orot/storage';
import type { InferenceConsentReceipts } from '../agent/execution/rememberedInferenceConsent';
import {
  beginConsentReset,
  finishConsentReset,
} from '../agent/execution/consentRevision';

/** Receipt rows contain SHA-256 values only, in the existing encrypted database. */
export function createInferenceConsentStorage(
  database: SqlDatabase,
): InferenceConsentReceipts {
  let ready: Promise<unknown> | undefined;
  const ensure = () =>
    (ready ??= database
      .transaction(async tx => {
        await tx.execute(
          'CREATE TABLE IF NOT EXISTS inference_consent_receipts (digest TEXT PRIMARY KEY NOT NULL)',
        );
      })
      .catch(error => {
        ready = undefined;
        throw error;
      }));
  const requireDigest = (digest: string) => {
    if (!/^[a-f0-9]{64}$/.test(digest))
      throw new Error('Invalid consent receipt');
  };
  return {
    async has(digest) {
      requireDigest(digest);
      await ensure();
      let found = false;
      // Queue reads with writes: the production connection otherwise exposes uncommitted rows.
      await database.transaction(async tx => {
        const result = await tx.execute(
          'SELECT digest FROM inference_consent_receipts WHERE digest = ? LIMIT 1',
          [digest],
        );
        found = result.rows.length === 1;
      });
      return found;
    },
    async save(digest, stillValid) {
      requireDigest(digest);
      await ensure();
      await database.transaction(async tx => {
        if (!stillValid())
          throw new Error('Consent changed before persistence');
        await tx.execute(
          'INSERT OR IGNORE INTO inference_consent_receipts (digest) VALUES (?)',
          [digest],
        );
        if (!stillValid())
          throw new Error('Consent changed during persistence');
      });
    },
    async clear() {
      await ensure();
      // Raw execute could join another transaction and later be rolled back after a successful reset.
      await database.transaction(async tx => {
        await tx.execute('DELETE FROM inference_consent_receipts');
      });
    },
  };
}

let store: Promise<InferenceConsentReceipts> | undefined;
const load = () =>
  (store ??= import('./secureDatabase')
    .then(module => module.openLocalAgentMemoryDatabase())
    .then(createInferenceConsentStorage)
    .catch(error => {
      store = undefined;
      throw error;
    }));

export const inferenceConsentReceipts: InferenceConsentReceipts = {
  has: async digest => (await load()).has(digest),
  save: async (digest, valid) => (await load()).save(digest, valid),
  clear: async () => (await load()).clear(),
};

/** Disable reuse before asynchronous deletion, including every active in-memory registry. */
export async function resetInferenceConsentReceipts() {
  beginConsentReset();
  await inferenceConsentReceipts.clear();
  finishConsentReset();
}
