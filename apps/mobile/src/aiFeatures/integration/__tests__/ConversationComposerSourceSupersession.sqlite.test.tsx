import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { createHealthEvidenceTestDatabase } from '../../../healthEvidence/localEvidenceTestSupport';
import { createLocalEvidenceData } from '../../../healthEvidence/localEvidenceData';
import { createLocalHealthEvidenceRepository } from '../../../healthEvidence/localEvidenceRepository';
import {
  openLocalAgentMemoryDatabase,
  openLocalStorage,
} from '../../../storage/secureDatabase';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { ConversationScreen } from '../../../ragConversation/ConversationScreen';
import {
  ConversationSessionsProvider,
  useConversationSessions,
} from '../../../ragConversation/ConversationSessionsContext';
import type { ConversationSessions } from '../../../ragConversation/conversationSessions';
import { runRagConversationTurn } from '../../../ragConversation/service';
import { createRagConversationService } from '../ragConversationService';
import { createConversationSessionOptions } from '../conversationSessionOptions';
import { createConversationArtifactDiscovery } from '../conversationArtifactDiscovery';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { localData } from '../featureServiceFixtures';
import { createHeldLocalSynthesis } from '../testSupport/heldLocalSynthesis';

jest.mock('../../../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
  openLocalStorage: jest.fn(),
}));

const at = '2026-11-24T12:00:00.000Z';
const owner = 'synthetic-composer-owner';
const question = '손으로 기록한 curio 메모를 정리해줘';
const archived = '합성 이전 답변';
const opening = '요청하신 흐름을 살펴볼게요.';
const answer = '합성 최종 답변';
const earlier = {
  kind: 'note',
  title: 'curio reference',
  details: 'Synthetic admitted marker.',
  effectiveDate: { status: 'known', date: '2026-11-24' },
} as const;

test('rejects superseded local evidence after dispatch', async () => {
  const fixture = createHealthEvidenceTestDatabase();
  const { database } = fixture;
  const reduceMotion = jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(true);
  jest.mocked(openLocalAgentMemoryDatabase).mockResolvedValue(database);
  const { selected, provider, proof, generate, release } =
    createHeldLocalSynthesis(opening, answer);
  try {
    await runMigrations(database);
    // The graph must revalidate the original evidence against the same real
    // SQLite rows the composer read, not against permissive mock answers.
    jest.mocked(openLocalStorage).mockResolvedValue(
      createRecordRepository(database),
    );
    const storage = createConversationArtifactStorage(database);
    await storage.createSession(owner, await storage.currentGeneration());
    const base = {
      id: 'synthetic-prior',
      sessionId: owner,
      question: '합성 이전 질문',
      createdAt: at,
    };
    await storage.startRequest({ ...base, sessionVersion: 0 });
    await storage.append({
      ...base,
      answer: archived,
      status: 'complete',
      providerId: 'fixture',
      modelId: 'fixture',
      sources: [],
      citations: [],
    });
    const canonical = createLocalEvidenceData(database);
    const original = await canonical.manualHistory.create(earlier);
    const seeded = {
      ...localData([]).data,
      ...canonical,
      repository: createLocalHealthEvidenceRepository(database),
      openConversationArtifactStorage: async () => storage,
    };
    const loadLocalData = async () => ({
      ...seeded,
      conversationArtifactDiscovery: async (
        registry: LocalEvidenceReferenceRegistry,
      ) =>
        createConversationArtifactDiscovery({
          database,
          storage,
          registry,
          data: seeded,
        }),
    });
    const registry = new LocalEvidenceReferenceRegistry();
    const external = jest.fn(async () => {
      throw new Error('Unexpected external search');
    });
    const service = createRagConversationService({
      registry,
      loadLocalData,
      ragRunner: runRagConversationTurn,
      selectedAi: async () => ({
        ...selected,
        provider,
        option: { ...selected.option, provider },
      }),
      consent: { authorize: async () => 'authorized' },
      queryConsent: { authorize: async () => 'denied' },
      externalEvidence: { search: external },
    });
    const settled = jest.fn();
    const send = jest.fn(async (...args: Parameters<typeof service>) => {
      const outcome = await service(...args);
      settled(outcome);
      return outcome;
    });
    const options = createConversationSessionOptions({
      registry,
      loadLocalData,
    });
    let store!: ConversationSessions;
    function Scene() {
      store = useConversationSessions();
      return (
        <ConversationScreen
          onSend={send}
          onBack={jest.fn()}
          onOpenSource={jest.fn()}
        />
      );
    }
    const view = await render(
      <ConversationSessionsProvider options={options}>
        <Scene />
      </ConversationSessionsProvider>,
    );
    try {
      await act(async () => {
        store.select(await store.attachExisting(owner, 0, at));
      });
      expect(await screen.findByText(archived)).toBeTruthy();
      await fireEvent.changeText(
        screen.getByTestId('rag-conversation-input'),
        question,
      );
      await fireEvent(
        screen.getByTestId('rag-conversation-send'),
        'composerPress',
      );
      expect(send.mock.calls[0]?.[3]?.inputOrigin).toBe('composer');
      await waitFor(
        () =>
          expect(
            proof.mock.calls.length + settled.mock.calls.length,
          ).toBeGreaterThan(0),
        { timeout: 5_000 },
      );
      expect({
        outcomes: settled.mock.calls.map(([outcome]) => [
          outcome.status,
          outcome.kind,
        ]),
        invocations: generate.mock.calls.map(([request]) =>
          request.tools?.map(tool => tool.name),
        ),
        heldSyntheses: proof.mock.calls.length,
      }).toMatchObject({ outcomes: [], heldSyntheses: 1 });
      expect(JSON.stringify(proof.mock.calls[0]?.[0].messages)).toContain(
        earlier.details,
      );

      // Supersede only after the real result entered the held provider request.
      const dispatches = generate.mock.calls.length;
      await canonical.manualHistory.correct(original.id, {
        ...earlier,
        details: 'Synthetic successor marker.',
        correctionNote: 'Synthetic correction.',
      });
      expect(await canonical.manualHistory.getEvidence(original.id)).toBeNull();
      await act(async () => release());
      await waitFor(() =>
        expect(settled).toHaveBeenCalledWith(
          expect.objectContaining({
            status: 'failure',
            kind: 'stale_evidence',
          }),
        ),
      );
      expect(proof).toHaveBeenCalledTimes(1);
      expect(generate).toHaveBeenCalledTimes(dispatches);
      expect(external).not.toHaveBeenCalled();
      expect(screen.queryByText(answer)).toBeNull();
      expect(screen.getByText(archived)).toBeTruthy();
      const { rows } = await database.execute(
        'SELECT id FROM conversation_requests WHERE session_id = ? AND question = ?',
        [owner, question],
      );
      expect(rows).toHaveLength(1);
      const requestId = String(rows[0]?.id);
      expect(await storage.read(requestId)).toBeNull();
      const presentation = await storage.readSessionPresentationMany(owner, 0, [
        requestId,
      ]);
      expect(JSON.stringify(presentation)).not.toContain(answer);
    } finally {
      release();
      await view.unmount();
    }
  } finally {
    release();
    reduceMotion.mockRestore();
    jest.mocked(openLocalAgentMemoryDatabase).mockReset();
    jest.mocked(openLocalStorage).mockReset();
    fixture.close();
  }
}, 20_000);
