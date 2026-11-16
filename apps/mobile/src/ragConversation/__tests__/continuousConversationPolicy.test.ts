import { setup } from '../testSupport/continuousSessionFixture';
test('same model stays in the same session; only changed model switches and preserves the old transcript', async () => {
  const f = await setup();
  try {
    await f.store.synchronizeModel();
    const first = f.store.getSnapshot().activeId;
    const sender = jest.fn(async () => ({
      status: 'answer' as const,
      answer: 'Synthetic answer',
      citations: [],
    }));
    f.store.setDraft(first, 'Synthetic question');
    await f.store.send(first, sender);
    const old = f.store
      .getSnapshot()
      .sessions.find(s => s.id === first)!.messages;
    await f.store.synchronizeModel(true);
    f.store.create();
    expect(f.store.getSnapshot().activeId).toBe(first);
    f.select('b');
    await f.store.synchronizeModel(true);
    expect(f.store.getSnapshot().activeId).not.toBe(first);
    expect(
      f.store.getSnapshot().sessions.find(s => s.id === first)!.messages,
    ).toEqual(old);
    expect(sender).toHaveBeenCalledTimes(1);
  } finally {
    f.store.dispose();
    f.close();
  }
});
test('selection failure keeps prior data and blocks ordinary and owned dispatch', async () => {
  const f = await setup();
  try {
    await f.store.synchronizeModel();
    const id = f.store.getSnapshot().activeId;
    const original = f.options.continuousSession;
    f.options.continuousSession = async () => {
      throw new Error('Synthetic unavailable');
    };
    const sender = jest.fn(async () => ({
      status: 'answer' as const,
      answer: 'Synthetic',
      citations: [],
    }));
    f.store.setDraft(id, 'Synthetic draft');
    await f.store.send(id, sender);
    const owned = f.store.sendOwnedPrompt(id, 'Synthetic voice', sender);
    expect((await owned.completion).status).toBe('failure');
    expect(sender).not.toHaveBeenCalled();
    expect(f.store.getSnapshot().activeId).toBe(id);
    expect(f.store.getSnapshot().sessions.find(s => s.id === id)!.draft).toBe(
      'Synthetic draft',
    );
    f.options.continuousSession = original;
    await f.store.synchronizeModel(true);
  } finally {
    f.store.dispose();
    f.close();
  }
});
test('clear during selection cancels late restoration without resurrecting prior sessions', async () => {
  const f = await setup();
  try {
    let release!: () => void;
    const original = f.options.continuousSession;
    f.options.continuousSession = async signal => {
      await new Promise<void>(resolve => {
        release = resolve;
      });
      return original(signal);
    };
    const pending = f.store.synchronizeModel();
    f.store.invalidateAll();
    release();
    await pending;
    expect(f.store.getSnapshot().sessions).toHaveLength(1);
    expect(
      f.store.toolSourceSessionId(f.store.getSnapshot().activeId),
    ).toBeNull();
  } finally {
    f.store.dispose();
    f.close();
  }
});

test('an old selection resolving after a new selection cannot replace the active model session', async () => {
  const f = await setup();
  try {
    const original = f.options.continuousSession;
    let release!: () => void;
    let calls = 0;
    f.options.continuousSession = async signal => {
      if (++calls === 1)
        await new Promise<void>(resolve => {
          release = resolve;
        });
      return original(signal);
    };
    const old = f.store.synchronizeModel();
    f.select('b');
    await f.store.synchronizeModel(true);
    const active = f.store.getSnapshot().activeId;
    release();
    await old;
    expect(f.store.getSnapshot().activeId).toBe(active);
    const rows = (
      await f.database.execute('SELECT model_id FROM conversation_active_model')
    ).rows;
    expect(rows).toEqual([{ model_id: 'b' }]);
  } finally {
    f.store.dispose();
    f.close();
  }
});

test('dispatch binds the verified model without reducing existing observer or consent scope', async () => {
  const f = await setup();
  try {
    await f.store.synchronizeModel();
    const id = f.store.getSnapshot().activeId;
    const sender = jest.fn(async (_q, _h, _signal, observer) => {
      expect(observer.expectedConversationModel).toEqual({
        providerId: 'synthetic',
        modelId: 'a',
      });
      expect(observer.retentionSession).toBeDefined();
      return { status: 'insufficient' as const };
    });
    await f.store.sendPrompt(id, 'Synthetic request', sender);
    expect(sender).toHaveBeenCalledTimes(1);
  } finally {
    f.store.dispose();
    f.close();
  }
});

test.each(['ordinary', 'owned'] as const)(
  'Stop during %s selection prevents a late request from starting',
  async mode => {
    const f = await setup();
    try {
      await f.store.synchronizeModel();
      const id = f.store.getSnapshot().activeId;
      const original = f.options.continuousSession;
      let release!: () => void;
      f.options.continuousSession = async signal => {
        await new Promise<void>(resolve => {
          release = resolve;
        });
        return original(signal);
      };
      const sender = jest.fn(async () => ({ status: 'insufficient' as const }));
      f.store.setDraft(id, 'Synthetic pending input');
      if (mode === 'ordinary') {
        const work = f.store.send(id, sender);
        f.store.cancel(id);
        release();
        await work;
      } else {
        const owned = f.store.sendOwnedPrompt(id, 'Synthetic voice', sender);
        expect(owned.cancel()).toBe(true);
        release();
        await owned.completion;
      }
      expect(sender).not.toHaveBeenCalled();
      expect(f.store.getSnapshot().sessions.find(s => s.id === id)!.draft).toBe(
        'Synthetic pending input',
      );
    } finally {
      f.store.dispose();
      f.close();
    }
  },
);
