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
  /** Settings cannot present a damaged protected row as an explicit opt-out. */
  async function readReviewGrant(
    slot: SettingsConsentSlot,
    domain: SettingsConsentDomain,
  ): Promise<
    | { status: 'present'; grant: SettingsConsentGrant }
    | { status: 'unset' | 'unreadable' }
  > {
    validSlot(slot);
    validDomain(domain);
    await ensure();
    let result: Awaited<ReturnType<typeof readReviewGrant>> = {
      status: 'unset',
    };
    await database.transaction(async tx => {
      const rows = await tx.execute(
        `SELECT grant_json FROM settings_inference_grants
         WHERE slot = ? AND domain = ? AND state = 'active'`,
        [slot, domain],
      );
      if (!rows.rows.length) return;
      const raw = rows.rows[0]?.grant_json;
      result = { status: 'unreadable' };
      if (rows.rows.length !== 1 || typeof raw !== 'string') return;
      try {
        const grant = parseSettingsConsentGrant(JSON.parse(raw));
        if (grant) result = { status: 'present', grant };
      } catch {
        // Legacy runtime readers still fail closed; settings can display unknown.
      }
    });
    return result;
  }
  /** Publish all scopes from one review in a single protected transaction.
   * Pending rows cannot authorize, and the outer owner stays suspended until commit. */
  async function activateTogether(
    slot: SettingsConsentSlot,
    decisions: readonly {
      readonly token: string;
      readonly domain: SettingsConsentDomain;
    }[],
    stillValid: () => boolean,
  ) {
    validSlot(slot);
    const entries = decisions.map(({ token, domain }) => {
      validDomain(domain);
      validToken(token);
      return { token, domain };
    });
    if (
      !entries.length ||
      new Set(entries.map(entry => entry.domain)).size !== entries.length ||
      new Set(entries.map(entry => entry.token)).size !== entries.length
    )
      throw new Error('Invalid joint permission activation');
    await ensure();
    await database.transaction(async tx => {
      for (const { token, domain } of entries) {
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
        const activated = await tx.execute(
          `UPDATE settings_inference_grants SET state = 'active'
          WHERE activation_id = ? AND slot = ? AND domain = ? AND state = 'pending'`,
          [token, slot, domain],
        );
        if (entries.length > 1) {
          const updated =
            activated.rowsAffected ??
            (
              await tx.execute(
                "SELECT activation_id FROM settings_inference_grants WHERE activation_id = ? AND slot = ? AND domain = ? AND state = 'active'",
                [token, slot, domain],
              )
            ).rows.length;
          if (updated !== 1)
            throw new Error('Joint permission activation incomplete');
        }
        if (!stillValid()) throw new Error('Settings selection changed');
      }
    });
    // An owner can invalidate after the callback but before native commit. Do
    // not restore any old authority; undo only entries from this exact decision.
    if (!stillValid()) {
      await database.transaction(async tx => {
        for (const { token } of entries)
          await tx.execute(
            'DELETE FROM settings_inference_grants WHERE activation_id = ?',
            [token],
          );
      });
      throw new Error('Settings selection changed after commit');
    }
  }
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
    activate(
      slot: SettingsConsentSlot,
      token: string,
      stillValid: () => boolean,
      domain: SettingsConsentDomain = 'model',
    ) {
      return activateTogether(slot, [{ token, domain }], stillValid);
    },
    activateTogether,
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
    ) {
      const result = await readReviewGrant(slot, domain);
      return result.status === 'present' ? result.grant : null;
    },
    readReviewGrant,
    async clear() {
      await ensure();
      await database.transaction(async tx => {
        await tx.execute('DELETE FROM settings_inference_grants');
      });
    },
  };
}
