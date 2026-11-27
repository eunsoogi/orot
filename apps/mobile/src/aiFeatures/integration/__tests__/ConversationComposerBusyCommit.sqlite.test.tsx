import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { answerCommitContentionFixture } from '../testSupport/answerCommitContentionFixture';
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
const opening = '요청하신 흐름을 살펴볼게요.';
const answer = '합성 최종 답변';
const earlier = {
  kind: 'note',
  title: 'curio reference',
  details: 'Synthetic admitted marker.',
  effectiveDate: { status: 'known', date: '2026-11-24' },
} as const;

test.each([
  'release',
  'native-wrapper',
  'persistent',
  'revision',
  'stop',
] as const)(
  'recovers only exact owned transient BUSY: %s',
  async scenario => {
    const fixture = answerCommitContentionFixture({
      name: scenario,
      releaseAfter: scenario === 'persistent' ? 2 : 1,
      hostException: scenario === 'native-wrapper',
    });
    const { database } = fixture;
    const reduceMotion = jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(true);
    jest.mocked(openLocalAgentMemoryDatabase).mockResolvedValue(database);
    const { selected, provider, proof, generate, release } =
      createHeldLocalSynthesis(opening, answer);
    try {
      await runMigrations(database);
      jest
        .mocked(openLocalStorage)
        .mockResolvedValue(createRecordRepository(database));
      const actualStorage = createConversationArtifactStorage(database);
      let lockOnce = true;
      const storage = {
        ...actualStorage,
        append(
          value: Parameters<typeof actualStorage.append>[0],
          ...rest: [AbortSignal?, number?]
        ) {
          if (lockOnce && value.answer.includes(answer)) {
            lockOnce = false;
            fixture.holdReader();
          }
          return actualStorage.append(value, ...rest);
        },
      };
      await storage.createSession(owner, await storage.currentGeneration());
      const canonical = createLocalEvidenceData(database);
      const original = await canonical.manualHistory.create(earlier);
      if (scenario === 'revision')
        fixture.whenReleased(async () => {
          await canonical.manualHistory.correct(original.id, {
            ...earlier,
            details: 'Synthetic revised source.',
            correctionNote: 'Synthetic correction.',
          });
        });
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
        await fireEvent.changeText(
          screen.getByTestId('rag-conversation-input'),
          question,
        );
        await fireEvent(
          screen.getByTestId('rag-conversation-send'),
          'composerPress',
        );
        expect(send.mock.calls[0]?.[3]?.inputOrigin).toBe('composer');
        await waitFor(() => expect(proof).toHaveBeenCalledTimes(1));
        expect(JSON.stringify(proof.mock.calls[0]?.[0].messages)).toContain(
          earlier.details,
        );

        if (scenario === 'stop')
          fixture.whenReleased(() =>
            store.cancel(store.getSnapshot().activeId),
          );
        const dispatches = generate.mock.calls.length;
        await act(async () => release());
        await waitFor(() =>
          expect(
            store
              .getSnapshot()
              .sessions.find(
                session => session.id === store.getSnapshot().activeId,
              )?.busy,
          ).toBe(false),
        );
        if (scenario !== 'stop')
          expect(settled).toHaveBeenCalledWith(
            expect.objectContaining({
              status: 'answer',
              citations: [
                expect.objectContaining({ sourceKind: 'personal_record' }),
              ],
            }),
          );
        expect(fixture.busyCount()).toBe(scenario === 'persistent' ? 2 : 1);
        expect(fixture.callbackCount()).toBe(fixture.busyCount());
        const { rows } = await database.execute(
          'SELECT id FROM conversation_requests WHERE session_id = ? AND question = ?',
          [owner, question],
        );
        expect(rows).toHaveLength(1);
        const requestId = String(rows[0]?.id);
        const durable = await storage.readCommittedCompletion({
          requestId,
          messageId: requestId,
          sessionId: owner,
          sessionVersion: 0,
        });
        expect({
          durable,
          red: Boolean(screen.queryByText('답변을 저장하지 못했어요.')),
          retry: Boolean(screen.queryByText('답변 저장 다시 시도')),
        }).toEqual({
          durable:
            scenario === 'release' || scenario === 'native-wrapper'
              ? expect.stringContaining(answer)
              : null,
          red: scenario === 'persistent',
          retry: scenario === 'persistent',
        });
        if (scenario === 'revision')
          expect(
            screen.getByText('원본을 확인할 수 없어 답변을 저장하지 못했어요.'),
          ).toBeTruthy();
        expect(generate).toHaveBeenCalledTimes(dispatches);
        expect(external).not.toHaveBeenCalled();
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
  },
  20_000,
);
