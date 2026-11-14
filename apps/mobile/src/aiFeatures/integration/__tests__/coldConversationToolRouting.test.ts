import type { SqlDatabase } from '@orot/storage';
import type { EvidenceReference } from '@orot/agent-runtime';
import { createColdConversationServices } from '../coldConversationServices';
import { resumeColdRagConversation } from '../resumeColdRagConversation';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import type { RagConversationServiceDependencies } from '../ragConversationServiceDependencies';
import type { StoredConversationToolTurn } from '../../../storage/conversationToolEventStorage';
import { conversationToolEventFixtures } from '../../../ragConversation/testSupport/conversationToolEventFixtures';

jest.mock('../resumeColdRagConversation', () => ({
  resumeColdRagConversation: jest.fn(),
}));
jest.mock('../../../storage/conversationArtifactStorage', () => ({
  createConversationArtifactStorage: jest.fn(),
}));
const owner = {
  sessionId: 'session',
  sessionVersion: 2,
  requestId: 'request',
  operationRunId: 'synthetic-run',
};
const scope = { ...owner, callId: 'tool-1' };
async function fixture() {
  const registry = new LocalEvidenceReferenceRegistry();
  const original: EvidenceReference = {
    sourceKind: 'personal_record',
    sourceId: 'private',
    sourceRevision: '1',
    evidenceId: 'memory',
    evidenceRevision: '1',
    locator: null,
    reviewState: 'unknown',
    effectiveTime: null,
  };
  const read = jest.fn(async () => ({
    status: 'available' as const,
    document: { sourceKind: 'personal_record' as const, records: [] },
  }));
  const item = registry.add({
    reference: original,
    content: '',
    validate: async () => true,
    readSource: read,
  });
  const source = {
    sourceKind: item.sourceKind,
    sourceId: item.sourceId,
    sourceRevision: item.sourceRevision,
    evidenceId: item.evidenceId,
    evidenceRevision: item.evidenceRevision,
  };
  const turns: StoredConversationToolTurn[] = [
    {
      messageId: 'request',
      createdAt: '2026-01-01',
      toolEvents: [
        { ...conversationToolEventFixtures[0]!, sources: [original] },
      ],
      lineages: [
        {
          runId: owner.operationRunId,
          callId: scope.callId,
          sources: [{ reference: original, records: [] }],
        },
      ],
    },
  ];
  const readToolTurns = jest.fn(async () => turns);
  jest
    .mocked(createConversationArtifactStorage)
    .mockReturnValue({ readToolTurns } as unknown as ReturnType<
      typeof createConversationArtifactStorage
    >);
  const execute = jest.fn(async () => ({
    rows: [
      { manifest: JSON.stringify({ operationRunId: owner.operationRunId }) },
    ],
  }));
  const database = { execute } as unknown as SqlDatabase;
  jest.mocked(resumeColdRagConversation).mockImplementation(async input => {
    input.onRegistry?.(owner, registry);
    return {
      status: 'completed',
      outcome: { status: 'failure', kind: 'unavailable' },
      registry,
    };
  });
  const services = createColdConversationServices(
    {} as RagConversationServiceDependencies,
    async () => database,
  );
  const signal = new AbortController().signal;
  await expect(
    services.resolveColdConversationToolSource(owner, source, signal, scope),
  ).resolves.toBeUndefined();
  await services.resume(owner, signal, {});
  return { services, source, read, turns, readToolTurns, execute, signal };
}
beforeEach(() => jest.clearAllMocks());

test('normalizes persisted originals and checks exact request, version, run and call before local read', async () => {
  const f = await fixture();
  await expect(
    f.services.resolveColdConversationToolSource(
      owner,
      f.source,
      f.signal,
      scope,
    ),
  ).resolves.toMatchObject(f.source);
  expect(f.readToolTurns).toHaveBeenCalledWith(
    owner.sessionId,
    owner.sessionVersion,
  );
  f.read.mockClear();
  for (const bad of [
    { ...scope, callId: 'foreign' },
    { ...scope, operationRunId: 'foreign' },
    { ...scope, sessionId: 'foreign' },
  ])
    await expect(
      f.services.resolveColdConversationToolSource(
        owner,
        f.source,
        f.signal,
        bad,
      ),
    ).resolves.toBeUndefined();
  await expect(
    f.services.resolveColdConversationToolSource(
      { ...owner, requestId: 'other' },
      f.source,
      f.signal,
      scope,
    ),
  ).resolves.toBeUndefined();
  await expect(
    f.services.resolveColdConversationToolSource(
      { ...owner, sessionVersion: 3 },
      f.source,
      f.signal,
      scope,
    ),
  ).resolves.toBeUndefined();
  expect(f.read).not.toHaveBeenCalled();
});

test.each(['delete-call', 'abort', 'session-generation'] as const)(
  'post-read %s change cannot open a stale source',
  async mode => {
    const f = await fixture();
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>(done => {
      entered = done;
    });
    f.read.mockImplementationOnce(async () => {
      entered();
      await new Promise<void>(done => {
        release = done;
      });
      return {
        status: 'available',
        document: { sourceKind: 'personal_record', records: [] },
      };
    });
    const controller = new AbortController();
    const result = f.services.resolveColdConversationToolSource(
      owner,
      f.source,
      controller.signal,
      scope,
    );
    await started;
    if (mode === 'delete-call') f.readToolTurns.mockResolvedValue([]);
    if (mode === 'abort') controller.abort();
    if (mode === 'session-generation')
      f.execute.mockResolvedValue({ rows: [] });
    release();
    await expect(result).resolves.toBeUndefined();
  },
);
