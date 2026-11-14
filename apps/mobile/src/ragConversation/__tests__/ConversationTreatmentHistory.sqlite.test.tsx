// Preserve legacy reopen safety/storage assertions without restoring the retired app UI.
jest.mock('../ConversationTaskPanels', () =>
  require('../testFixtures/LegacyTreatmentTaskPanels'),
);
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { useState } from 'react';
import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { t } from '../../i18n';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { openLocalAgentMemoryDatabase } from '../../storage/secureDatabase';
import type { TreatmentExplanationRequest } from '../../treatmentContext/interfaces';
import { produceTreatmentRequest } from '../../treatmentContext/treatmentRequestProducer';
import { ConversationHistoryScreen } from '../ConversationHistoryScreen';
import { ConversationScreen } from '../ConversationScreen';
import { ConversationSessionsProvider } from '../ConversationSessionsContext';
import { createConversationSessionRetention } from '../conversationSessionRetention';

jest.mock('../../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
}));

test('a saved treatment task is selected from restored history and reopened after explicit safety input', async () => {
  const { mkdtempSync, rmSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  const directory = mkdtempSync(join(tmpdir(), 'orot-treatment-history-'));
  const path = join(directory, 'database.sqlite');
  let connection = openSqliteTestDatabase(path);
  try {
    await runMigrations(connection.database);
    let storage = createConversationArtifactStorage(connection.database);
    await storage.createSession(
      'saved-session',
      await storage.currentGeneration(),
    );
    const request = {
      context: {
        version: 1,
        conditions: [],
        clinicianPlans: { status: 'unavailable' },
        publicEvidence: [],
        missingContext: [],
        conflicts: [],
      },
      sources: [],
      revalidateEvidence: async () => true,
    } as unknown as TreatmentExplanationRequest;
    expect(
      await produceTreatmentRequest(
        connection.database,
        { kind: 'request', selection: { kind: 'general_options' } },
        request,
        new AbortController().signal,
        [],
        {
          id: 'saved-treatment',
          sessionId: 'saved-session',
          createdAt: '2026-10-05T00:00:00.000Z',
          question: 'Synthetic',
          expectedSessionVersion: 0,
        },
      ),
    ).toMatchObject({ status: 'validated' });
    connection.close();
    connection = openSqliteTestDatabase(path);
    storage = createConversationArtifactStorage(connection.database);
    jest
      .mocked(openLocalAgentMemoryDatabase)
      .mockResolvedValue(connection.database);
    const retention = createConversationSessionRetention({
      openStorage: async () => storage,
      createId: () => 'unused',
      now: () => new Date().toISOString(),
    });
    const onSend = jest.fn();
    function Journey() {
      const [history, setHistory] = useState(true);
      return history ? (
        <ConversationHistoryScreen onBack={() => setHistory(false)} />
      ) : (
        <ConversationScreen
          onBack={jest.fn()}
          onOpenSource={jest.fn()}
          onSend={onSend}
        />
      );
    }
    await render(
      <ConversationSessionsProvider
        options={{
          retention,
          listSessions: cursor => storage.listSessions(cursor),
          restoreSession: async () => [],
          restoreTasks: async id =>
            storage.readTaskCards(
              id,
              (await storage.activeSessionVersion(id))!,
            ),
        }}
      >
        <Journey />
      </ConversationSessionsProvider>,
    );
    await waitFor(() =>
      expect(
        screen.getByTestId('conversation-history-list').props.rows,
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ title: t('treatmentSafety.saved') }),
        ]),
      ),
    );
    const row = screen
      .getByTestId('conversation-history-list')
      .props.rows.find(
        (value: { title: string }) =>
          value.title === t('treatmentSafety.saved'),
      );
    await fireEvent(
      screen.getByTestId('conversation-history-list'),
      'selectSession',
      { nativeEvent: { id: row.id } },
    );
    await fireEvent.press(
      await screen.findByRole('button', { name: /^저장한 치료 설명 ·/ }),
    );
    expect(screen.queryByText(t('treatmentSafety.generalOptions'))).toBeNull();
    await fireEvent.press(
      screen.getByRole('button', { name: t('treatmentSafety.adult') }),
    );
    await fireEvent.changeText(
      screen.getByLabelText(t('treatmentSafety.systolic')),
      '120',
    );
    await fireEvent.changeText(
      screen.getByLabelText(t('treatmentSafety.diastolic')),
      '80',
    );
    await fireEvent.press(
      screen.getByRole('button', { name: t('treatmentSafety.none') }),
    );
    await fireEvent.press(
      screen.getByRole('button', { name: t('treatmentSafety.confirm') }),
    );
    expect(
      await screen.findByText(t('treatmentSafety.generalOptions')),
    ).toBeTruthy();
    expect(onSend).not.toHaveBeenCalled();
  } finally {
    connection.close();
    jest.mocked(openLocalAgentMemoryDatabase).mockReset();
    rmSync(directory, { recursive: true, force: true });
  }
});
