import { runMigrations } from '@orot/storage';
import { createChatGPTPlanProvider } from '@orot/provider-openai';
import { FakeBridge } from '../../../../../../packages/provider-openai/__tests__/providerTestSupport';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { createRagConversationService } from '../ragConversationService';
import { runRagConversationTurn } from '../../../ragConversation/service';
import { publicEvidenceFixture } from '../testSupport/publicWebEvidenceTestSupport';
import { localData } from '../featureServiceFixtures';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';

// The native transport emits scripted packets only. JS provider mapping, consent,
// durable graph, evidence validation and protected SQLite storage are production code.
test.each(['complete', 'denied', 'invalid-citation'] as const)(
  'runs the possibility request across the native contract (%s)',
  async mode => {
    const opened = openSqliteTestDatabase(':memory:');
    try {
      await runMigrations(opened.database);
      const artifacts = createConversationArtifactStorage(opened.database);
      await artifacts.createSession(
        'session',
        await artifacts.currentGeneration(),
      );
      const createdAt = '2026-11-17T00:00:00.000Z';
      const question = '가능성과 부족한 정보를 정리해 주세요.';
      await artifacts.startRequest({
        id: 'request',
        sessionId: 'session',
        sessionVersion: 0,
        question,
        createdAt,
      });
      let sequence = 0;
      const evidenceCounts: number[] = [];
      const bridge = new FakeBridge(async (id, target) => {
        target.emit({
          requestId: id,
          type: 'response_started',
          responseId: `response-${id}`,
        });
        const call = target.started.length;
        let text = call === 1 ? '요청하신 내용을 살펴볼게요.' : 'ALLOW';
        if (call > 2) {
          const evidence = target.started
            .at(-1)!
            .request.messages.flatMap(message => {
              if (!('role' in message) || message.role !== 'user') return [];
              try {
                const value = JSON.parse(message.content);
                return Array.isArray(value.evidence) ? value.evidence : [];
              } catch {
                return [];
              }
            });
          evidenceCounts.push(evidence.length);
          text = JSON.stringify({
            type: 'result',
            value: {
              answerKind: mode === 'denied' ? 'conversation' : 'grounded',
              answer:
                mode === 'denied'
                  ? '어떤 점이 궁금하신지 알려주시겠어요?'
                  : '합성 공개 자료는 추가 확인이 필요하다고 설명해요. 개인의 진단은 정할 수 없어요.',
            },
            citations:
              mode === 'invalid-citation'
                ? ['unknown']
                : evidence.map(item => item.evidenceId),
          });
        }
        target.emit({ requestId: id, type: 'text_delta', text });
        target.emit({ requestId: id, type: 'completed', text });
      });
      const search = jest.fn(async (id: string) => {
        bridge.emit({
          requestId: id,
          type: 'response_started',
          responseId: 'web-response',
        });
        const text = 'Synthetic public source: further assessment is needed.';
        bridge.emit({ requestId: id, type: 'text_delta', text });
        bridge.emit({
          requestId: id,
          type: 'completed',
          text,
          webSearch: {
            callCount: 1,
            citations: [
              {
                title: 'Synthetic public source',
                url: 'https://example.org/source',
              },
            ],
          },
        });
      });
      const provider = createChatGPTPlanProvider({
        bridge: Object.assign(bridge, { startPublicWebSearch: search }),
        issuedClientID: 'synthetic-account',
        model: { slug: 'gpt-6-luna', displayName: 'Synthetic' },
        requestIDFactory: () => `request-${++sequence}`,
      });
      const f = publicEvidenceFixture();
      const selected = {
        ...f.selected,
        provider,
        selection: { providerId: provider.id, modelId: 'gpt-6-luna' },
      };
      f.authorize.mockImplementation(async request =>
        mode === 'denied' &&
        request.consentScope?.purpose === 'public_web_search'
          ? 'renewal_required'
          : 'authorized',
      );
      const data = localData([]).data;
      data.openConversationArtifactStorage = async () => artifacts;
      const send = createRagConversationService({
        selectedAi: async () => selected,
        consent: f.consent,
        queryConsent: { authorize: async () => 'authorized' },
        externalEvidence: {
          search: async () => ({ status: 'empty' as const }),
        },
        loadLocalData: async () => data,
        registry: new LocalEvidenceReferenceRegistry(),
        ragRunner: runRagConversationTurn,
      });
      const events: unknown[] = [];
      const failure = jest.fn();
      const result = await send(
        question,
        [],
        new AbortController().signal,
        {
          retentionRequestId: 'request',
          retentionSession: { id: 'session', version: 0 },
          openWorkflowContinuation: (owner, reconstruct) =>
            artifacts.openWorkflowContinuation(owner, reconstruct),
          onWorkflowPauseController: () => {},
          onWorkflowPaused: async () => false,
          onTaskStreamEvent: event => events.push(event),
          onRetentionFailure: failure,
          onRetentionCandidate: async (candidate, signal) =>
            artifacts.append(
              {
                ...candidate,
                id: 'request',
                sessionId: 'session',
                createdAt,
                status: candidate.status ?? 'complete',
              },
              signal,
            ),
        },
        { intent: 'possibilities', entryKey: 'synthetic' },
      );
      expect(events).toContainEqual(
        expect.objectContaining({ type: 'initial_response' }),
      );
      if (mode === 'complete') {
        expect(result.status).toBe('answer');
        expect(failure).not.toHaveBeenCalled();
        expect(await artifacts.read('request')).toMatchObject({
          entryIntent: 'possibilities',
          answer: expect.stringContaining('합성 공개 자료'),
          citations: [
            expect.objectContaining({ sourceKind: 'external_medical' }),
          ],
        });
      } else if (mode === 'denied') {
        expect(result).toMatchObject({ status: 'answer', citations: [] });
        expect(await artifacts.read('request')).toMatchObject({
          citations: [],
        });
      } else {
        expect(result).toMatchObject({
          status: 'failure',
          kind: 'validation_failed',
        });
        expect(await artifacts.read('request')).toBeNull();
      }
      expect(bridge.started).toHaveLength(3);
      expect(evidenceCounts).toEqual(mode === 'denied' ? [0] : [1]);
      expect(search).toHaveBeenCalledTimes(mode === 'denied' ? 0 : 1);
    } finally {
      opened.close();
    }
  },
);
