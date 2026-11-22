import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';
import type { AiFeatureLocalData } from '../../aiFeatures/integration/localData';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';
import { createRecordRepository } from '@orot/storage';
import { createHealthContextReader } from '../../healthEvidence/healthContext/reader';
import { SavedMemoryDetail } from '../../memory/SavedMemoryDetail';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { notifyLocalSourceDeleted } from '../../storage/localDataClearEvents';
import { setup } from '../../storage/testSupport/conversationHistoryDisplayFixture';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  join,
  mkdtempSync,
  rmSync,
  tmpdir,
} from '../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { GeneratedReportBrowser } from '../GeneratedReportBrowser';
import {
  createGeneratedReportReader,
  openGeneratedReportReader,
} from '../readers';

jest.mock('../readers', () => ({
  ...jest.requireActual('../readers'),
  openGeneratedReportReader: jest.fn(),
}));

const action = '원본 질병 가능성 보고서를 기억에 보관하기';
const narrative = 'Synthetic comparison of supported possibilities.';
const selectReport = async (key: string) =>
  fireEvent.press(await screen.findByTestId(`generated-report-${key}`));
function setForegroundFixture() {
  const descriptor = Object.getOwnPropertyDescriptor(AppState, 'currentState');
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: 'active',
  });
  return () => {
    if (descriptor) Object.defineProperty(AppState, 'currentState', descriptor);
  };
}

async function fixture(path: string) {
  const f = await setup(path);
  const analysis = {
    hypotheses: f.saved.analysis.hypotheses.map(item => ({
      ...item,
      title: 'Synthetic possibility',
      summary: narrative,
      uncertainty: 'Synthetic uncertainty, not a diagnosis.',
    })),
  };
  const original = { ...f.saved, id: 'original', analysis };
  await f.summaryStorage.append(original);
  await f.summaryStorage.append({ ...original, id: 'lookalike' });
  await f.summaryStorage.append({ ...f.saved, id: 'different-kind' });
  await f.save('same-looking-turn', {
    answer: narrative,
    entryIntent: 'possibilities',
  });
  const reader = createGeneratedReportReader(f.db, {
    data: async () => ({ readHealthContext: f.read }) as AiFeatureLocalData,
    records: async () => f.repository,
  });
  return { f, original, reader };
}
test('only the selected committed possibilities original is explicitly pinnable and reopens across SQLite connections', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-possibility-bookmark-'));
  const path = join(directory, 'records.sqlite');
  const restoreAppState = setForegroundFixture();
  try {
    const { f, reader } = await fixture(path);
    try {
      const view = await render(
        <GeneratedReportBrowser open={async () => reader} />,
      );
      try {
        await fireEvent.press(screen.getByTestId('generated-report-open'));
        await selectReport('conversation:same-looking-turn');
        expect(await screen.findByText(narrative)).toBeTruthy();
        expect(screen.queryByRole('button', { name: action })).toBeNull();
        await fireEvent.press(screen.getByTestId('generated-report-back'));
        await selectReport('summary:different-kind');
        expect(
          await screen.findByTestId('generated-report-detail'),
        ).toBeTruthy();
        expect(screen.queryByRole('button', { name: action })).toBeNull();
        await fireEvent.press(screen.getByTestId('generated-report-back'));
        await selectReport('summary:original');
        const pin = await screen.findByRole('button', { name: action });
        expect(await f.storage.listSavedGeneratedReportReferences()).toEqual(
          [],
        );
        await fireEvent.press(pin);
        expect(
          await screen.findByText('보고서 링크를 기억에 보관했어요.'),
        ).toBeTruthy();
        expect(await f.storage.listSavedGeneratedReportReferences()).toEqual([
          {
            artifactId: 'original',
            reportKind: 'disease_possibilities',
            savedAt: expect.any(String),
          },
        ]);
      } finally {
        await view.unmount();
      }
    } finally {
      f.close();
    }
    const reopened = openSqliteTestDatabase(path);
    try {
      const storage = createConversationArtifactStorage(reopened.database);
      jest.mocked(openGeneratedReportReader).mockResolvedValue(
        createGeneratedReportReader(reopened.database, {
          data: async () =>
            ({
              readHealthContext: createHealthContextReader(reopened.database),
            }) as AiFeatureLocalData,
          records: async () => createRecordRepository(reopened.database),
        }),
      );
      const load = async () =>
        (await storage.listSavedGeneratedReportReferences()).map(row => ({
          id: 'generated-disease-report:' + row.artifactId,
          sourceKind: 'saved_generated_report' as const,
          artifactId: row.artifactId,
          reportKind: row.reportKind,
          text: 'Synthetic report link',
          createdAt: Date.parse(row.savedAt),
        }));
      const destination = await render(
        <SavedMemoryDetail
          memoryId="generated-disease-report:original"
          load={load}
        />,
      );
      try {
        expect(
          await screen.findByText('AI가 만든 질병 가능성 보고서'),
        ).toBeTruthy();
        expect(await screen.findByText(narrative)).toBeTruthy();
        expect(
          await screen.findByText('Synthetic uncertainty, not a diagnosis.'),
        ).toBeTruthy();
      } finally {
        await destination.unmount();
      }
    } finally {
      reopened.close();
    }
  } finally {
    restoreAppState();
    rmSync(directory, { recursive: true, force: true });
  }
}, 20000);

