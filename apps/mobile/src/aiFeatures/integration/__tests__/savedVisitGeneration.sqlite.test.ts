import { NativeModules } from 'react-native';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { VisitQuestionSchema } from '@orot/domain';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  join,
  mkdtempSync,
  rmSync,
  tmpdir,
} from '../../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import {
  appointment,
  candidate,
  citation,
  evidenceSpan,
  sourceRecord,
  input,
  repository,
} from '../../../agent/visitQuestions/testing/persistenceFixtures';
import { saveReviewedVisitQuestions } from '../../../agent/visitQuestions/persistence';
import { localEvidenceFingerprint } from '../../../agent/visitQuestions/evidence';
import { restoreSavedVisitQuestions } from '../savedVisitQuestions';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';

declare const require: (specifier: string) => unknown;
const { createHash } = require('node:crypto') as {
  createHash(algorithm: string): {
    update(text: string): { digest(encoding: string): string };
  };
};

beforeEach(() => {
  NativeModules.OrotConsentFingerprint = {
    sha256: jest.fn(async (text: string) =>
      createHash('sha256').update(text).digest('hex'),
    ),
  };
});
afterEach(() => {
  delete NativeModules.OrotConsentFingerprint;
});

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'orot-question-generation-'));
  const path = join(directory, 'records.sqlite');
  let connection = openSqliteTestDatabase(path);
  await runMigrations(connection.database);
  let records = createRecordRepository(connection.database);
  await records.put('appointment', appointment);
  await records.put('source_record', sourceRecord as never);
  await records.put('evidence_span', evidenceSpan as never);
  const save = (
    options: Partial<Parameters<typeof saveReviewedVisitQuestions>[0]> = {},
  ) =>
    saveReviewedVisitQuestions({
      ...input(repository()),
      repository: records,
      generationCaveats: ['incomplete_coverage'],
      ...options,
    });
  const restore = () =>
    restoreSavedVisitQuestions({
      appointmentId: appointment.id,
      records,
      sourceReader: {
        querySource: async () => ({
          status: 'available',
          complete: true,
          records: [],
        }),
      } as never,
      registry: new LocalEvidenceReferenceRegistry(),
    });
  return {
    get records() {
      return records;
    },
    save,
    restore,
    reopen() {
      connection.close();
      connection = openSqliteTestDatabase(path);
      records = createRecordRepository(connection.database);
    },
    close() {
      connection.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test('round-trips historical caveats and bounded version hashes through closed and reopened SQLite', async () => {
  const f = await fixture();
  try {
    const saved = await f.save();
    expect(saved.questions[0]?.generation?.sources).toEqual([
      {
        sourceKind: 'personal_record',
        sourceId: citation.sourceId,
        evidenceId: citation.evidenceId,
        sourceDigest: createHash('sha256')
          .update(citation.sourceRevision)
          .digest('hex'),
        evidenceDigest: createHash('sha256')
          .update(citation.evidenceRevision)
          .digest('hex'),
      },
    ]);
    expect(JSON.stringify(saved.questions[0]?.generation)).not.toContain(
      evidenceSpan.text,
    );
    f.reopen();
    const restored = await f.restore();
    expect(restored.caveats).toEqual(['incomplete_coverage']);
    expect(restored.restorationWarning).toBe(false);
    expect(restored.restorationNotice).toContain('버전 정보를 확인');
  } finally {
    f.close();
  }
});

test('preserves old metadata on edits and never invents caveats for a legacy row', async () => {
  const f = await fixture();
  try {
    const saved = (await f.save({ generationCaveats: undefined }))
      .questions[0]!;
    const edited = await f.save({
      questions: [
        {
          ...candidate,
          identity: {
            id: saved.id,
            expectedRevision: localEvidenceFingerprint(saved),
          },
          questionText: '저장한 질문을 다시 확인할까요?',
        },
      ],
      expectedSavedQuestions: [
        { id: saved.id, revision: localEvidenceFingerprint(saved) },
      ],
      generationCaveats: ['conflicting_records'],
    });
    expect(edited.questions[0]?.generation).toBeUndefined();
    expect((await f.restore()).caveats).toEqual([]);
    expect((await f.restore()).restorationNotice).toContain(
      '포함되지 않습니다',
    );
  } finally {
    f.close();
  }
});

test('shows a genuine original-version change and still rejects deleted citation evidence', async () => {
  const f = await fixture();
  try {
    await f.save();
    await f.records.put('source_record', {
      ...sourceRecord,
      recordedAt: '2026-10-02T00:00:00Z',
      ingestedAt: '2026-10-02T00:00:00Z',
    } as never);
    const changed = await f.restore();
    expect(changed.restorationWarning).toBe(true);
    expect(changed.restorationNotice).toContain('버전이 바뀌었습니다');
    expect(changed.caveats).toEqual(['incomplete_coverage']);
    await f.records.delete('evidence_span', evidenceSpan.id);
    await expect(f.restore()).rejects.toMatchObject({
      reason: 'missing_citation_source',
    });
  } finally {
    f.close();
  }
});

test('hash failure preserves the saved list and malformed metadata cannot be parsed', async () => {
  const f = await fixture();
  try {
    const saved = (await f.save()).questions[0]!;
    expect(
      VisitQuestionSchema.safeParse({
        ...saved,
        generation: { ...saved.generation, caveats: ['unknown'] },
      }).success,
    ).toBe(false);
    NativeModules.OrotConsentFingerprint.sha256.mockRejectedValue(
      new Error('synthetic unavailable'),
    );
    await expect(
      f.save({
        questions: [
          { ...candidate, identity: { id: 'new-synthetic-question' } },
        ],
        expectedSavedQuestions: [
          { id: saved.id, revision: localEvidenceFingerprint(saved) },
        ],
      }),
    ).rejects.toThrow('synthetic unavailable');
    expect(await f.records.list('visit_question')).toEqual([saved]);
  } finally {
    f.close();
  }
});

test('editing a saved question preserves its original caveats instead of borrowing a later generation', async () => {
  const f = await fixture();
  try {
    const original = (await f.save()).questions[0]!;
    const expectedRevision = localEvidenceFingerprint(original);
    const edited = await f.save({
      questions: [
        {
          ...candidate,
          identity: { id: original.id, expectedRevision },
          questionText: '기존 질문의 표현을 다시 확인할까요?',
        },
      ],
      expectedSavedQuestions: [{ id: original.id, revision: expectedRevision }],
      generationCaveats: ['conflicting_records'],
    });
    expect(edited.questions[0]?.generation).toEqual(original.generation);
    expect((await f.restore()).caveats).toEqual(['incomplete_coverage']);
  } finally {
    f.close();
  }
});
