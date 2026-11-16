import { visitHealthFixture } from '../testing/healthContextFixture';
import { providerDiagnostic } from '../../../providers/diagnostics';
import { observeVisitEvidencePhase } from '../evidencePhaseDiagnostics';
import { createVisitQuestionEvidenceRevalidator } from '../evidenceRevalidation';
import {
  mapMemoryHitToVisitQuestionEvidence,
  visitQuestionCitationKey,
} from '../evidence';
import { appointment, now, ports } from '../testing/evidenceServiceFixtures';

jest.mock('../../../providers/diagnostics', () => ({
  providerDiagnostic: jest.fn(),
}));

beforeEach(() => jest.mocked(providerDiagnostic).mockReset());

test('keeps pending work inside the fixed phase and never emits private results', async () => {
  let complete!: (value: string) => void;
  const pending = observeVisitEvidencePhase(
    'evidence_records',
    () =>
      new Promise<string>(resolve => {
        complete = resolve;
      }),
  );
  expect(providerDiagnostic).toHaveBeenCalledTimes(1);
  expect(providerDiagnostic).toHaveBeenLastCalledWith(
    'visit',
    'evidence_records',
    'started',
  );
  complete('synthetic private record text');
  expect(await pending).toBe('synthetic private record text');
  expect(jest.mocked(providerDiagnostic).mock.calls).toEqual([
    ['visit', 'evidence_records', 'started'],
    ['visit', 'evidence_records', 'completed'],
  ]);
});

test('preserves a failed fence and excludes its error message', async () => {
  const error = new Error('synthetic private query');
  await expect(
    observeVisitEvidencePhase('evidence_period', async () => {
      throw error;
    }),
  ).rejects.toBe(error);
  expect(jest.mocked(providerDiagnostic).mock.calls).toEqual([
    ['visit', 'evidence_period', 'started'],
    ['visit', 'evidence_period', 'failed'],
  ]);
});

test('a broken diagnostic bridge cannot turn false validation into success', async () => {
  jest.mocked(providerDiagnostic).mockImplementation(() => {
    throw new Error('bridge unavailable');
  });
  expect(
    await observeVisitEvidencePhase('evidence_memory', async () => false),
  ).toBe(false);
});

test('separates appointment and memory rereads without emitting a search query or citation', async () => {
  const dependencies = ports();
  const hit = (
    await dependencies.queryService.searchMemory('synthetic sensitive query')
  ).hits[0]!;
  const mapped = mapMemoryHitToVisitQuestionEvidence(hit)!;
  const revalidate = createVisitQuestionEvidenceRevalidator({
    appointment,
    query: 'synthetic sensitive query',
    metadataByCitation: new Map([
      [visitQuestionCitationKey(mapped.item), mapped.metadata],
    ]),
    queryService: dependencies.queryService,
    repository: dependencies.repository,
    buildChunks: async () => [],
    currentTime: () => now,
  });
  expect(await revalidate([mapped.item])).toBe(true);
  expect(jest.mocked(providerDiagnostic).mock.calls).toEqual([
    ['visit', 'evidence_appointment', 'started'],
    ['visit', 'evidence_appointment', 'completed'],
    ['visit', 'evidence_memory', 'started'],
    ['visit', 'evidence_memory', 'completed'],
  ]);
});

test('period validation stays fail-closed while its wait is observed', async () => {
  const dependencies = ports();
  const citation = {
    sourceKind: 'personal_record' as const,
    sourceId: 'synthetic-period',
    sourceRevision: 'revision',
    evidenceId: 'synthetic-period',
    evidenceRevision: 'revision',
    locator: {},
    effectiveTime: null,
    reviewState: 'unknown' as const,
    content: 'Synthetic period facts',
  };
  const validateHealthContext = jest.fn(async () => false);
  const revalidate = createVisitQuestionEvidenceRevalidator({
    appointment,
    query: 'synthetic query',
    metadataByCitation: new Map([
      [
        visitQuestionCitationKey(citation),
        {
          sourceRecordIds: [],
          sourceRecordRevisions: [],
          sourceDates: [],
          healthContextSource: {
            scope: {
              kind: 'health_context_period',
              version: 1,
              topic: 'sleep',
              window: {
                fromInclusive: '2026-10-01',
                toExclusive: '2026-10-02',
                timeZone: 'UTC',
              },
            },
            revision: 'revision',
            deletionGeneration: 0,
          },
        },
      ],
    ]),
    queryService: dependencies.queryService,
    repository: dependencies.repository,
    buildChunks: async () => [],
    currentTime: () => now,
    validateHealthContext,
  });
  expect(await revalidate([citation])).toBe(false);
  expect(validateHealthContext).toHaveBeenCalledTimes(1);
  expect(jest.mocked(providerDiagnostic).mock.calls.slice(-2)).toEqual([
    ['visit', 'evidence_period', 'started'],
    ['visit', 'evidence_period', 'completed'],
  ]);
});

test('period revalidation exposes fixed reader boundaries without changing validity', async () => {
  const fixture = await visitHealthFixture();
  try {
    jest.mocked(providerDiagnostic).mockClear();
    expect(await fixture.prepared.revalidateEvidence([fixture.item])).toBe(
      true,
    );
    expect(providerDiagnostic).toHaveBeenCalledWith(
      'visit',
      'data',
      'context_generation_started',
    );
    expect(providerDiagnostic).toHaveBeenCalledWith(
      'visit',
      'data',
      'context_generation_completed',
    );
    jest.mocked(providerDiagnostic).mockImplementation(() => {
      throw new Error('bridge unavailable');
    });
    expect(await fixture.prepared.revalidateEvidence([fixture.item])).toBe(
      true,
    );
  } finally {
    fixture.close();
  }
});
