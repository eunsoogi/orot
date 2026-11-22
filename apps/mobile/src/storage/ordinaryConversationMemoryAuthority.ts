import type { SqlDatabase } from '@orot/storage';
import { createConsentAuthority } from '../agent/execution/consentAuthority';
import {
  createOrdinaryConversationMemoryEnrollmentStore,
  matchesOrdinaryConversationMemoryEnrollment,
  readOrdinaryConversationMemoryEnrollment,
} from './ordinaryConversationMemoryEnrollment';

/** The SQLite row is backed up; the authority owner must not migrate with it.
 * Activation is last, so interruption between the two durable writes is off. */
export function createOrdinaryConversationMemoryOwner(
  database: SqlDatabase,
  authority: ReturnType<typeof createConsentAuthority>,
) {
  const enrollment = createOrdinaryConversationMemoryEnrollmentStore(database);
  let revision = 0;
  let observedRevision = 0;

  const revoke = async () => {
    const owner = ++revision;
    const revoked = await authority.revoke();
    if (owner !== revision) return false;
    // The saved denial alone is sufficient to prevent automatic writes, even
    // when SQLite receipt cleanup fails. Do not reissue the old permission.
    const previous = await enrollment.read();
    const cleared = await enrollment.replace(
      previous,
      null,
      () => owner === revision,
    );
    return !!cleared && owner === revision && revoked.status === 'revoked';
  };

  return {
    async settingsEnrollmentIsOff() {
      return !(await enrollment.read()).enabled;
    },
    async capture() {
      const owner = revision;
      const observation = observedRevision;
      const isObserved = () =>
        owner === revision && observation === observedRevision;
      const invalidate = () => {
        if (isObserved()) observedRevision++;
      };
      let receipt;
      let durable;
      let witness: (() => boolean) | undefined;
      try {
        durable = await authority.current();
        if (!durable || !isObserved()) {
          invalidate();
          return;
        }
        witness = authority.witness(durable.generation);
        receipt = await enrollment.read();
      } catch (error) {
        invalidate();
        throw error;
      }
      const isCurrent = () => isObserved() && witness?.() === true;
      if (
        !isCurrent() ||
        !matchesOrdinaryConversationMemoryEnrollment(
          receipt,
          durable.generation,
        )
      ) {
        // A newly observed unavailable or replaced owner invalidates old
        // receipts, even if the same device value is observed again later.
        invalidate();
        return;
      }
      return {
        database,
        generation: receipt.generation,
        deviceEpoch: durable.generation,
        isCurrent,
      };
    },
    async enable(requestIsCurrent: () => boolean) {
      if (!requestIsCurrent()) return false;
      const owner = ++revision;
      const isCurrent = () => owner === revision && requestIsCurrent();
      const suspended = await authority.suspend();
      if (!isCurrent()) return false;
      const previous = await enrollment.read();
      if (!isCurrent()) return false;
      const bound = await enrollment.replace(
        previous,
        suspended.generation,
        isCurrent,
      );
      if (!bound || !isCurrent()) return false;
      // Re-read the committed receipt before and after authorizing. A SQL
      // receipt left behind after cancellation is inert while suspended.
      const boundIsCurrent = async () => {
        if (!isCurrent()) return false;
        const current =
          await readOrdinaryConversationMemoryEnrollment(database);
        return (
          isCurrent() &&
          current.generation === bound.generation &&
          matchesOrdinaryConversationMemoryEnrollment(
            current,
            suspended.generation,
          )
        );
      };
      return authority.complete(suspended, boundIsCurrent);
    },
    revoke,
  };
}
