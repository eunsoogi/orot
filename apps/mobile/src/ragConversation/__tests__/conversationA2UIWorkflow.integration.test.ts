import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import { createConversationRetentionBridge } from '../../aiFeatures/integration/conversationRetentionBridge';
import { LocalEvidenceReferenceRegistry } from '../../aiFeatures/integration/evidenceRegistry';
import { conversationSavedHistoryDisplayOption } from '../../aiFeatures/integration/conversationSavedHistoryDisplayOption';
import {
  prependSavedHistoryDisplay,
  savedHistoryTranscript,
} from '../conversationSavedHistoryDisplay';
import { createConversationSessions } from '../conversationSessions';
import { conversationA2UICatalog } from '../conversationA2UI';
import { runRagConversationTurn } from '../service';
import { fixture, response } from '../testSupport/conversationEnvelopeFixtures';
import { restoreConversationTask } from '../conversationTaskVersions';
import { ragConversationTask } from '../task';

const answer = '천만에요.\n\n편하게 말씀해 주세요.';
const emptyEvidence = { items: [], coverage: [], conflicts: [] };
const surface = (paragraphs: string[], surfaceId = 'orot:response:draft') =>
  JSON.stringify({
    version: '1.0',
    createSurface: {
      surfaceId,
      catalogId: conversationA2UICatalog,
      components: [
        {
          id: 'root',
          component: 'Column',
          children: paragraphs.map((_paragraph, i) => `p${i}`),
        },
        ...paragraphs.map((paragraph, i) => ({
          id: `p${i}`,
          component: 'Text',
          text: paragraph,
        })),
      ],
    },
  });

test.each([
  ['accepted exact display', surface(answer.split('\n\n')), true],
  [
    'injected prose',
    surface(['새 주장을 넣었습니다.', '편하게 말씀해 주세요.']),
    false,
  ],
  ['omitted paragraph', surface(['천만에요.']), false],
  ['foreign id', surface(answer.split('\n\n'), 'orot:other:message'), false],
  ['malformed JSON', '{', false],
])(
  'common workflow keeps the accepted answer and applies only %s',
  async (_name, a2ui, accepted) => {
    const model = fixture();
    model.generate.mockReset().mockResolvedValueOnce(
      response({
        type: 'result',
        value: { answerKind: 'conversation', answer, a2ui },
        citations: [],
      }),
    );
    const sessions = createConversationSessions();
    try {
      sessions.setDraft(1, '고마워요');
      await sessions.send(1, (question, previousMessages, signal) =>
        runRagConversationTurn(
          {
            ...model.options,
            question,
            previousMessages,
            loadCurrentEvidence: async () => ({
              batch: emptyEvidence,
              chunks: [],
            }),
          },
          { signal },
        ),
      );
      expect(model.generate).toHaveBeenCalledTimes(1);
      const message = sessions.getSnapshot().sessions[0]?.messages.at(-1);
      expect(message).toMatchObject({
        role: 'assistant',
        content: answer,
        citations: [],
      });
      if (accepted)
        expect(message?.a2uiPresentation).toMatchObject({
          component: 'Column',
          children: [{ text: '천만에요.' }, { text: '편하게 말씀해 주세요.' }],
        });
      else expect(message?.a2uiPresentation).toBeUndefined();
    } finally {
      sessions.dispose();
    }
  },
);

test('scopes frames to ordinary responses and preserves v19 and v20', () => {
  const input = {
    request: '고마워요',
    context: [] as [],
    evidence: emptyEvidence,
  };
  const v19 = restoreConversationTask({
    taskType: ragConversationTask.taskType,
    taskVersion: '19',
  });
  expect(v19?.createResultSchema?.(input).properties).not.toHaveProperty(
    'a2ui',
  );
  const v20 = restoreConversationTask({
    taskType: ragConversationTask.taskType,
    taskVersion: '20',
  });
  expect(v20?.createResultSchema?.(input).properties).toHaveProperty('a2ui');
  const ordinary = ragConversationTask.createResultSchema?.(input);
  expect(ordinary?.required).toContain('a2uiFrames');
  expect(ordinary?.properties).not.toHaveProperty('a2ui');
  expect(
    ragConversationTask.createResultSchema?.({
      ...input,
      context: { intent: 'possibilities' },
    }).properties,
  ).not.toHaveProperty('a2uiFrames');
});

