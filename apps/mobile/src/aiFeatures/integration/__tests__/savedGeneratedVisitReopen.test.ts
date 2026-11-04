import { createRecordRepository, runMigrations } from '@orot/storage';
import { VisitQuestionCreateSchema } from '@orot/domain';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { createConversationArtifactDiscovery } from '../conversationArtifactDiscovery';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { loadSavedVisitQuestionState } from '../savedVisitQuestions';
import { fingerprint } from '../evidenceUtils';
import { localData } from '../featureServiceFixtures';

declare const require: (specifier: string) => unknown;
const { mkdtempSync, rmSync } = require('node:fs') as {
  mkdtempSync(path: string): string;
  rmSync(path: string, options: { recursive: boolean; force: boolean }): void;
};
const { tmpdir } = require('node:os') as { tmpdir(): string };
const { join } = require('node:path') as { join(...paths: string[]): string };

test('restores a generated parent after closing and reopening the database', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-visit-generated-'));
  const path = join(directory, 'records.sqlite');
  let connection: ReturnType<typeof openSqliteTestDatabase> | null = null;
  try {
    connection = openSqliteTestDatabase(path);
    await runMigrations(connection.database);
    const conversations = createConversationArtifactStorage(
      connection.database,
    );
    await conversations.createSession(
      'session',
      await conversations.currentGeneration(),
    );
    const parent = {
      id: 'parent',
      sessionId: 'session',
      createdAt: '2026-10-05T00:00:00.000Z',
      providerId: 'provider',
      modelId: 'model',
      status: 'complete' as const,
      question: 'Synthetic question',
      answer: 'Synthetic answer',
      sources: [],
      citations: [],
    };
    await conversations.append(parent);
    await createRecordRepository(connection.database).put(
      'visit_question',
      VisitQuestionCreateSchema.parse({
        id: 'question',
        effectiveAt: '2026-11-01T00:00:00.000Z',
        recordedAt: '2026-10-07T00:00:00.000Z',
        ingestedAt: '2026-10-07T00:00:00.000Z',
        provenance: { origin: 'derived', sourceRecordIds: ['appointment'] },
        reviewState: {
          status: 'reviewed',
          reviewerId: 'local-user',
          reviewedAt: '2026-10-07T00:00:00.000Z',
        },
        questionText: '이전 결과를 확인할까요?',
        rationale: '이전 AI 결과를 확인해요.',
        priority: 'routine',
        evidenceSpanIds: [],
        appointmentId: 'appointment',
        position: 1,
        generatedArtifactSources: [
          {
            kind: 'generated_conversation',
            type: 'conversation_turn',
            id: parent.id,
            revision: fingerprint(parent),
          },
        ],
      }),
    );
    connection.close();
    connection = null;
    connection = openSqliteTestDatabase(path);
    await runMigrations(connection.database);
    const database = connection.database;
    const reopened = createConversationArtifactStorage(database);
    const registry = new LocalEvidenceReferenceRegistry();
    const data = Object.assign(localData([]).data, {
      conversationArtifactDiscovery: async (
        r: LocalEvidenceReferenceRegistry,
      ) =>
        createConversationArtifactDiscovery({
          database,
          storage: reopened,
          data,
          registry: r,
        }),
    });
    const result = await loadSavedVisitQuestionState({
      appointmentId: 'appointment',
      records: createRecordRepository(database),
      sourceReader: data.repository,
      registry,
      data,
    });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('Could not restore');
    const link = result.questions[0]!.generatedArtifactContext![0]!;
    expect(
      (await registry.readSource(link, new AbortController().signal)).status,
    ).toBe('available');
    await reopened.deleteSession('session');
    expect(
      await registry.revalidateEvidence([link], new AbortController().signal),
    ).toBe(false);
  } finally {
    connection?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
