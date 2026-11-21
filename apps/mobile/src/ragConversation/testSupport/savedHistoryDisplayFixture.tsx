import { useSyncExternalStore } from 'react';
import { runMigrations, type SqlDatabase } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { conversationSavedHistoryDisplayOption } from '../../aiFeatures/integration/conversationSavedHistoryDisplayOption';
import { ConversationHistory } from '../ConversationHistory';
import { conversationHistoryRecoveryProps } from '../conversationHistoryRecoveryProps';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import type { ConversationSessions } from '../conversationSessions';

export const sessionId = 'saved';
export const at = (index: number) =>
  new Date(Date.UTC(2026, 10, 2, 0, index)).toISOString();

export async function fixture(
  count: number,
  beforeFreeze?: (
    storage: ReturnType<typeof createConversationArtifactStorage>,
  ) => Promise<void>,
) {
  const f = openSqliteTestDatabase(':memory:');
  await runMigrations(f.database);
  let check = false;
  const forbidden = jest.fn();
  const query = (sql: string) => {
    if (
      !check ||
      sql.includes('WITH RECURSIVE ownership(root, artifact_id)') ||
      !/\b(?:health_observations|source_records|health_context_generation|symptom_summary_runs|research_artifacts|conversation_request_previews)\b|WITH RECURSIVE/i.test(
        sql,
      )
    )
      return;
    forbidden();
    throw new Error('Display SQL touched source material.');
  };
  const protectedDb: SqlDatabase = {
    execute(sql, bindings) {
      query(sql);
      return f.database.execute(sql, bindings);
    },
    transaction(work) {
      return f.database.transaction(tx =>
        work({
          ...tx,
          execute(sql, bindings) {
            query(sql);
            return tx.execute(sql, bindings);
          },
        }),
      );
    },
  };
  const storage = createConversationArtifactStorage(protectedDb);
  await storage.createSession(sessionId, await storage.currentGeneration());
  for (let index = 0; index < count; index++) {
    const id = `turn-${index}`;
    const question = `Synthetic saved question ${index}`;
    const createdAt = at(index);
    await storage.startRequest({
      id,
      question,
      createdAt,
      sessionId,
      sessionVersion: 0,
    });
    await storage.append({
      id,
      question,
      createdAt,
      sessionId,
      answer: `Synthetic saved answer ${index}`,
      status: 'complete',
      providerId: 'synthetic',
      modelId: 'synthetic',
      sources: [],
      citations: [],
    });
  }
  await beforeFreeze?.(storage);
  check = true;
  const strict = jest.fn(async () => {
    throw new Error('Display entered strict restore');
  });
  const reader = conversationSavedHistoryDisplayOption(async () => storage);
  const retention = createConversationSessionRetention({
    openStorage: async () => storage,
    createId: () => 'synthetic-live',
    now: () => at(60),
  });
  return { f, storage, reader, retention, strict, forbidden };
}

export function Transcript({ store }: { store: ConversationSessions }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const session = snapshot.sessions.find(row => row.id === snapshot.activeId)!;
  return (
    <ConversationHistory
      {...conversationHistoryRecoveryProps(session, store)}
      messages={session.messages}
      sessionId={session.id}
      pendingMessage={null}
      error={session.error}
      onOpenSource={jest.fn()}
      onLinkError={jest.fn()}
    />
  );
}
