import { createDailyReportIdentity } from '@orot/domain';
import { createConversationSessions } from '../../../ragConversation/conversationSessions';
import { createConversationSessionRetention } from '../../../ragConversation/conversationSessionRetention';
import type { ConversationSender } from '../../../ragConversation/conversationSessionTypes';
import { conversationHistoryPageOption } from '../conversationHistoryPageOption';
import { loadConversationHistory } from '../conversationHistorySources';
import { quarantinedHistoryFixture } from '../testSupport/quarantinedHistoryFixture';

test.each([
  'plain',
  'mixed',
  'mixed-lineage',
  'scroll',
  'hide',
  'lease',
  'model',
  'stop',
] as const)(
  'sender preserves exact prompt and only bypasses eligible older display pages: %s',
  async mode => {
    const f = await quarantinedHistoryFixture();
    const transact = f.database.transaction.bind(f.database);
    let tail: Promise<unknown> = Promise.resolve();
    f.database.transaction = operation => {
      const next = tail.then(() => transact(operation));
      tail = next.catch(() => undefined);
      return next;
    };
    const sessionId = 'plain-sender';
    const version = 0;
    const date = (minute: number) =>
      new Date(Date.UTC(2026, 9, 8, 0, minute)).toISOString();
    try {
      await f.storage.createSession(
        sessionId,
        await f.storage.currentGeneration(),
      );
      const cited =
        mode === 'mixed-lineage' ? await f.storage.read('older') : null;
      if (mode === 'mixed-lineage')
        expect(cited?.sources.length).toBeGreaterThan(0);
      for (let i = 0; i < 6; i++) {
        await f.storage.append({
          id: 'plain-' + i,
          sessionId,
          createdAt: date(i),
          providerId: 'synthetic',
          modelId: 'synthetic',
          status: 'complete',
          question: 'Synthetic question ' + i,
          answer: 'Synthetic answer ' + i,
          citations: i === 0 && cited ? cited.citations : [],
          sources: i === 0 && cited ? cited.sources : [],
        });
      }
      for (let i = 0; i < 9; i++) {
        await f.storage.writeTaskCard({
          id: 'task-' + i,
          sessionId,
          sessionVersion: version,
          createdAt: date(i + 30),
          expectedRevision: null,
          task: {
            kind: 'daily_report',
            identity: createDailyReportIdentity('2026-10-08', 'UTC'),
          },
        });
      }
      if (mode === 'mixed')
        await f.storage.writeTaskCard({
          id: 'older-task',
          sessionId,
          sessionVersion: version,
          createdAt: date(-1),
          expectedRevision: null,
          task: {
            kind: 'daily_report',
            identity: createDailyReportIdentity('2026-10-08', 'UTC'),
          },
        });
      const option = conversationHistoryPageOption(f.input, f.open);
      const run = async (plain: boolean) => {
        const read = jest.fn(option);
        const readPlainContextPage = jest.fn(f.storage.readPlainContextPage);
        let seq = 0;
        const retained = createConversationSessionRetention({
          openStorage: f.open,
          createId: () => 'local-send-' + String(plain) + '-' + ++seq,
          now: () => date(59),
        });
        let entered!: () => void;
        let release!: () => void;
        const reached = new Promise<void>(resolve => {
          entered = resolve;
        });
        const barrier = new Promise<void>(resolve => {
          release = resolve;
        });
        const overlap =
          mode !== 'plain' && mode !== 'mixed' && mode !== 'mixed-lineage';
        let activeSession = sessionId;
        let activeModel = 'synthetic';
        const store = createConversationSessions({
          retention: overlap
            ? {
                ...retained,
                async beginTurn(...args) {
                  const turn = await retained.beginTurn(...args);
                  entered();
                  await barrier;
                  return turn;
                },
              }
            : retained,
          restoreSession: async () => [],
          restoreSessionPage: read,
          ...(plain ? { readPlainContextPage } : {}),
          continuousSession: async () => ({
            id: activeSession,
            version,
            updatedAt: date(0),
            model: { providerId: 'synthetic', modelId: activeModel },
          }),
        });
        try {
          await store.synchronizeModel();
          const id = store.getSnapshot().activeId;
          const sender: ConversationSender = async (
            _question,
            messages,
            signal,
            observer,
          ) => {
            expect(observer?.expectedConversationModel).toEqual({
              providerId: 'synthetic',
              modelId: 'synthetic',
            });
            expect(observer?.retentionSession).toEqual({
              id: sessionId,
              version,
            });
            const selected = await loadConversationHistory({
              messages,
              retainedHistory: observer?.retainedHistory,
              session: observer?.retentionSession,
              data: await f.input.loadLocalData(),
              registry: f.input.registry,
              signal: signal!,
              recoverImplicitHistory: false,
            });
            actual.push({ prior: selected.priorTurns, messages });
            return { status: 'insufficient' };
          };
          const actual: unknown[] = [];
          const pending = store.sendPrompt(id, 'New synthetic request', sender);
          if (overlap) {
            const result = await Promise.race([
              reached.then(() => 'owned'),
              pending.then(() => 'passed-barrier'),
            ]);
            expect(result).toBe('owned');
            if (mode === 'scroll') await store.loadOlderHistory(id);
            if (mode === 'hide') await f.storage.hideSession(sessionId);
            if (mode === 'lease') {
              const key = await f.storage.hideSession(sessionId);
              expect(key).not.toBeNull();
              await f.storage.undoHiddenSession(sessionId, key!);
              expect(await f.storage.activeSessionVersion(sessionId)).not.toBe(
                version,
              );
            }
            if (mode === 'model') {
              activeSession = 'different-model';
              activeModel = 'other-synthetic';
              await f.storage.createSession(
                activeSession,
                await f.storage.currentGeneration(),
              );
              await store.synchronizeModel(true);
            }
            if (mode === 'stop') store.cancel(id);
          }
          release();
          await pending;
          expect(actual).toHaveLength(!overlap || mode === 'scroll' ? 1 : 0);
          if (!overlap || mode === 'scroll')
            expect(read).toHaveBeenCalledTimes(
              plain && mode === 'plain' ? 1 : 2,
            );
          expect(readPlainContextPage).toHaveBeenCalledTimes(plain ? 1 : 0);
          return actual;
        } finally {
          release();
          store.dispose();
        }
      };
      if (mode === 'hide' || mode === 'lease' || mode === 'model')
        await run(true);
      else expect(await run(true)).toEqual(await run(false));
    } finally {
      f.close();
    }
  },
);
