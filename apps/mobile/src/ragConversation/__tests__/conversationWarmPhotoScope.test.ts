import { conversationDispatch } from '../conversationDispatch';
import { createEmptyConversation } from '../conversationEmptySession';
import { allowWarmConversationSender } from '../warmConversationSender';
import type { ConversationPhotoState } from '../conversationPhotoTypes';
import type { WarmConversationPreparation } from '../conversationWarmAdmission';

type Input = Parameters<typeof conversationDispatch>[0];

test.each([false, true])(
  'late attachment enters strict preflight before any handoff (stopped=%s)',
  async stopped => {
    let session = { ...createEmptyConversation(1), draft: 'Synthetic' };
    let photo: ConversationPhotoState<never> = { status: 'empty' };
    let releaseLocal!: (value: WarmConversationPreparation) => void;
    let releaseStrict!: (value: boolean) => void;
    let reachedStrict!: () => void;
    const strictEntered = new Promise<void>(resolve => {
      reachedStrict = resolve;
    });
    const begin = new Promise<WarmConversationPreparation>(resolve => {
      releaseLocal = resolve;
    });
    const strict = new Promise<boolean>(resolve => {
      releaseStrict = resolve;
    });
    const beforeSend = jest.fn(
      (_id: number, _signal: AbortSignal, warm: boolean) => {
        if (warm) return begin;
        reachedStrict();
        return strict;
      },
    );
    const send = jest.fn(async () => {});
    const bind = jest.fn(
      (sender: Parameters<NonNullable<Input['bindSender']>>[0]) => sender,
    );
    const dispatcher = conversationDispatch({
      requests: { send } as unknown as Input['requests'],
      photoDrafts: { get: () => photo } as unknown as Input['photoDrafts'],
      retention: undefined,
      disposed: () => false,
      find: () => session,
      update: (_id, change) => {
        session = { ...session, ...change };
      },
      current: () => true,
      bindSender: bind,
      beforeSend,
    });
    const sender = allowWarmConversationSender(async () => ({
      status: 'insufficient',
    }));
    const work = dispatcher.send(1, sender);
    expect(beforeSend.mock.calls.map(call => call[2])).toEqual([true]);
    photo = { status: 'preparing' }; // A selected attachment arrived during the held local proof.
    releaseLocal({
      kind: 'warm-local',
      current: () => true,
      recheckOwner: async () => true,
    });
    await strictEntered;
    expect(send).not.toHaveBeenCalled(); // no request or photo consent opened during either preflight
    expect(beforeSend.mock.calls.map(call => call[2])).toEqual([true, false]);
    expect(beforeSend.mock.calls[0]?.[1]).toBe(beforeSend.mock.calls[1]?.[1]);
    if (stopped) dispatcher.cancelBeforeSend(1);
    releaseStrict(true);
    await work;
    if (stopped) expect(send).not.toHaveBeenCalled();
    else {
      expect(bind).toHaveBeenCalledWith(sender, undefined);
      expect(send).toHaveBeenCalledWith(1, sender, undefined, true, undefined);
    }
  },
);
