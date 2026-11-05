import { act, render, screen } from '@testing-library/react-native';
import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { ConversationScreen } from '../ConversationScreen';
import {
  ConversationSessionsProvider,
  useConversationSessions,
} from '../ConversationSessionsContext';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import type { ConversationSessions } from '../conversationSessions';

jest.mock('../manualVisitRecordService', () => ({
  openManualVisitRecords: async () => ({
    load: async () => [
      {
        question: { id: 'q-1', questionText: '저장된 질문' },
        revision: 'v1:1',
        records: [
          {
            id: 'r-1',
            revision: 1,
            sourceMethod: 'manual_confirmed',
            editOrigin: 'manual_confirmation',
            answer: '저장된 답변',
          },
        ],
      },
    ],
  }),
}));

test('restores the selected visit and its official answer when reopening a saved conversation', async () => {
  const f = await healthContextFixture();
  try {
    const storage = createConversationArtifactStorage(f.database);
    await storage.createSession('saved', await storage.currentGeneration());
    await storage.append({
      id: 'turn',
      sessionId: 'saved',
      createdAt: '2026-10-05T00:00:00.000Z',
      providerId: 'provider',
      modelId: 'model',
      status: 'complete',
      question: '진료 질문',
      answer: '응답',
      sources: f.saved.sources,
      citations: [f.saved.sources[0]!.reference],
    });
    const makeOptions = () => ({
      retention: createConversationSessionRetention({
        openStorage: async () => storage,
        createId: () => 'new-turn',
        now: () => '2026-10-05T00:00:00.000Z',
      }),
      restoreSession: async (id: string) =>
        Promise.all(
          (await storage.list(id)).items.map(async item => {
            const saved = (await storage.read(item.id))!;
            return {
              question: saved.question,
              answer: saved.answer,
              citations: saved.citations ?? [],
            };
          }),
        ),
    });
    let current!: ConversationSessions;
    function Capture() {
      current = useConversationSessions();
      return null;
    }
    const first = await render(
      <ConversationSessionsProvider options={makeOptions()}>
        <Capture />
        <ConversationScreen
          entryContext={{
            intent: 'visit-questions',
            entryKey: 'visit-entry',
            appointmentId: 'visit-1',
          }}
          onBack={jest.fn()}
          onOpenSource={jest.fn()}
          onSend={jest.fn()}
        />
      </ConversationSessionsProvider>,
    );
    await screen.findByText('저장된 답변');
    first.unmount();
    await render(
      <ConversationSessionsProvider options={makeOptions()}>
        <Capture />
        <ConversationScreen
          onBack={jest.fn()}
          onOpenSource={jest.fn()}
          onSend={jest.fn()}
        />
      </ConversationSessionsProvider>,
    );
    await act(async () => {
      await current.attachExisting('saved', 0, '2026-10-05T00:00:00.000Z');
    });
    expect(screen.getByText('저장된 답변')).toBeTruthy();
  } finally {
    f.close();
  }
});
