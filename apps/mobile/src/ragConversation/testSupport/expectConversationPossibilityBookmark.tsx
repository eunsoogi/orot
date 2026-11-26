import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Alert } from 'react-native';
import { SavedGeneratedReportDetail } from '../../memory/SavedGeneratedReportDetail';
import { openSavedGeneratedReportReferences } from '../../memory/openSavedGeneratedReportReferences';
import { conversationExecutionNative } from '../conversationExecutionNative';
import { t } from '../../i18n';
import {
  mkdtempSync,
  join,
  tmpdir,
  rmSync,
} from '../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { guardedNativeDatabase } from '../../storage/protectedReadEpoch';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';
import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { createManualHistoryRepository, type SqlDatabase } from '@orot/storage';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import type { ConversationArtifact } from '../../storage/conversationArtifactTypes';

/** File-backed mode proves a fresh SQLite connection reads the same pin. */
export async function conversationPossibilityBookmarkFixture() {
  const directory = mkdtempSync(
    join(tmpdir(), 'orot-conversation-possibility-pin-'),
  );
  const path = join(directory, 'records.sqlite');
  const clean = () => rmSync(directory, { recursive: true, force: true });
  try {
    return { path, f: await healthContextFixture(undefined, path), clean };
  } catch (error) {
    clean();
    throw error;
  }
}

/** Send the exact local composer command and check its real storage receipt. */
async function pressSave(
  store: ReturnType<typeof createConversationArtifactStorage>,
) {
  jest.mocked(openSavedGeneratedReportReferences).mockResolvedValue(store);
  jest.mocked(conversationExecutionNative).mockReturnValue({
    bridgeAvailable: true,
    currentPhase: () => 'active',
    begin: async () => false,
    end: () => {},
    isActive: async () => false,
    protectedDataAvailable: async () => true,
    subscribe: () => () => {},
  });
  const notice = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  try {
    await fireEvent.changeText(
      screen.getByTestId('rag-conversation-input'),
      'Save this report.',
    );
    await fireEvent(
      screen.getByTestId('rag-conversation-send'),
      'composerPress',
    );
    await waitFor(() =>
      expect(notice).toHaveBeenCalledWith(
        t('savedMemory.generatedReportSaved'),
      ),
    );
  } finally {
    notice.mockRestore();
  }
}

/** Exercise the actual typed writer, not the standalone summary or ordinary answer pin. */
export async function expectConversationPossibilityBookmark(
  database: SqlDatabase,
  f: Awaited<ReturnType<typeof healthContextFixture>>,
  saved: ConversationArtifact,
  visibleBody: string,
  path: string,
  unmountComposer: () => Promise<void>,
) {
  const currentOwner = (candidate: SqlDatabase) => candidate === database;
  const store = createConversationArtifactStorage(database, currentOwner);
  const original = {
    artifactId: saved.id,
    createdAt: saved.createdAt,
    lease: { id: saved.sessionId, version: 0 },
    current: () => true,
    confirmProtected: async () => true,
  };
  // The standalone summary can have the same ID but is a different report.
  const decoy = {
    ...f.saved,
    id: saved.id,
    analysis: {
      hypotheses: f.saved.analysis.hypotheses.map(section => ({
        ...section,
        uncertainty: 'Standalone synthetic decoy.',
      })),
    },
  };
  await f.storage.append(decoy);
  expect(
    await store.bookmarkDiseasePossibilities({
      id: decoy.id,
      revision: fingerprint(decoy),
      current: () => true,
    }),
  ).toBe(true);
  expect(
    await store.readBookmarkedConversationPossibility(saved.id, original),
  ).toBeNull();
  expect(
    await store.bookmarkConversationPossibility({
      ...original,
      createdAt: 'wrong-stamp',
    }),
  ).toBe(false);

  const transaction = f.database.transaction.bind(f.database);
  let reached = false;
  const spy = jest.spyOn(f.database, 'transaction').mockImplementation(work =>
    transaction(tx =>
      work({
        ...tx,
        async execute(sql, args) {
          const result = await tx.execute(sql, args);
          if (
            sql.startsWith('INSERT INTO saved_conversation_possibility_refs')
          ) {
            reached = true;
            // Interpose a real tombstone inside the same prepared SQLite writer.
            await tx.execute(
              'INSERT INTO conversation_deleted_artifacts VALUES (?)',
              [saved.id],
            );
          }
          return result;
        },
      }),
    ),
  );
  try {
    expect(await store.bookmarkConversationPossibility(original)).toBe(false);
    expect(reached).toBe(true);
  } finally {
    spy.mockRestore();
  }
  expect(
    await store.readBookmarkedConversationPossibility(saved.id, original),
  ).toBeNull();
  const notes = createManualHistoryRepository(database);
  const before = await notes.list();
  await pressSave(store);
  expect(await notes.list()).toEqual(before);
  expect(await store.listBookmarkedConversationPossibilities()).toMatchObject([
    { artifactId: saved.id, reportKind: 'conversation_disease_possibilities' },
  ]);
  await unmountComposer();
  const connection = openSqliteTestDatabase(path);
  try {
    const ownedDatabase = guardedNativeDatabase(connection.database);
    const reopened = createConversationArtifactStorage(
      ownedDatabase,
      candidate => candidate === ownedDatabase,
    );
    expect(
      JSON.stringify(
        await reopened.readBookmarkedConversationPossibility(
          saved.id,
          original,
        ),
      ),
    ).toContain(visibleBody);
    expect(await reopened.listSavedConversationAnswers()).toEqual([]);
    jest.mocked(openSavedGeneratedReportReferences).mockResolvedValue(reopened);
    const current = () => true;
    const openMemory = () =>
      render(
        <SavedGeneratedReportDetail
          artifactId={saved.id}
          reportKind="conversation_disease_possibilities"
          isReadCurrent={current}
        />,
      );
    const view = await openMemory();
    try {
      expect(await screen.findByText(visibleBody)).toBeTruthy();
      expect(
        screen.getByText(t('savedMemory.generatedReportOrigin')),
      ).toBeTruthy();
    } finally {
      await view.unmount();
    }
    expect(
      await reopened.readSavedDiseasePossibilitiesPin(decoy.id, () => true),
    ).toBe(fingerprint(decoy));
    // Delete the actual linked source; the exact bookmark may not reopen its body.
    await f.repository.delete('health_observation', f.inside.id);
    expect(
      await reopened.readBookmarkedConversationPossibility(saved.id, original),
    ).toBeNull();
    const unavailable = await openMemory();
    try {
      expect(
        await screen.findByText(t('savedMemory.generatedReportUnavailable')),
      ).toBeTruthy();
      expect(screen.queryByText(visibleBody)).toBeNull();
    } finally {
      await unavailable.unmount();
    }
  } finally {
    connection.close();
  }
}