test('an A2UI proposal cannot turn an unsupported clinical claim into an answer', async () => {
  const model = fixture();
  model.generate.mockReset().mockResolvedValueOnce(
    response({
      type: 'result',
      value: {
        answerKind: 'grounded',
        answer,
        a2ui: surface(answer.split('\n\n')),
      },
      citations: [],
    }),
  );
  const outcome = await runRagConversationTurn({
    ...model.options,
    question: '기록으로 무엇을 알 수 있나요?',
    previousMessages: [],
    loadCurrentEvidence: async () => ({ batch: emptyEvidence, chunks: [] }),
  });
  expect(outcome).not.toHaveProperty('a2uiPresentation');
  expect(outcome.status).not.toBe('answer');
});

test.each([
  [surface(answer.split('\n\n')), true],
  [surface(['Unverified injected content']), false],
])(
  'restores only the authorized completed read-only layout on actual local reload',
  async (a2ui, visible) => {
    const db = await healthContextFixture();
    const storage = createConversationArtifactStorage(db.database);
    let sequence = 0;
    const retention = createConversationSessionRetention({
      openStorage: async () => storage,
      createId: () => `a2ui-fixture-${++sequence}`,
      now: () => '2026-10-05T00:00:00.000Z',
    });
    const sessions = createConversationSessions({ retention });
    const model = fixture();
    model.generate.mockReset().mockResolvedValueOnce(
      response({
        type: 'result',
        value: { answerKind: 'conversation', answer, a2ui },
        citations: [],
      }),
    );
    try {
      sessions.setDraft(1, '고마워요');
      await sessions.send(
        1,
        async (question, previousMessages, signal, observer) => {
          const bridge = createConversationRetentionBridge({
            observer,
            registry: new LocalEvidenceReferenceRegistry(),
            question,
            providerId: 'sample',
            modelId: 'sample',
            signal: signal!,
          });
          const outcome = await runRagConversationTurn(
            {
              ...model.options,
              question,
              previousMessages,
              loadCurrentEvidence: async () => ({
                batch: emptyEvidence,
                chunks: [],
              }),
              onValidatedEvidence: bridge.onValidatedEvidence,
            },
            { signal },
          );
          return (await bridge.finish(outcome)).outcome;
        },
      );
      const live = sessions.getSnapshot().sessions[0]?.messages.at(-1);
      expect(live?.content).toBe(answer);
      expect(Boolean(live?.a2uiPresentation)).toBe(visible);
      const stored = await storage.read('a2ui-fixture-2');
      expect(stored).toMatchObject({ answer, status: 'complete' });
      expect(JSON.stringify(stored)).not.toMatch(
        /a2uiPresentation|createSurface|Unverified injected content/,
      );
      const load = conversationSavedHistoryDisplayOption(async () => storage);
      const page = await load(
        'a2ui-fixture-1',
        0,
        new AbortController().signal,
      );
      let id = 0;
      const restored = savedHistoryTranscript(
        prependSavedHistoryDisplay(page.rows, [], () => --id),
        [],
      );
      expect(restored.at(-1)).toMatchObject({
        role: 'assistant',
        content: answer,
        restoredHistory: true,
      });
      expect(restored.at(-1)).not.toHaveProperty('a2uiPresentation');
      const message = restored.at(-1)!;
      const layout = message.archivedA2UIPresentation;
      expect(Boolean(layout)).toBe(visible);
      if (layout) {
        expect(stored?.archivedA2UILayout).toEqual({
          version: 1,
          tree: ['Column', 0, 0],
        });
      }
      expect(JSON.stringify(stored?.archivedA2UILayout) ?? '').not.toContain(
        answer,
      );

      expect(model.generate).toHaveBeenCalledTimes(1);
    } finally {
      sessions.dispose();
      db.close();
    }
  },
);
