import { renderHook, waitFor } from '@testing-library/react-native';
import { useConversationVisibility } from '../../aiFeatures/integration/useConversationVisibility';
import { useDailyReminderPrompt } from '../useDailyReminderPrompt';
import type { AiFeatureServices } from '../../aiFeatures/integration/featureServices';
import {
  createDailyReminderDestination,
  type SavedDailyReminderEntry,
} from '../dailyReminderDestination';
import { mountDailyReminderConversationPrompt } from '../dailyReminderPromptRendezvous';
import { createDailyReminderConversation } from '../dailyReminderConversation';
import { parseDailyReminderEntry } from '../dailyReminderDelivery';
import { createNavigationController } from '../../navigation/navigationController';
import { createConversationSessions } from '../../ragConversation/conversationSessions';
import type { AppNavigationRoute } from '../../routes/appNavigationRoute';

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
test('synthetic fresh entry sends the existing report action once from the committed Conversation owner', async () => {
  const input = fixture();
  const activeId = input.sessions.getSnapshot().activeId;
  const sender = jest.fn().mockResolvedValue({ status: 'no_evidence' });
  const freshEntry = parseDailyReminderEntry({
    kind: 'daily_report',
    deliveryTimestamp: String(Math.floor(Date.now() / 1000)),
  })!;
  let saved: SavedDailyReminderEntry | null = null;
  const claimPrompt = jest.fn(async () => true);
  const open = createDailyReminderConversation({
    ...input,
    promptAllowed: () => true,
    capturePromptRoot: () => () => true,
    claimPrompt,
  });
  const destination = () =>
    createDailyReminderDestination({
      read: async () => saved,
      write: async value => {
        saved = value;
      },
      consumeOnOpened: true,
      open,
    });
  const inbox = destination();
  expect(await inbox.accept(freshEntry)).toBe('opened');
  expect(input.controller.getSnapshot().currentRoute).toEqual(input.root);
  expect(input.sessions.getSnapshot().activeId).toBe(activeId);
  expect(sender).not.toHaveBeenCalled();
  expect(saved).toMatchObject({ active: false });
  const mount = () =>
    mountDailyReminderConversationPrompt(
      input.sessions,
      input.root.key,
      () => input.controller.getSnapshot().currentRoute.key === input.root.key,
      () => sender,
    );
  mount()();
  await Promise.resolve();
  expect(sender).toHaveBeenCalledTimes(1);
  expect(sender.mock.calls[0]?.[4]).toMatchObject({
    intent: 'daily-report',
    reportRequest: expect.objectContaining({ kind: 'daily_report' }),
  });
  expect(
    input.sessions.getSnapshot().sessions[0]?.taskCards ?? [],
  ).toHaveLength(0);
  mount()();
  expect(await inbox.accept(freshEntry)).toBe('opened');
  expect(await destination().restore()).toBe('opened');
  expect(await destination().accept(freshEntry)).toBe('opened');
  expect(sender).toHaveBeenCalledTimes(1);
  expect(claimPrompt).toHaveBeenCalledTimes(1);
  input.sessions.dispose();
});

