import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createAppearanceStore } from '../appearanceStore';

jest.unmock('../appearanceStore');
jest.mock('../../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
}));

test('stores a coherent pair, preserves it on failed replacement, and supports clear', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    const store = createAppearanceStore(async () => connection.database);
    expect(await store.load()).toBeNull();
    await store.save({ avatar: 'neutral', name: '  한글  ' });
    expect(await store.load()).toEqual({ avatar: 'neutral', name: '한글' });
    await connection.database.execute(
      "CREATE TRIGGER fail_appearance BEFORE INSERT ON assistant_appearance BEGIN SELECT RAISE(ABORT, 'failure'); END",
    );
    await expect(
      store.save({ avatar: 'leaf', name: '새 이름' }),
    ).rejects.toThrow();
    expect(await store.load()).toEqual({ avatar: 'neutral', name: '한글' });
    await connection.database.execute('DROP TRIGGER fail_appearance');
    await store.save({ avatar: 'leaf', name: null });
    expect(await store.load()).toEqual({ avatar: 'leaf', name: null });
    await store.clear();
    expect(await store.load()).toBeNull();
  } finally {
    connection.close();
  }
});

test('a storage read failure is propagated instead of treated as missing', async () => {
  const store = createAppearanceStore(async () => {
    throw new Error('locked');
  });
  await expect(store.load()).rejects.toThrow('locked');
});
