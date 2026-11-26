import {
  providerSuccess,
  type LanguageModelRequest,
} from '@orot/model-runtime';
import { archivedConversationAnswerTarget } from '../../../ragConversation/archivedConversationAnswerTarget';
import { conversationExecutionNative } from '../../../ragConversation/conversationExecutionNative';
import type { ConversationSession } from '../../../ragConversation/conversationSessionTypes';
import { runRagConversationTurn } from '../../../ragConversation/service';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { apple, localData } from '../featureServiceFixtures';
import { createRagConversationService } from '../ragConversationService';
import { healthContextFixture } from '../testSupport/healthContextPersistenceFixture';

jest.mock('../../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: jest.fn(),
}));

const tool = 'remember-conversation-answer';
const providerId = 'chatgpt-plan:synthetic';
const modelId = apple.modelId;
const owner = { id: 'synthetic-archive-session', version: 0 };
const answer = 'Private synthetic answer shown only in the local preview.';
const currentQuestion =
  'Could you keep your previous reply available for later?';
const original = {
  id: 'synthetic-hidden-wire-artifact',
  sessionId: owner.id,
  sessionVersion: owner.version,
  question: 'Private synthetic archive question.',
  createdAt: '2026-11-25T00:00:01.000Z',
};
const current = {
  ...original,
  id: 'synthetic-active-request',
  question: currentQuestion,
  createdAt: '2026-11-25T00:00:02.000Z',
};
const archiveRow = {
  ...original,
  kind: 'answer' as const,
  answer,
};

test.each([
  'saved',
  'declined',
  'deleted source',
  'protected store unavailable',
  'route retired before dispatch',
] as const)(
  'ChatGPT ordinary composer uses a visible exact archive without a new egress: %s',
  async scenario => {
    const f = await healthContextFixture();
    try {
      const storage = createConversationArtifactStorage(f.database);
      await storage.createSession(owner.id, await storage.currentGeneration());
      const earlier = {
        ...original,
        id: 'earlier-normal-prompt',
        question: 'Earlier ordinary prompt.',
        createdAt: '2026-11-25T00:00:00.000Z',
      };
      for (const previous of [earlier, original]) {
        await storage.startRequest(previous);
        await storage.append({
          ...previous,
          providerId,
          modelId,
          status: 'complete',
          answer: previous === original ? answer : 'Earlier ordinary reply.',
          sources: previous === original ? f.saved.sources : [],
        });
      }
      await storage.startRequest(current);
      const snapshot = {
        messages: [],
        savedHistoryDisplay: [
          { row: archiveRow, questionId: -1, answerId: -2 },
        ],
      } as unknown as ConversationSession;
      let shown = true;
      const target = archivedConversationAnswerTarget({
        session: snapshot,
        find: () => snapshot,
        lease: () => owner,
        current: () => shown,
      });
      expect(target?.current()).toBe(true);
      const protectedReady = scenario !== 'protected store unavailable';
      jest.mocked(conversationExecutionNative).mockReturnValue({
        bridgeAvailable: true,
        currentPhase: () => 'active',
        begin: async () => false,
        end() {},
        isActive: async () => false,
        protectedDataAvailable: async () => protectedReady,
        subscribe: () => () => {},
      });
      const confirmHistorySave = jest.fn(async () => {
        if (scenario === 'deleted source')
          await f.repository.delete('health_observation', f.inside.id);
        return scenario !== 'declined';
      });
      const consent = {
        authorize: jest.fn(async () => {
          if (scenario === 'route retired before dispatch') shown = false;
          return 'authorized' as const;
        }),
      };
      const generate = jest.fn(async (request: LanguageModelRequest) => {
        const descriptor = request.tools?.find(value => value.name === tool);
        if (!protectedReady) {
          expect(descriptor).toBeUndefined();
          return providerSuccess({
            text: 'Ordinary reply without any write.',
            finishReason: 'complete' as const,
            toolCalls: [],
          });
        }
        expect(descriptor?.inputSchema).toEqual({
          type: 'object',
          properties: {
            target: { type: 'string', enum: ['previous_completed_answer'] },
          },
          required: ['target'],
          additionalProperties: false,
        });
        const serialized = JSON.stringify(request);
        for (const privateValue of [
          answer,
          original.id,
          original.question,
          owner.id,
          current.id,
        ])
          expect(serialized).not.toContain(privateValue);
        return providerSuccess({
          text: 'Untrusted claim that this memory has been saved.',
          finishReason: 'tool_calls' as const,
          toolCalls: [
            {
              id: 'proposal',
              name: tool,
              arguments: { target: 'previous_completed_answer' },
            },
          ],
        });
      });
      const search = jest.fn();
      const registry = new LocalEvidenceReferenceRegistry();
      const send = createRagConversationService({
        selectedAi: async () => ({
          status: 'ready',
          selection: { providerId, modelId },
          option: apple,
          provider: {
            ...apple.provider,
            id: providerId,
            generate,
            capabilities: {
              ...apple.provider.capabilities,
              streaming: false,
              toolCalling: true,
              structuredOutput: false,
            },
          },
          modelId,
          recipient: 'Synthetic selected ChatGPT',
          remoteProcessing: true,
        }),
        consent,
        queryConsent: consent,
        registry,
        loadLocalData: async () => ({
          ...localData([]).data,
          openConversationArtifactStorage: async () => storage,
        }),
        externalEvidence: { search },
        ragRunner: runRagConversationTurn,
      });
      const result = await send(
        currentQuestion,
        [],
        new AbortController().signal,
        {
          inputOrigin: 'composer',
          archivedAnswerMemoryTarget: target,
          retentionSession: owner,
          retentionRequestId: current.id,
          // Prior normal prompt and visible display-only archive stay separate.
          retainedHistory: [{ id: earlier.id, question: earlier.question }],
          suppressContextualOpening: true,
          confirmHistorySave,
          expectedConversationModel: { providerId, modelId },
          templateProposalOwner: {
            providerId,
            modelId,
            current: () => true,
            recheck: async () => true,
            watch: () => () => {},
          },
        },
        { intent: 'conversation', entryKey: 'ordinary' },
      );
      const saved = scenario === 'saved';
      expect(generate).toHaveBeenCalledTimes(
        scenario === 'route retired before dispatch' ? 0 : 1,
      );
      expect(search).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toMatch(
        /Private synthetic answer|Untrusted claim/,
      );
      expect(await storage.listSavedConversationAnswers()).toEqual(
        saved ? [expect.objectContaining({ artifactId: original.id })] : [],
      );
      if (saved) {
        expect(result).toMatchObject({
          status: 'answer',
          committedAnswerMemory: true,
        });
        expect(
          await storage.readSavedConversationAnswer(original.id, () => true),
        ).toBe(answer);
      } else {
        expect(result).not.toHaveProperty('committedAnswerMemory');
        if (scenario === 'declined' || scenario === 'deleted source')
          expect(result).toMatchObject({
            status: 'failure',
            kind: 'answer_memory_not_saved',
          });
      }
      if (
        scenario === 'protected store unavailable' ||
        scenario === 'route retired before dispatch'
      )
        expect(confirmHistorySave).not.toHaveBeenCalled();
      else expect(confirmHistorySave).toHaveBeenCalledTimes(1);
    } finally {
      f.close();
    }
  },
);
