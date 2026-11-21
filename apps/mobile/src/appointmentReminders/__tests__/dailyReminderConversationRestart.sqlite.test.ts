import { createDailyReportIdentity } from '@orot/domain';
import { runMigrations } from '@orot/storage';
import {
  getGenericPassword,
  setGenericPassword,
  STORAGE_TYPE,
} from 'react-native-keychain';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { createConversationSessionRetention } from '../../ragConversation/conversationSessionRetention';
import { createConversationSessions } from '../../ragConversation/conversationSessions';
import { restoreConversationTaskCards } from '../../aiFeatures/integration/restoreConversationTaskCards';
import { createNavigationController } from '../../navigation/navigationController';
import type { AppNavigationRoute } from '../../routes/appNavigationRoute';
import { createDailyReminderConversation } from '../dailyReminderConversation';
import { createDailyReminderDestination } from '../dailyReminderDestination';
import { dailyReminderIntentStore } from '../dailyReminderIntentStore';
import { parseDailyReminderEntry } from '../dailyReminderDelivery';

jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked' },
  STORAGE_TYPE: { AES_GCM_NO_AUTH: 'KeystoreAESGCM_NoAuth' },
  getGenericPassword: jest.fn(),
  setGenericPassword: jest.fn(),
}));

// Only the OS Keychain boundary is synthetic. Session leases, card persistence and
// restoration use production adapters over a real SQLite file reopened after disposal.
test('a failed intent consumption preserves the selected day and exact card through a fresh session lifetime', async () => {
  const { mkdtempSync, rmSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  const directory = mkdtempSync(join(tmpdir(), 'orot-reminder-restart-'));
  const path = join(directory, 'database.sqlite');
  let connection = openSqliteTestDatabase(path);
  let storage = createConversationArtifactStorage(connection.database);
  let protectedValue: { username: string; password: string } | null = null;
  let failConsumption = true;
  jest.mocked(getGenericPassword).mockImplementation(async () =>
    protectedValue
      ? {
          ...protectedValue,
          service: 'synthetic',
          storage: STORAGE_TYPE.AES_GCM_NO_AUTH,
        }
      : false,
  );
  jest
    .mocked(setGenericPassword)
    .mockImplementation(async (username, password) => {
      if (!JSON.parse(password).active && failConsumption) {
        failConsumption = false;
        throw new Error('Synthetic protected storage write failure');
      }
      protectedValue = { username, password };
      return { service: 'synthetic', storage: STORAGE_TYPE.AES_GCM_NO_AUTH };
    });
  let sequence = 0;
  function lifetime() {
    const retention = createConversationSessionRetention({
      openStorage: async () => storage,
      createId: () => `synthetic-session-${++sequence}`,
      now: () => '2023-11-15T12:00:00.000Z',
    });
    const sessions = createConversationSessions({
      retention,
      // This fixture has no conversation turns or inference; only retained tasks.
      restoreSession: async () => [],
      restoreTasks: (id, signal) =>
        restoreConversationTaskCards(storage, id, signal),
    });
    const controller = createNavigationController<AppNavigationRoute>('root');
    const root = controller.getSnapshot().currentRoute;
    controller.registerLeaveGuard(root.key, async () => true);
    const open = createDailyReminderConversation({
      sessions,
      retention,
      controller,
      confirm: () => controller.requestTabSwitchDecision(),
      openRoot: key => controller.commitApprovedRoot(key),
    });
    const destination = createDailyReminderDestination({
      ...dailyReminderIntentStore,
      open,
      consumeOnOpened: true,
    });
    return { sessions, retention, destination, controller, root };
  }
  let current: ReturnType<typeof lifetime> | undefined;
  try {
    await runMigrations(connection.database);
    current = lifetime();
    const originalId = current.sessions.getSnapshot().activeId;
    const entry = parseDailyReminderEntry(
      { kind: 'daily_report', deliveryTimestamp: '1700000000' },
      'Asia/Seoul',
    )!;
    await expect(current.destination.accept(entry)).rejects.toThrow(
      'Synthetic protected storage',
    );
    const pending = await dailyReminderIntentStore.read();
    expect(pending?.active).toBe(true);
    expect(pending?.entry.conversationOwner).toMatchObject({
      id: 'synthetic-session-1',
      version: 0,
    });
    expect(current.retention.activeLease(originalId)).toEqual({
      id: 'synthetic-session-1',
      version: 0,
    });
    const initial = await storage.readTaskCards('synthetic-session-1', 0);
    expect(initial).toHaveLength(1);
    expect(initial[0].task).toMatchObject({
      reminder: true,
      identity: { localDate: '2023-11-15', timeZone: 'Asia/Seoul' },
    });
    // Model the explicit UI identity callback followed by its committed result callback.
    const selected = createDailyReportIdentity(
      '2023-11-16',
      'America/New_York',
    );
    await current.sessions.saveTaskCard(originalId, entry.entryKey, {
      kind: 'daily_report',
      identity: selected,
    });
    const report = {
      identity: selected,
      runId: 'synthetic-report',
      revision: 3,
    };
    await current.sessions.saveTaskCard(originalId, entry.entryKey, {
      kind: 'daily_report',
      identity: selected,
      report,
    });
    const expected = await storage.readTaskCards('synthetic-session-1', 0);
    expect(expected[0].task).toEqual({
      kind: 'daily_report',
      identity: selected,
      report,
    });
    current.sessions.dispose();
    current = undefined;
    connection.close();
    connection = openSqliteTestDatabase(path);
    storage = createConversationArtifactStorage(connection.database);
    current = lifetime();
    // Another active conversation must not capture the pending reminder after restart.
    current.sessions.create();
    const otherId = current.sessions.getSnapshot().activeId;
    expect(await current.destination.restore()).toBe('opened');
    const snapshot = current.sessions.getSnapshot();
    expect(snapshot.activeId).not.toBe(otherId);
    expect(current.retention.activeLease(snapshot.activeId)).toEqual({
      id: 'synthetic-session-1',
      version: 0,
    });
    expect(
      snapshot.sessions.find(session => session.id === snapshot.activeId)
        ?.taskCards,
    ).toEqual(expected);
    expect(
      snapshot.sessions.find(session => session.id === otherId)?.taskCards ??
        [],
    ).toHaveLength(0);
    expect(await storage.readTaskCards('synthetic-session-1', 0)).toEqual(
      expected,
    );
    expect(current.controller.getSnapshot().routes).toEqual([current.root]);
    expect(await dailyReminderIntentStore.read()).toEqual({
      ...pending,
      active: false,
    });
    expect(sequence).toBe(1);
  } finally {
    current?.sessions.dispose();
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
