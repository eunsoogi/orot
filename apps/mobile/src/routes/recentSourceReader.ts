import type { RecentSourceRow } from '@orot/storage';
import { readCommittedRecentSourcePage } from '../storage/committedRecentSourcePage';

import type { SettledRecentReceipt } from './recentSavedMaterialPageTypes';

export interface RecentMediaRow extends RecentSourceRow {
  readonly key: string;
}

/** One protected indexed page; bodies and original locators stay in the detail repository. */
export async function loadRecentSourceMaterial(
  before?: Pick<RecentMediaRow, 'key' | 'createdAt'>,
  options?: {
    signal: AbortSignal;
    canRetry: () => Promise<boolean>;
    settledOwner?: () => boolean;
    registerSettled?: (receipt: SettledRecentReceipt) => void;
  },
) {
  const { openLocalAgentMemoryDatabase, isCurrentLocalAgentMemoryDatabase } =
    await import('../storage/secureDatabase');
  const owner = await openLocalAgentMemoryDatabase();
  const settledOwner = options?.settledOwner;
  const onSettled = options?.registerSettled;
  return (
    await readCommittedRecentSourcePage(
      owner,
      before && { id: before.key, createdAt: before.createdAt },
      options?.signal,
      options?.canRetry,
      (settledOwner &&
        onSettled && {
          owner: () =>
            settledOwner() && isCurrentLocalAgentMemoryDatabase(owner),
          onSettled,
        }) ||
        undefined,
    )
  ).map(row => ({ ...row, key: row.id }));
}

/** Called only for the selected audio row; never restore all audio/transcripts to build a feed. */
export async function readSelectedRecentRecording(id: string) {
  const { openLocalStorage } = await import('../storage/secureDatabase');
  const records = await openLocalStorage();
  const source = await records.transaction(reader =>
    reader.get('source_record', id),
  );
  return source?.sourceKind === 'audio_recording' && source.id === id
    ? source
    : null;
}