test('a lookalike, uncommitted selection, wrong kind, and invalidated source never reopen a different original', async () => {
  const { f, original } = await fixture(':memory:');
  try {
    const current = () => true;
    const revision = fingerprint(original);
    const pin = (id: string, seen = revision) =>
      f.storage.bookmarkDiseasePossibilities({ id, revision: seen, current });
    await expect(pin('same-looking-turn')).resolves.toBe(false);
    await expect(pin('lookalike')).resolves.toBe(false);
    const other = await f.summaryStorage.read('different-kind');
    await expect(pin('different-kind', fingerprint(other))).resolves.toBe(
      false,
    );
    await expect(pin('uncommitted')).resolves.toBe(false);
    await expect(pin('original')).resolves.toBe(true);
    await expect(pin('original')).resolves.toBe(true);
    const schema = await f.db.execute(
      'PRAGMA table_info(saved_disease_possibility_refs)',
    );
    expect(schema.rows.map(row => row.name)).toEqual([
      'summary_id',
      'revision',
      'saved_at',
    ]);
    await expect(
      f.storage.readSavedDiseasePossibilitiesReference('lookalike', current),
    ).resolves.toBeNull();
    await expect(
      f.storage.readSavedDiseasePossibilitiesReference('original', current),
    ).resolves.not.toBeNull();
    await f.repository.put('health_observation', {
      ...f.inside,
      id: 'new-typed-source',
    });
    await expect(
      f.storage.readSavedDiseasePossibilitiesReference('original', current),
    ).resolves.toBeNull();
    await expect(pin('original')).resolves.toBe(false);
    await f.db.execute('DELETE FROM symptom_summary_runs WHERE id = ?', [
      original.id,
    ]);
    expect(await f.storage.listSavedGeneratedReportReferences()).toEqual([]);
  } finally {
    f.close();
  }
});

test('a deletion after the actual prepared insert invalidates the mounted owner and rolls back the link', async () => {
  const { f, reader } = await fixture(':memory:');
  const restoreAppState = setForegroundFixture();
  const run = f.db.transaction.bind(f.db);
  let inserted = false;
  const intercept = jest.spyOn(f.db, 'transaction').mockImplementation(work =>
    run(tx =>
      work({
        ...tx,
        async execute(query, values) {
          const result = await tx.execute(query, values);
          if (query.includes('INSERT INTO saved_disease_possibility_refs')) {
            inserted = true;
            notifyLocalSourceDeleted('local');
          }
          return result;
        },
      }),
    ),
  );
  try {
    const view = await render(
      <GeneratedReportBrowser open={async () => reader} />,
    );
    try {
      await fireEvent.press(screen.getByTestId('generated-report-open'));
      await selectReport('summary:original');
      const pin = await screen.findByRole('button', { name: action });
      await act(() => fireEvent.press(pin));
      expect(await f.storage.listSavedGeneratedReportReferences()).toEqual([]);
      expect(inserted).toBe(true);
      expect(screen.queryByText(narrative)).toBeNull();
      expect(screen.queryByText('보고서 링크를 기억에 보관했어요.')).toBeNull();
    } finally {
      await view.unmount();
    }
  } finally {
    intercept.mockRestore();
    restoreAppState();
    f.close();
  }
});
