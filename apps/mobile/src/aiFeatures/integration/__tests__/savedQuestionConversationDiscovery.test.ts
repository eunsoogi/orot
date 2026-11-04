import { createLocalEvidenceData } from '../../../healthEvidence/localEvidenceData';
import { createLocalHealthEvidenceRepository } from '../../../healthEvidence/localEvidenceRepository';
import { visitHealthFixture } from '../../../agent/visitQuestions/testing/healthContextFixture';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  join,
  mkdtempSync,
  rmSync,
  tmpdir,
} from '../../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { createAiFeatureServices } from '../featureServices';
import {
  apple,
  consent,
  localData,
  selectionStore,
} from '../featureServiceFixtures';
import type { runRagConversationTurn } from '../../../ragConversation/service';
import type { EvidenceReference } from '@orot/agent-runtime';
import { referenceOnly } from '../../../diseaseHypotheses/resultValidation';
import { createRecordRepository } from '@orot/storage';

test('a reviewed visit question is searchable by a new conversation after database reopen', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-question-discovery-'));
  const path = join(directory, 'records.sqlite');
  const f = await visitHealthFixture('measurements', path);
  let originalOpen = true;
  try {
    await f.save();
    const question = (await f.records.list('visit_question'))[0]!;
    f.close();
    originalOpen = false;
    const reopened = openSqliteTestDatabase(path);
    try {
      const fixture = localData([]).data;
      const data = {
        ...fixture,
        ...createLocalEvidenceData(reopened.database),
        repository: createLocalHealthEvidenceRepository(reopened.database),
      };
      let citation: EvidenceReference | undefined;
      const runner = jest.fn(
        async (options: Parameters<typeof runRagConversationTurn>[0]) => {
          const tool = options.workflow.tools.find(
            item => item.id === 'local-personal-records',
          )!;
          const found = await tool.search({
            operationRunId: 'new-session',
            operationKey: 'search',
            input: { query: question.questionText },
            allowedScope: { sourceKinds: ['personal_record'] },
            resultLimit: 8,
            maxPayloadBytes: 64000,
            signal: new AbortController().signal,
          });
          if ('status' in found) throw new Error('Unexpected consent result');
          const match = found.items.find(item =>
            item.content.includes(question.questionText),
          );
          if (!match) throw new Error('The saved question was not discovered.');
          citation = referenceOnly(match);
          return {
            status: 'answer' as const,
            answer: 'Saved question found',
            citations: [],
          };
        },
      ) as unknown as typeof runRagConversationTurn;
      const services = createAiFeatureServices(consent, {
        selectedAi: {
          selectionStore: selectionStore({
            providerId: apple.provider.id,
            modelId: apple.modelId,
          }),
          loadAppleOption: async () => apple,
        },
        loadLocalData: async () => data,
        ragRunner: runner,
      });
      expect(
        await services.sendRagMessage('저장한 진료 질문을 찾아 주세요', []),
      ).toMatchObject({ status: 'answer' });
      expect(runner).toHaveBeenCalledTimes(1);
      expect(citation).toBeDefined();
      const source = await services.readSource(
        citation!,
        new AbortController().signal,
      );
      expect(source.status).toBe('available');
      expect(JSON.stringify(source)).toContain(question.questionText);
      await createRecordRepository(reopened.database).delete(
        'visit_question',
        question.id,
      );
      expect(
        (await services.readSource(citation!, new AbortController().signal))
          .status,
      ).not.toBe('available');
    } finally {
      reopened.close();
    }
  } finally {
    if (originalOpen) f.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
