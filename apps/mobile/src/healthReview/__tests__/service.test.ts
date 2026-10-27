import { createHealthReviewService } from '../service';
import { runLocalHealthReview } from '../../agent/healthReview/workflow';
import {
  openLocalAgentMemoryDatabase,
  openLocalStorage,
} from '../../storage/secureDatabase';
import { syntheticHealthReview } from '../../agent/healthReview/syntheticFixture';
import { withFixedDate } from '../../agent/healthReview/testing/currentPeriodEvidenceFixture';
import { healthReviewSqlite, instant, safety } from '../testing/sqlite';
import type { SelectedAiResolution } from '../../aiFeatures/integration/provider';
import type { OutboundProcessingRequest } from '@orot/agent-runtime';
import { nativeHealthReviewService } from '../testing/nativeService';

jest.mock('../../agent/polyfills', () => ({}));
jest.mock('../../storage/secureDatabase', () => ({
  openLocalStorage: jest.fn(),
  openLocalAgentMemoryDatabase: jest.fn(),
}));
jest.mock('../../aiFeatures/integration/provider', () => ({
  resolveSelectedAiProvider: jest.fn(),
}));

describe('Production health review service and consent boundaries', () => {
  let f: Awaited<ReturnType<typeof healthReviewSqlite>>;
  beforeEach(async () => {
    f = await healthReviewSqlite();
    await f.seed();
    jest.mocked(openLocalStorage).mockResolvedValue(f.repository);
    jest.mocked(openLocalAgentMemoryDatabase).mockResolvedValue(f.database);
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {
        getRandomValues: (bytes: Uint8Array) =>
          require('node:crypto').randomFillSync(bytes),
      },
    });
  });
  afterEach(() => f.close());
  const setup = () => {
    const synthetic = syntheticHealthReview(
      f.repository,
      'not-a-request-filter',
      false,
    );
    const resolveSelected = jest.fn(
      async (): Promise<SelectedAiResolution> => ({
        status: 'ready',
        selection: {
          providerId: synthetic.model.provider.id,
          modelId: 'model',
        },
        option: {
          provider: synthetic.model.provider,
          modelId: 'model',
          displayName: 'Test provider',
          privacyBoundary: 'selected-context-remote',
          availability: { status: 'available' },
        },
        provider: synthetic.model.provider,
        modelId: 'model',
        recipient: 'selected-account',
        remoteProcessing: true,
      }),
    );
    const remove = jest.fn(async (id: string) => ({
      sourceDeleted: await f.repository.sourceRecords.delete(id),
      memoriesDeleted: 0,
    }));
    return {
      synthetic,
      resolveSelected,
      remove,
      service: createHealthReviewService({
        resources: async () => ({
          repository: f.repository,
          requests: f.requests,
        }),
        resolveSelected,
        data: async () => f.data,
        run: runLocalHealthReview,
        remove,
      }),
    };
  };

  it('native fixture uses the production service and exact saved pending to reach REVIEW with HealthKit-only data', async () =>
    withFixedDate(instant, async () => {
      const native = nativeHealthReviewService(
        'test-persistence-00000000-0000-0000-0000-000000000001',
        'seed',
        {
          resources: async () => ({
            repository: f.repository,
            requests: f.requests,
          }),
          data: async () => f.data,
        },
      );
      const signal = new AbortController().signal;
      const consent = { authorize: async () => 'renewal_required' as const };
      const started = await native.service.start(
        'authored request',
        {},
        consent,
        signal,
      );
      if (started.result.status !== 'needs_clarification')
        throw new Error('Missing pending');
      expect(await f.requests.pending(started.source.id)).toEqual(
        started.result.pending,
      );
      const completed = await native.service.continue(
        started.source.id,
        started.result.pending,
        safety,
        consent,
        signal,
      );
      expect(completed.result.status).toBe('review');
      expect(await f.requests.pending(started.source.id)).toBeNull();
      const citation = [...completed.invocation!.aliases.values()][0];
      expect(
        (await completed.invocation!.readSource(citation, signal)).status,
      ).toBe('available');
    }));

  it('unknown safety creates a pending snapshot without selecting a provider, collecting evidence or dispatching', async () => {
    const { service, resolveSelected, synthetic } = setup();
    const authorize = jest.fn();
    const result = await service.start(
      '나의 검토',
      { requestType: 'health_review', population: 'unknown' },
      { authorize },
      new AbortController().signal,
    );
    expect(result.result.status).toBe('needs_clarification');
    expect(resolveSelected).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
    expect(synthetic.modelCalls()).toBe(0);
    const restored = await service.list();
    expect(restored[0].pending).toEqual(
      result.result.status === 'needs_clarification'
        ? result.result.pending
        : null,
    );
  });

  it('denial exposes exact health_review recipient/model/scope and sends zero model requests', async () =>
    withFixedDate(instant, async () => {
      const { service, synthetic } = setup();
      const authorize = jest.fn(
        async (_request: OutboundProcessingRequest) =>
          'renewal_required' as const,
      );
      const result = await service.start(
        'private name',
        safety,
        { authorize },
        new AbortController().signal,
      );
      expect(result.consentDenied).toBe(true);
      expect(synthetic.modelCalls()).toBe(0);
      expect(authorize).toHaveBeenCalled();
      expect(authorize.mock.calls[0][0]).toMatchObject({
        recipient: 'selected-account',
        modelId: 'model',
        consentScope: {
          purpose: 'health_review',
          dataCategories: ['health_records'],
        },
      });
    }));

  it('rejects a changed pending snapshot before evidence or model use and refuses foreign deletion', async () => {
    const { service, synthetic, remove } = setup();
    const result = await service.start(
      '나의 검토',
      {},
      { authorize: jest.fn() },
      new AbortController().signal,
    );
    if (result.result.status !== 'needs_clarification')
      throw new Error('Missing interrupt');
    expect(
      await service.continue(
        result.source.id,
        { ...result.result.pending, reason: 'evidence' },
        safety,
        { authorize: jest.fn() },
        new AbortController().signal,
      ),
    ).toEqual({ result: { status: 'unavailable' } });
    await f.repository.put('source_record', {
      id: 'foreign',
      sourceKind: 'audio_recording',
      effectiveAt: instant,
      recordedAt: instant,
      ingestedAt: instant,
      reviewState: { status: 'unreviewed' },
      provenance: { origin: 'user_reported', sourceRecordIds: [] },
    });
    await expect(service.delete('foreign')).rejects.toThrow();
    expect(remove).not.toHaveBeenCalled();
    expect(synthetic.modelCalls()).toBe(0);
  });
});
