import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  join,
  mkdtempSync,
  rmSync,
  tmpdir,
} from '../../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { SqlCipherAgentMemoryStorage } from '../../../storage/agentMemoryStorage';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { restoreConversationArtifact } from '../restoreConversationArtifact';
import { fingerprint } from '../evidenceUtils';
import { localData, memoryRecord } from '../featureServiceFixtures';
import { reference } from '../../../diseaseHypotheses/taskTestSupport';

test('reopens a saved conversation with fresh source aliases and rejects it after source deletion', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-conversation-restore-'));
  const path = join(directory, 'records.sqlite');
  let connection = openSqliteTestDatabase(path);
  try {
    await runMigrations(connection.database);
    const record = memoryRecord(1);
    await new SqlCipherAgentMemoryStorage(connection.database).append(record);
    let storage = createConversationArtifactStorage(connection.database);
    await storage.createSession('session', await storage.currentGeneration());
    const original = {
      ...reference,
      sourceKind: 'reviewed_memory' as const,
      sourceId: record.id,
      evidenceId: record.id,
      privateExtra: 'synthetic secret',
    };
    await storage.append({
      id: 'turn',
      sessionId: 'session',
      createdAt: '2026-10-05T00:00:00.000Z',
      providerId: 'provider',
      modelId: 'model',
      status: 'complete',
      question: 'question',
      answer: 'answer',
      citations: [original],
      sources: [
        {
          reference: original,
          records: [
            {
              kind: 'reviewed_memory',
              id: record.id,
              revision: fingerprint({ text: record.text, meta: record.meta }),
            },
          ],
        },
      ],
    });
    connection.close();
    connection = openSqliteTestDatabase(path);
    storage = createConversationArtifactStorage(connection.database);
    const registry = new LocalEvidenceReferenceRegistry();
    const data = localData([record]).data;
    const restored = await restoreConversationArtifact({
      id: 'turn',
      storage,
      registry,
      data,
      signal: new AbortController().signal,
    });
    expect(restored?.answer).toBe('answer');
    const citation = restored!.citations[0]!;
    expect(citation.evidenceId).not.toBe(record.id);
    expect(JSON.stringify(citation)).not.toContain('synthetic secret');
    expect(JSON.stringify(registry.resolve(citation))).not.toContain(
      'synthetic secret',
    );
    expect(
      (await registry.readSource(citation, new AbortController().signal))
        .status,
    ).toBe('available');
    await connection.database.execute(
      'INSERT INTO agent_memory_removed_sources (source_id) VALUES (?)',
      [record.id],
    );
    const stillPresent = await connection.database.execute(
      'SELECT id FROM agent_memory_records WHERE id = ?',
      [record.id],
    );
    expect(stillPresent.rows).toHaveLength(1);
    expect(
      (await registry.readSource(citation, new AbortController().signal))
        .status,
    ).not.toBe('available');
    expect(
      await registry.revalidateEvidence(
        [citation],
        new AbortController().signal,
      ),
    ).toBe(false);
    expect(
      await restoreConversationArtifact({
        id: 'turn',
        storage,
        registry: new LocalEvidenceReferenceRegistry(),
        data,
        signal: new AbortController().signal,
      }),
    ).toBeNull();
  } finally {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