test.each(['visibility', 'owner', 'draft', 'receipt'] as const)(
  'a claim never dispatches through a changed %s after accepted entry',
  async changed => {
    const input = fixture();
    const sender = jest.fn().mockResolvedValue({ status: 'no_evidence' });
    let saved: SavedDailyReminderEntry | null = null;
    let revision = 0;
    const claimPrompt = jest.fn(async () => {
      if (changed === 'receipt') throw new Error('locked');
      return true;
    });
    const destination = createDailyReminderDestination({
      read: async () => saved,
      write: async value => {
        saved = value;
      },
      consumeOnOpened: true,
      open: createDailyReminderConversation({
        ...input,
        promptAllowed: () => true,
        claimPrompt,
        capturePromptRoot: () => {
          const captured = revision;
          return () => revision === captured;
        },
      }),
    });
    const entry = parseDailyReminderEntry({
      kind: 'daily_report',
      deliveryTimestamp: String(Math.floor(Date.now() / 1000)),
    })!;
    if (changed === 'receipt') {
      expect(await destination.accept(entry)).toBe('opened');
      expect(input.openRoot).toHaveBeenCalledTimes(1);
      expect(saved).toMatchObject({ active: false });
      expect(input.sessions.getSnapshot().sessions[0]?.taskCards).toEqual([
        expect.objectContaining({
          id: entry.entryKey,
          task: expect.objectContaining({
            kind: 'daily_report',
            reminder: true,
          }),
        }),
      ]);
      expect(await destination.accept(entry)).toBe('opened');
      expect(await destination.restore()).toBe('opened');
      expect(claimPrompt).toHaveBeenCalledTimes(1);
      expect(input.openRoot).toHaveBeenCalledTimes(1);
    } else {
      expect(await destination.accept(entry)).toBe('opened');
      if (changed === 'visibility') revision += 2;
      if (changed === 'owner') input.sessions.create();
      if (changed === 'draft')
        input.sessions.setDraft(
          input.sessions.getSnapshot().activeId,
          'preserve',
        );
    }
    const unmount = mountDailyReminderConversationPrompt(
      input.sessions,
      input.root.key,
      () => true,
      () => sender,
    );
    await Promise.resolve();
    expect(sender).not.toHaveBeenCalled();
    if (changed === 'draft')
      expect(input.sessions.getSnapshot().sessions[0]?.draft).toBe('preserve');
    unmount();
    input.sessions.dispose();
  },
);

test('normal launch and persisted same-day restoration never start the prompt', async () => {
  const input = fixture();
  const sender = jest.fn();
  const entry = parseDailyReminderEntry({
    kind: 'daily_report',
    deliveryTimestamp: String(Math.floor(Date.now() / 1000)),
  })!;
  let saved: SavedDailyReminderEntry = { entry, active: true };
  const claimPrompt = jest.fn(async () => true);
  const inbox = createDailyReminderDestination({
    read: async () => saved,
    write: async value => {
      saved = value;
    },
    consumeOnOpened: true,
    open: createDailyReminderConversation({
      ...input,
      promptAllowed: () => true,
      capturePromptRoot: () => () => true,
      claimPrompt,
    }),
  });
  const unmount = mountDailyReminderConversationPrompt(
    input.sessions,
    input.root.key,
    () => true,
    () => sender,
  );
  expect(sender).not.toHaveBeenCalled();
  expect(await inbox.restore()).toBe('opened');
  expect(await inbox.accept(entry)).toBe('opened');
  expect(claimPrompt).not.toHaveBeenCalled();
  expect(sender).not.toHaveBeenCalled();
  unmount();
  input.sessions.dispose();
});

test('the canonical receiver waits behind the same in-app provider overlay as the manual action', async () => {
  const fixed = fixture();
  const sender = jest.fn().mockResolvedValue({ status: 'no_evidence' });
  const services = {
    sendRagMessage: sender,
    dailyReport: {} as NonNullable<AiFeatureServices['dailyReport']>,
  };
  let saved: SavedDailyReminderEntry | null = null;
  const inbox = createDailyReminderDestination({
    read: async () => saved,
    write: async value => {
      saved = value;
    },
    consumeOnOpened: true,
    open: createDailyReminderConversation({
      ...fixed,
      promptAllowed: () => true,
      capturePromptRoot: () => () => true,
      claimPrompt: async () => true,
    }),
  });
  const view = await renderHook(
    (hidden: boolean) => {
      const isVisible = useConversationVisibility(() => true, false, hidden);
      return useDailyReminderPrompt({
        canonical: true,
        rootKey: fixed.root.key,
        store: fixed.sessions,
        isVisible,
        services,
      });
    },
    { initialProps: true },
  );
  expect(
    await inbox.accept(
      parseDailyReminderEntry({
        kind: 'daily_report',
        deliveryTimestamp: String(Math.floor(Date.now() / 1000)),
      })!,
    ),
  ).toBe('opened');
  expect(sender).not.toHaveBeenCalled();
  await view.rerender(false);
  await waitFor(() => expect(sender).toHaveBeenCalledTimes(1));
  await view.rerender(false);
  expect(sender).toHaveBeenCalledTimes(1);
  await view.unmount();
  fixed.sessions.dispose();
});
