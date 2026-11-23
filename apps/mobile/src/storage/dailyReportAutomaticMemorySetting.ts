import {
  publishDailyReportMemoryTap,
  type DailyReportMemoryTap,
} from './dailyReportMemoryTap';
import type { createConsentAuthority } from '../agent/execution/consentAuthority';
import type { SqlDatabase, SqlExecutor } from '@orot/storage';

type DailyReportMemoryOwner = {
  readonly artifactId: string;
  readonly lease: { readonly id: string; readonly version: number };
};

/** A separate protected preference; replying in a preferred style grants nothing here. */
export async function setupDailyReportAutomaticMemory(tx: SqlExecutor) {
  await tx.execute(`CREATE TABLE IF NOT EXISTS daily_report_automatic_memory (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    generation INTEGER NOT NULL CHECK (generation >= 0),
    device_epoch TEXT,
    CHECK((enabled = 0 AND device_epoch IS NULL) OR (enabled = 1 AND device_epoch IS NOT NULL))
  )`);
}

async function enabledGeneration(
  tx: SqlExecutor,
  deviceEpoch: string,
): Promise<number | null> {
  const row = (
    await tx.execute(
      'SELECT generation FROM daily_report_automatic_memory WHERE singleton = 1 AND enabled = 1 AND device_epoch = ?',
      [deviceEpoch],
    )
  ).rows[0];
  return typeof row?.generation === 'number' &&
    Number.isSafeInteger(row.generation)
    ? row.generation
    : null;
}

type Revocation = { epoch: number; blocked: boolean };
const revocations = new WeakMap<SqlDatabase, Revocation>();

/** Opaque, process-local admission. Re-enabling never revives a receipt from an older opt-in. */
export function dailyReportAutomaticMemorySetting(
  database: SqlDatabase,
  ensure: () => Promise<void>,
  openAuthority = () =>
    (
      require('./dailyReportDeviceAuthority') as typeof import('./dailyReportDeviceAuthority')
    ).dailyReportDeviceAuthority,
) {
  const revocation = revocations.get(database) ?? { epoch: 0, blocked: false };
  revocations.set(database, revocation);
  const admissions = new WeakMap<
    object,
    {
      generation: number;
      epoch: number;
      device: string;
      deviceCurrent: () => boolean;
      owner: DailyReportMemoryOwner;
    }
  >();
  return {
    async enabled(stillVisible = () => true) {
      const unavailable = () => {
        if (stillVisible()) publishDailyReportMemoryTap();
        return false;
      };
      try {
        await ensure();
        const authority: ReturnType<typeof createConsentAuthority> =
          openAuthority();
        const owner = await authority.current();
        if (!owner || !stillVisible()) return unavailable();
        const current = authority.witness(owner.generation);
        const generation = await enabledGeneration(database, owner.generation);
        if (generation === null || !current() || !stillVisible())
          return unavailable();
        publishDailyReportMemoryTap({
          database,
          sqlGeneration: generation,
          deviceGeneration: owner.generation,
          current,
        });
        return true;
      } catch (error) {
        unavailable();
        throw error;
      }
    },
    async change(enabled: boolean, current: () => boolean) {
      if (!current()) return false;
      // The tap revokes all in-flight admissions before the writer queue can yield.
      if (!enabled) {
        revocation.epoch += 1;
        revocation.blocked = true;
      }
      const epoch = revocation.epoch;
      const authority = openAuthority();
      const device = await (enabled ? authority.suspend() : authority.revoke());
      await ensure();
      let saved = false;
      await database.transaction(async tx => {
        // A confirmed local disable still completes if Settings loses ownership;
        // an enable must not outlive the route that granted it.
        if (enabled && !current()) return;
        await tx.execute(
          `INSERT INTO daily_report_automatic_memory VALUES (1, ?, 0, ?)
          ON CONFLICT(singleton) DO UPDATE SET enabled = excluded.enabled,
          generation = generation + 1, device_epoch = excluded.device_epoch`,
          [enabled ? 1 : 0, enabled ? device.generation : null],
        );
        if (enabled && !current())
          throw new Error('Daily Report Memory setting owner moved.');
        tx.commit();
        saved = true;
      });
      if (!saved || !enabled) return saved;
      const active = await authority.complete(device, async () => {
        return (
          current() &&
          revocation.epoch === epoch &&
          (await enabledGeneration(database, device.generation)) !== null &&
          current() &&
          revocation.epoch === epoch
        );
      });
      if (active && revocation.epoch === epoch) revocation.blocked = false;
      return active;
    },
    admit(owner: DailyReportMemoryOwner, tap: DailyReportMemoryTap) {
      if (!tap.current() || tap.database !== database || revocation.blocked)
        return null;
      const token = {};
      admissions.set(token, {
        generation: tap.sqlGeneration,
        epoch: revocation.epoch,
        device: tap.deviceGeneration,
        deviceCurrent: tap.current,
        owner: { artifactId: owner.artifactId, lease: { ...owner.lease } },
      });
      return token;
    },
    consume(token: object, owner: DailyReportMemoryOwner) {
      const admission = admissions.get(token);
      admissions.delete(token);
      const live = () =>
        admission !== undefined &&
        admission.deviceCurrent() &&
        !revocation.blocked &&
        admission.epoch === revocation.epoch &&
        admission.owner.artifactId === owner.artifactId &&
        admission.owner.lease.id === owner.lease.id &&
        admission.owner.lease.version === owner.lease.version;
      return {
        live,
        matches: async (tx: SqlExecutor) => {
          if (!admission || !live()) return false;
          if (
            admission.generation !==
              (await enabledGeneration(tx, admission.device)) ||
            !live()
          )
            return false;
          // The device-only permission is the last async read before the final
          // synchronous owner fence and commit in the caller.
          const observed = await openAuthority().current();
          return observed?.generation === admission.device && live();
        },
      };
    },
  };
}
