import { providerSuccess } from '@orot/model-runtime';
import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { createResearchArtifactStorage } from '../../../storage/researchArtifactStorage';
import { createPublicWebEvidence } from '../publicWebEvidence';
import { retainPublicWebResults } from '../researchRetention';
import { localData } from '../featureServiceFixtures';
import { publicEvidenceFixture } from '../testSupport/publicWebEvidenceTestSupport';

test('identical public tool call ids in separate conversations retain separate research results', async () => {
  const db = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(db.database);
    const conversations = createConversationArtifactStorage(db.database);
    const research = createResearchArtifactStorage(db.database);
    const data = {
      ...localData([]).data,
      openResearchArtifactStorage: async () => research,
    };
    for (const [index, sessionId] of ['first', 'second'].entries()) {
      await conversations.createSession(
        sessionId,
        await conversations.currentGeneration(),
      );
      const run = publicEvidenceFixture();
      run.search.mockResolvedValue(
        providerSuccess({
          text: 'Public answer',
          callCount: 1,
          citations: [{ title: 'Source', url: `https://example.org/${index}` }],
        }),
      );
      const tool = createPublicWebEvidence({
        ...run,
        now: () => '2026-11-06T00:00:00.000Z',
      })!;
      const result = await retainPublicWebResults(
        tool.tool,
        async () => data,
        'provider',
        'model',
        'record_conversation',
        { id: sessionId, version: 0 },
        async () => [],
      ).search(run.request);
      expect('status' in result).toBe(false);
    }
    const page = await research.search('', null, 10);
    expect(page.items).toHaveLength(2);
    expect(page.items.map(item => item.originSession).sort()).toEqual([
      'first',
      'second',
    ]);
  } finally {
    db.close();
  }
});
