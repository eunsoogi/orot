import type { RecentSourceRow } from '@orot/storage';
import { readCommittedRecentSourcePage } from '../storage/committedRecentSourcePage';

export interface RecentMediaRow extends RecentSourceRow {
  readonly key: string;
}

/** One protected indexed page; bodies and original locators stay in the detail repository. */
export async function loadRecentSourceMaterial(
  before?: Pick<RecentMediaRow, 'key' | 'createdAt'>,
) {
  const { openLocalAgentMemoryDatabase } =
    await import('../storage/secureDatabase');
  return (
    await readCommittedRecentSourcePage(
      await openLocalAgentMemoryDatabase(),
      before && { id: before.key, createdAt: before.createdAt },
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
