import type { SqlDatabase } from '@orot/storage';
import {
  isAvatarId,
  normalizeAssistantName,
  parseAppearance,
} from './appearance';
import type { AssistantAppearance } from './appearance';

/** A single encrypted row commits the pair in one database transaction. */
export function createAppearanceStore(open: () => Promise<SqlDatabase>) {
  const prepare = async () => {
    const database = await open();
    await database.execute(
      'CREATE TABLE IF NOT EXISTS assistant_appearance (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), value TEXT NOT NULL)',
    );
    return database;
  };
  return {
    async load(): Promise<AssistantAppearance | null> {
      const database = await prepare();
      const result = await database.execute(
        'SELECT value FROM assistant_appearance WHERE singleton = 1',
      );
      if (!result.rows.length) return null;
      const value = result.rows[0]?.value;
      if (typeof value !== 'string')
        throw new Error('Invalid appearance storage');
      return parseAppearance(value);
    },
    async save(appearance: AssistantAppearance): Promise<AssistantAppearance> {
      if (!isAvatarId(appearance.avatar)) throw new Error('avatar');
      const committed = {
        avatar: appearance.avatar,
        name: normalizeAssistantName(appearance.name ?? ''),
      };
      const database = await prepare();
      await database.transaction(async tx => {
        await tx.execute(
          'INSERT OR REPLACE INTO assistant_appearance (singleton, value) VALUES (1, ?)',
          [JSON.stringify(committed)],
        );
      });
      return committed;
    },
    async clear(): Promise<void> {
      const database = await prepare();
      await database.execute(
        'DELETE FROM assistant_appearance WHERE singleton = 1',
      );
    },
  };
}

export const appearanceStore = createAppearanceStore(async () => {
  const { openLocalAgentMemoryDatabase } =
    await import('../storage/secureDatabase');
  return openLocalAgentMemoryDatabase();
});
