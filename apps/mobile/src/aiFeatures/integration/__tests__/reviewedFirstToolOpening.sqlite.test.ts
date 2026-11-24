import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { standardSearchFixture } from '../../../../../../packages/agent-runtime/__tests__/multiAgent-standard-search-fixtures';
import {
  publication,
  scriptedOutputs,
} from '../../../../../../packages/agent-runtime/__tests__/multiAgent-external-evidence-fixtures';
import { runMultiAgentWorkflow } from '@orot/agent-runtime';
import { providerSuccess } from '@orot/model-runtime';
import {
  createRecordRepository,
  runMigrations,
  type SqlDatabase,
} from '@orot/storage';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { createConversationTurnRetention } from '../../../ragConversation/conversationTurnRetention';
import { createConversationTurnActivity } from '../../../ragConversation/conversationTurnActivity';
import { createEmptyConversation } from '../../../ragConversation/conversationEmptySession';
import type { ConversationSession } from '../../../ragConversation/conversationSessionTypes';
import { conversationRunInvocation } from '../conversationRunOptions';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { reportObservation } from '../testSupport/dailyReportFailureStageFixtures';

const sample = {
  id: 'fallback',
  owner: 'synthetic-owner',
  text: '말씀하신 내용을 살펴보고 답할게요.',
  at: '2026-11-23T08:00:00.000Z',
};

test.each([
  'ALLOW',
  'DENY',
  'stop',
  'stop-during-write',
  'write-failed',
] as const)(
  'first tool review only persists its exact positively reviewed live text: %s',
  async verdict => {
    const db = openSqliteTestDatabase(':memory:');
    try {
      await runMigrations(db.database);
      const records = createRecordRepository(db.database);
      await records.put('health_observation', reportObservation);
      const owner = new AbortController();
      let stagedWrites = 0;
      const protectedDb: SqlDatabase = {
        execute: db.database.execute,
        transaction: work =>
          db.database.transaction(tx =>
            work({
              ...tx,
              async execute(sql, bindings) {
                const result = await tx.execute(sql, bindings);
                if (sql.includes('SET reviewed_opening_json =')) {
                  stagedWrites += result.rowsAffected ?? 0;
                  if (verdict === 'stop-during-write') owner.abort();
                }
                return result;
              },
            }),
          ),
      };
      const storage = createConversationArtifactStorage(protectedDb);
      await storage.createSession(
        sample.owner,
        await storage.currentGeneration(),
      );
      if (verdict === 'write-failed')
        await db.database.execute(
          `CREATE TRIGGER fallback_fixture_write_failure BEFORE UPDATE OF reviewed_opening_json ON conversation_requests
        WHEN NEW.reviewed_opening_json IS NOT NULL BEGIN SELECT RAISE(ABORT, 'synthetic rejection'); END`,
        );
      const f = standardSearchFixture(true);
      const retained = createConversationTurnRetention({
        storage,
        sessionId: sample.owner,
        turnId: sample.id,
        createdAt: sample.at,
      });
      await retained.startRequest(f.options.request, owner.signal);
      let session: ConversationSession = {
        ...createEmptyConversation(1),
        pendingMessage: { id: 2, content: '', activity: '' },
      };
      const activity = createConversationTurnActivity({
        id: 1,
        responseId: 2,
        find: () => session,
        current: () => !owner.signal.aborted,
        update: (_id, update) => {
          session = { ...session, ...update };
        },
        retained,
      });
      f.provider.generate.mockImplementation(async request => {
        f.requests.push(request);
        const call = f.requests.length;
        if (call === 2 && verdict === 'stop') owner.abort();
        return providerSuccess({
          text:
            call === 1
              ? sample.text
              : call === 2
                ? verdict === 'DENY'
                  ? 'DENY'
                  : 'ALLOW'
                : scriptedOutputs()[2]!,
          toolCalls:
            call === 1
              ? [
                  {
                    id: 'first',
                    name: f.tool.id,
                    arguments: { query: 'synthetic' },
                  },
                ]
              : [],
          finishReason: call === 1 ? 'tool_calls' : 'complete',
        });
      });
      f.search.mockImplementation(async () => {
        const { rows } = await db.database.execute(
          'SELECT reviewed_opening_json FROM conversation_requests',
        );
        if (verdict === 'ALLOW') {
          expect(session.pendingMessage?.initialResponse).toMatchObject({
            text: sample.text,
          });
          expect(
            JSON.parse(String(rows[0]?.reviewed_opening_json)),
          ).toMatchObject({ text: sample.text });
        } else {
          expect(session.pendingMessage?.initialResponse).toBeUndefined();
          expect(rows[0]?.reviewed_opening_json).toBeNull();
        }
        return { status: 'available', publications: [publication] };
      });
      const invocation = conversationRunInvocation(
        activity.observer,
        false,
        new LocalEvidenceReferenceRegistry(),
        { providerId: f.provider.id, modelId: f.options.execution.modelId },
        { signal: owner.signal, settingsConsent: f.options.consent },
      );
      const result = await runMultiAgentWorkflow(
        {
          ...f.options,
          task: {
            ...f.options.task,
            initialToolResponse: text => text,
            reviewInitialToolResponse: true,
          },
        },
        { ...invocation, config: f.config },
      );
      const stopped = verdict === 'stop' || verdict === 'stop-during-write';
      expect(result.status).toBe(stopped ? 'cancelled' : 'result');
      expect(f.search).toHaveBeenCalledTimes(stopped ? 0 : 1);
      expect(stagedWrites).toBe(
        verdict === 'ALLOW' || verdict === 'stop-during-write' ? 1 : 0,
      );
      const reopened = createConversationArtifactStorage(db.database);
      await reopened.interruptRecoveredRequests();
      const restore = () =>
        reopened.readSessionPresentationMany(sample.owner, 0, [sample.id]);
      expect(await restore()).toMatchObject(
        verdict === 'ALLOW'
          ? [{ status: 'opening', initialResponse: { text: sample.text } }]
          : [{ status: 'interrupted' }],
      );
      if (verdict === 'ALLOW') {
        expect(
          await records.delete('health_observation', reportObservation.id),
        ).toBe(true);
        expect(await restore()).toMatchObject([{ status: 'interrupted' }]);
      }
    } finally {
      db.close();
    }
  },
);
