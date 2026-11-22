import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createSettingsConsentStorage } from '../../../storage/settingsConsentStorage';
import {
  createConsentAuthority,
  type ConsentAuthorityState,
} from '../consentAuthority';
import { commitJointExistingModelConsent } from '../jointExistingModelConsent';
import { settingsPermissionsForFeature } from '../settingsConsentCatalog';
import type { SettingsConsentGrant } from '../settingsConsentGrant';

export const slots = ['conversation', 'calendar'] as const;
type Slot = (typeof slots)[number];

export function openJointConsentFixture() {
  const db = openSqliteTestDatabase(':memory:');
  let afterCommit: (() => Promise<void>) | undefined;
  let beforeSeal: (() => Promise<void>) | undefined;
  let commitFault: 'before' | 'after' | undefined;
  let afterCallback: (() => Promise<void>) | undefined;
  let explicitCommitCount = 0;
  const storage = createSettingsConsentStorage({
    execute: (...args) => db.database.execute(...args),
    transaction: async work => {
      const outcome = await db.database.transaction(async tx => {
        await work({
          execute: async (...args) => {
            const result = await tx.execute(...args);
            if (
              args[0].startsWith(
                'INSERT INTO settings_joint_activation_receipts',
              )
            )
              await beforeSeal?.();
            return result;
          },
          commit() {
            explicitCommitCount += 1;
            if (commitFault === 'before')
              throw new Error('synthetic sync rollback error');
            const result = tx.commit();
            if (commitFault === 'after')
              throw new Error('synthetic synchronous commit result lost');
            return result;
          },
          rollback: () => tx.rollback(),
        });
        await afterCallback?.();
      });
      await afterCommit?.();
      return outcome;
    },
  });
  let sequence = 0;
  const invalid = new Set<Slot>();
  const durable = new Map<Slot, ConsentAuthorityState>();
  let onWrite: (
    slot: Slot,
    value: ConsentAuthorityState,
  ) => Promise<void> = async () => {};
  const create = (slot: Slot) =>
    createConsentAuthority(
      {
        read: async () => durable.get(slot) ?? null,
        write: async value => {
          await onWrite(slot, value);
          durable.set(slot, value);
        },
      },
      () => (++sequence).toString(16).padStart(64, '0'),
    );
  const target = (slot: Slot) => ({
    slot,
    authority: create(slot),
    ownerCurrent: () => !invalid.has(slot),
    grants: (generation: string) => [
      {
        domain: 'model' as const,
        grant: {
          version: 1,
          catalogVersion: 'model-settings-v1',
          identity: {
            providerId: `synthetic-${slot}`,
            modelId: 'synthetic',
            recipient: slot,
            credentialEpoch: 'synthetic',
            authorityGeneration: generation,
          },
          permissions: settingsPermissionsForFeature(slot),
        } satisfies SettingsConsentGrant,
      },
    ],
  });
  const targets = [target('conversation'), target('calendar')] as const;
  const usable = async (slot: Slot) =>
    (await createSettingsConsentStorage(db.database).read(slot))?.identity
      .authorityGeneration === (await create(slot).current())?.generation &&
    durable.get(slot)?.status === 'active';
  const approve = (confirm = true) =>
    commitJointExistingModelConsent(targets, storage, () => confirm);
  return {
    targets,
    db,
    usable,
    approve,
    storage,
    durable,
    beforeSeal: (next: typeof beforeSeal) => {
      beforeSeal = next;
    },
    commitFault: (stage: typeof commitFault) => {
      commitFault = stage;
    },
    afterCallback: (next: typeof afterCallback) => {
      afterCallback = next;
    },
    explicitCommitCount: () => explicitCommitCount,
    afterCommit: (next: typeof afterCommit) => {
      afterCommit = next;
    },
    intercept: (next: typeof onWrite) => {
      onWrite = next;
    },
    invalidate: (slot: Slot) => {
      invalid.add(slot);
    },
  };
}
