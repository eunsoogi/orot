import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { NativeModules } from 'react-native';
import { providerSuccess } from '@orot/model-runtime';
import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { ConversationScreen } from '../../../ragConversation/ConversationScreen';
import type { ConversationSender } from '../../../ragConversation/conversationSessionTypes';
import { ConversationSessionsProvider } from '../../../ragConversation/ConversationSessionsContext';
import { runRagConversationTurn } from '../../../ragConversation/service';
import { createRagConversationService } from '../ragConversationService';
import { createConversationSessionOptions } from '../conversationSessionOptions';
import { createConversationPhotoInputValidator } from '../conversationPhotoInputValidation';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { localData } from '../featureServiceFixtures';
import { publicEvidenceFixture } from '../testSupport/publicWebEvidenceTestSupport';

jest.mock('../../../medicalDocuments/medicalDocumentImportService', () => ({
  medicalDocumentImportService: {
    selectDocument: jest.fn().mockResolvedValue({
      id: '12345678-1234-4234-8234-123456789abc',
      displayName: 'synthetic.jpg',
      contentHash: `sha256:${'a'.repeat(64)}`,
      previewData: 'data:image/jpeg;base64,c3ludGhldGlj',
      sections: [
        {
          id: 'section',
          text: 'synthetic OCR',
          startOffset: 0,
          endOffset: 13,
        },
      ],
    }),
    discardDocument: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('../../../ragConversation/ConversationSavedRecaps', () => ({
  ConversationSavedRecaps: () => null,
}));

test('a selected photo is explicitly approved before provider dispatch and retained with its session', async () => {
  const db = openSqliteTestDatabase(':memory:');
  const previous = NativeModules.MedicalDocumentImportModule;
  NativeModules.MedicalDocumentImportModule = {
    ensureMedicalDocumentOriginal: jest.fn().mockResolvedValue(undefined),
  };
  const f = publicEvidenceFixture();
  const generate = jest.fn().mockResolvedValue(
    providerSuccess({
      text: JSON.stringify({
        type: 'result',
        value: {
          answerKind: 'grounded',
          answer: '사진에 합성 문구가 있어요.',
        },
        citations: ['e2'],
      }),
      toolCalls: [],
      finishReason: 'complete',
    }),
  );
  const provider = {
    ...f.selected.provider,
    searchPublicWeb: undefined,
    generate,
    capabilities: {
      ...f.selected.provider.capabilities,
      streaming: false,
      toolCalling: false,
      structuredOutput: false,
    },
  };
  const selected = {
    ...f.selected,
    provider,
    recipient: 'device',
    remoteProcessing: false,
  };
  try {
    await runMigrations(db.database);
    const storage = createConversationArtifactStorage(db.database);
    const data = {
      ...localData([]).data,
      openConversationArtifactStorage: async () => storage,
      validateConversationPhotoInput:
        createConversationPhotoInputValidator(storage),
    };
    const registry = new LocalEvidenceReferenceRegistry();
    const options = createConversationSessionOptions({
      loadLocalData: async () => data,
      selectedAi: async () => selected,
      registry,
    });
    const send = createRagConversationService({
      consent: f.consent,
      queryConsent: { authorize: async () => 'authorized' },
      externalEvidence: { search: jest.fn() },
      loadLocalData: async () => data,
      selectedAi: async () => selected,
      registry,
      ragRunner: runRagConversationTurn,
    });
    let preflightFails = true;
    const sendWithPreflightFailure: ConversationSender = (...args) => {
      if (preflightFails) {
        preflightFails = false;
        return Promise.reject(new Error('Synthetic pre-consent failure'));
      }
      return send(...args);
    };
    const view = await render(
      <ConversationSessionsProvider options={options}>
        <ConversationScreen
          onBack={() => {}}
          onOpenSource={() => {}}
          onSend={sendWithPreflightFailure}
        />
      </ConversationSessionsProvider>,
    );
    await fireEvent.press(screen.getByRole('button', { name: '사진 첨부' }));
    await waitFor(() =>
      expect(screen.getByTestId('conversation-photo-preview')).toBeTruthy(),
    );
    expect(generate).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('rag-conversation-send'));
    await waitFor(() =>
      expect(screen.getByTestId('conversation-photo-preview')).toBeTruthy(),
    );
    await waitFor(() =>
      expect(
        screen.getByTestId('rag-conversation-send').props.disabled,
      ).toBeFalsy(),
    );
    await fireEvent.press(screen.getByTestId('rag-conversation-send'));
    await waitFor(() => expect(screen.getByText('동의하고 계속')).toBeTruthy());
    expect(generate).not.toHaveBeenCalled();
    expect(
      screen.getByText(`모델: ${selected.modelId}\n처리 대상: device`),
    ).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: '취소' }));
    await waitFor(() =>
      expect(screen.getByTestId('conversation-photo-preview')).toBeTruthy(),
    );
    expect(generate).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('rag-conversation-send'));
    await waitFor(() => expect(screen.getByText('동의하고 계속')).toBeTruthy());
    await fireEvent.press(
      screen.getByRole('button', { name: '동의하고 계속' }),
    );
    await waitFor(() =>
      expect(screen.getByText(/사진에 합성 문구가 있어요/)).toBeTruthy(),
    );
    expect(generate).toHaveBeenCalledTimes(1);
    const sessions = await storage.listSessions();
    expect(sessions.items).toHaveLength(1);
    const page = await storage.list(sessions.items[0]!.id);
    const saved = await storage.read(page.items[0]!.id);
    expect(saved?.submittedInput?.question).toBe('');
    expect(saved?.sources).toEqual([
      expect.objectContaining({ kind: 'conversation_photo' }),
    ]);
    await view.unmount();
  } finally {
    NativeModules.MedicalDocumentImportModule = previous;
    db.close();
  }
});
