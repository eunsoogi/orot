import type { SqlDatabase } from '@orot/storage';
import {
  parseSettingsConsentGrant,
  type SettingsConsentGrant,
} from '../agent/execution/settingsConsentGrant';

export type SettingsConsentSlot = 'conversation' | 'calendar' | 'voice';
export type SettingsConsentDomain = 'model' | 'public-web' | 'medical-search';
const validDomain = (domain: SettingsConsentDomain) => {
  if (!['model', 'public-web', 'medical-search'].includes(domain))
    throw new Error('Invalid permission domain');
};
const validSlot = (slot: SettingsConsentSlot) => {
  if (!['conversation', 'calendar', 'voice'].includes(slot))
    throw new Error('Invalid consent slot');
};
const validToken = (token: string) => {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(token))
    throw new Error('Invalid activation identity');
};

/** Pending grants never authorize transmission. Selection and activation are separate
 * protected writes: a failed/cancelled selection leaves the previous active row intact.
 * Callers must compare the current selection/account epoch before using any active row. */
export function createSettingsConsentStorage(database: SqlDatabase) {
  let ready: Promise<unknown> | undefined;
  const ensure = () =>
    (ready ??= database
      .transaction(async tx => {
        await tx.execute(`CREATE TABLE IF NOT EXISTS settings_inference_grants (
      activation_id TEXT PRIMARY KEY NOT NULL, slot TEXT NOT NULL, domain TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('pending', 'active')), grant_json TEXT NOT NULL)`);
        await tx.execute(`CREATE UNIQUE INDEX IF NOT EXISTS settings_inference_active_slot
      ON settings_inference_grants(slot, domain) WHERE state = 'active'`);
      })
      .catch(error => {
        ready = undefined;
        throw error;
      }));
  return {
    async stage(
      slot: SettingsConsentSlot,
      token: string,
      grant: SettingsConsentGrant,
      domain: SettingsConsentDomain = 'model',
    ) {
      validSlot(slot);
      validDomain(domain);
      validToken(token);
      const parsed = parseSettingsConsentGrant(grant);
      if (!parsed) throw new Error('Invalid settings permission');
      await ensure();
      await database.transaction(async tx => {
        // No replace: reusing an activation identity must not overwrite a prior decision.
        await tx.execute(
          `INSERT INTO settings_inference_grants
          (activation_id, slot, domain, state, grant_json) VALUES (?, ?, ?, 'pending', ?)`,
          [token, slot, domain, JSON.stringify(parsed)],
        );
      });
    },
    async activate(
      slot: SettingsConsentSlot,
      token: string,
      stillValid: () => boolean,
      domain: SettingsConsentDomain = 'model',
    ) {
      validSlot(slot);
      validDomain(domain);
      validToken(token);
      await ensure();
      await database.transaction(async tx => {
        if (!stillValid()) throw new Error('Settings selection changed');
        const pending = await tx.execute(
          `SELECT grant_json FROM settings_inference_grants
          WHERE activation_id = ? AND slot = ? AND domain = ? AND state = 'pending'`,
          [token, slot, domain],
        );
        if (pending.rows.length !== 1)
          throw new Error('Pending permission unavailable');
        const value = pending.rows[0].grant_json;
        if (
          typeof value !== 'string' ||
          !parseSettingsConsentGrant(JSON.parse(value))
        )
          throw new Error('Pending permission invalid');
        if (!stillValid()) throw new Error('Settings selection changed');
        await tx.execute(
          `DELETE FROM settings_inference_grants WHERE slot = ? AND domain = ? AND state = 'active'`,
          [slot, domain],
        );
        await tx.execute(
          `UPDATE settings_inference_grants SET state = 'active'
          WHERE activation_id = ? AND slot = ? AND domain = ? AND state = 'pending'`,
          [token, slot, domain],
        );
        if (!stillValid()) throw new Error('Settings selection changed');
      });
      // A native transaction may finish committing after its callback returns.
      // Never report success for a permission invalidated in that interval.
      if (!stillValid()) {
        await database.transaction(async tx => {
          await tx.execute(
            'DELETE FROM settings_inference_grants WHERE activation_id = ?',
            [token],
          );
        });
        throw new Error('Settings selection changed after commit');
      }
    },
    async cancel(token: string) {
      validToken(token);
      await ensure();
      await database.transaction(async tx => {
        await tx.execute(
          `DELETE FROM settings_inference_grants
          WHERE activation_id = ? AND state = 'pending'`,
          [token],
        );
      });
    },
    async read(
      slot: SettingsConsentSlot,
      domain: SettingsConsentDomain = 'model',
    ): Promise<SettingsConsentGrant | null> {
      validSlot(slot);
      validDomain(domain);
      await ensure();
      let result: SettingsConsentGrant | null = null;
      // Queue behind mutations; a raw connection read could observe uncommitted activation.
      await database.transaction(async tx => {
        const rows = await tx.execute(
          `SELECT grant_json FROM settings_inference_grants
          WHERE slot = ? AND domain = ? AND state = 'active'`,
          [slot, domain],
        );
        if (rows.rows.length !== 1) return;
        const value = rows.rows[0].grant_json;
        if (typeof value !== 'string') return;
        try {
          result = parseSettingsConsentGrant(JSON.parse(value));
        } catch {
          result = null;
        }
      });
      return result;
    },
    async clear() {
      await ensure();
      await database.transaction(async tx => {
        await tx.execute('DELETE FROM settings_inference_grants');
      });
    },
  };
}
