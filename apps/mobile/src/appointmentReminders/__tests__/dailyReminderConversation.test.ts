import { createDailyReminderConversation } from '../dailyReminderConversation';
import { parseDailyReminderEntry } from '../dailyReminderDelivery';
import { createNavigationController } from '../../navigation/navigationController';
import { createConversationSessions } from '../../ragConversation/conversationSessions';
import type { AppNavigationRoute } from '../../routes/appNavigationRoute';

const entry = parseDailyReminderEntry(
  { kind: 'daily_report', deliveryTimestamp: '1700000000' },
  'Asia/Seoul',
)!;
function fixture() {
  const controller = createNavigationController<AppNavigationRoute>('root');
  const root = controller.getSnapshot().currentRoute;
  const child = controller.push('health-records')!;
  const guard = jest.fn(async () => true);
  controller.registerLeaveGuard(child.key, guard);
  const sessions = createConversationSessions();
  const openRoot = jest.fn((key: string) => controller.commitApprovedRoot(key));
  return {
    controller,
    root,
    child,
    guard,
    sessions,
    openRoot,
    confirm: () => controller.requestTabSwitchDecision(),
  };
}
test('retains historical observed local day and stable card identity while reusing the existing root', async () => {
  const input = fixture();
  const owner = input.sessions.getSnapshot().activeId;
  expect(await createDailyReminderConversation(input)(entry)).toBe('opened');
  expect(input.controller.getSnapshot().routes).toEqual([input.root]);
  expect(input.guard).toHaveBeenCalledTimes(1);
  const card = input.sessions.getSnapshot().sessions.find(s => s.id === owner)!
    .taskCards![0];
  expect(card.id).toBe(entry.entryKey);
  expect(card.task).toMatchObject({
    kind: 'daily_report',
    reminder: true,
    identity: { localDate: '2023-11-15', timeZone: 'Asia/Seoul' },
  });
  expect(input.sessions.getSnapshot().activeId).toBe(owner);
  input.controller.registerLeaveGuard(input.root.key, async () => true);
  expect(await createDailyReminderConversation(input)(entry)).toBe('opened');
  expect(
    input.sessions.getSnapshot().sessions.find(s => s.id === owner)!.taskCards,
  ).toHaveLength(1);
  input.sessions.dispose();
});
test('persist failure cannot navigate or consume the native target', async () => {
  const input = fixture();
  jest
    .spyOn(input.sessions, 'saveTaskCard')
    .mockRejectedValue(new Error('locked'));
  await expect(createDailyReminderConversation(input)(entry)).rejects.toThrow(
    'locked',
  );
  expect(input.openRoot).not.toHaveBeenCalled();
  expect(input.controller.getSnapshot().currentRoute).toEqual(input.child);
  input.sessions.dispose();
});
test('new navigation during persistence prevents stale root selection', async () => {
  const input = fixture();
  const save = input.sessions.saveTaskCard;
  jest
    .spyOn(input.sessions, 'saveTaskCard')
    .mockImplementation(async (...args) => {
      await save(...args);
      input.controller.push('health-records');
    });
  expect(await createDailyReminderConversation(input)(entry)).toBe('busy');
  expect(input.openRoot).not.toHaveBeenCalled();
  expect(input.controller.getSnapshot().currentRoute.name).toBe(
    'health-records',
  );
  input.sessions.dispose();
});
test('an explicitly selected historical identity is not replaced with delivered or current date', async () => {
  const input = fixture();
  expect(
    await createDailyReminderConversation(input)({
      ...entry,
      selectedRequest: {
        localDate: '2023-11-14',
        timeZone: 'America/New_York',
        requestedAt: '2023-11-14T12:00:00.000Z',
      },
    }),
  ).toBe('opened');
  expect(
    input.sessions.getSnapshot().sessions[0].taskCards![0].task,
  ).toMatchObject({
    identity: { localDate: '2023-11-14', timeZone: 'America/New_York' },
  });
  input.sessions.dispose();
});

test('retry after session switch keeps the original card owner rather than duplicating it', async () => {
  const input = fixture();
  const original = input.sessions.getSnapshot().activeId;
  const save = input.sessions.saveTaskCard;
  let switchOnce = true;
  jest
    .spyOn(input.sessions, 'saveTaskCard')
    .mockImplementation(async (...args) => {
      await save(...args);
      if (switchOnce) {
        switchOnce = false;
        input.sessions.create();
      }
    });
  const open = createDailyReminderConversation(input);
  expect(await open(entry)).toBe('busy');
  const next = input.sessions.getSnapshot().activeId;
  expect(next).not.toBe(original);
  expect(await open(entry)).toBe('opened');
  expect(input.sessions.getSnapshot().activeId).toBe(original);
  expect(
    input.sessions.getSnapshot().sessions.find(s => s.id === next)?.taskCards ??
      [],
  ).toHaveLength(0);
  expect(
    input.sessions.getSnapshot().sessions.find(s => s.id === original)
      ?.taskCards,
  ).toHaveLength(1);
  input.sessions.dispose();
});

test('a gate closed immediately after approval prevents card persistence', async () => {
  const input = fixture();
  let allowed = true;
  const save = jest.spyOn(input.sessions, 'saveTaskCard');
  expect(
    await createDailyReminderConversation({
      ...input,
      canEnter: () => allowed,
      confirm: async () => {
        const result = await input.confirm();
        allowed = false;
        return result;
      },
    })(entry),
  ).toBe('busy');
  expect(save).not.toHaveBeenCalled();
  expect(input.openRoot).not.toHaveBeenCalled();
  input.sessions.dispose();
});
