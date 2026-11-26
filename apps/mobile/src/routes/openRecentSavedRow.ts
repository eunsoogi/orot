import { conversationExecutionNative } from '../ragConversation/conversationExecutionNative';
import { isProtectedDataReadable } from './requestRecentSavedMaterialPage';
import type { RecentPageWitness } from './recentSavedMaterialPageTypes';

export type RecentRowSelection<Row> = (
  value: Row,
  revalidate: () => Promise<boolean>,
  current: () => boolean,
) => void | Promise<void>;

/** A delayed open must reprove the exact current protected row. */
export async function openRecentSavedRow<Row>(
  row: Row,
  select: RecentRowSelection<Row>,
  current: () => boolean,
  getWitness: () => RecentPageWitness | undefined,
  refuse: () => void,
) {
  const protection = conversationExecutionNative();
  const revalidate = async () => {
    if (!current()) return false;
    const admitted = Boolean(
      protection?.bridgeAvailable &&
      (await isProtectedDataReadable(protection)),
    );
    if (!current()) return false;
    if (!admitted) {
      refuse();
      return false;
    }
    const witness = getWitness();
    if (!witness) return true;
    let owned = false;
    try {
      owned = witness.isCurrent() && (await witness.verify());
    } catch {
      // Fail closed if the source's exact revision cannot be revalidated.
    }
    if (!current()) return false;
    if (!owned || !witness.isCurrent()) {
      refuse();
      return false;
    }
    return true;
  };
  if ((await revalidate()) && current()) await select(row, revalidate, current);
}
