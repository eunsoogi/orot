import { createPublicWebEvidence } from '../publicWebEvidence';
import { publicEvidenceFixture } from '../testSupport/publicWebEvidenceTestSupport';

// Synthetic stalled/failed services only; the parent cancellation remains authoritative.
test.each([false, true])(
  'bounded timeout returns unavailable coverage (abort-responsive: %s)',
  async responsive => {
    jest.useFakeTimers();
    try {
      const run = publicEvidenceFixture();
      run.search.mockImplementation(
        (_request, options) =>
          new Promise((_resolve, reject) => {
            if (responsive)
              options?.signal?.addEventListener('abort', () =>
                reject(new Error('synthetic provider abort')),
              );
          }),
      );
      const pending = createPublicWebEvidence({
        ...run,
        recoverUnavailable: true,
      })!.tool.search(run.request);
      const settled = pending.then(
        value => value,
        () => 'rejected',
      );
      await jest.advanceTimersByTimeAsync(30_000);
      expect(await settled).toMatchObject({
        items: [],
        conflicts: [],
        coverage: [
          {
            sourceKind: 'external_medical',
            returnedCount: 0,
            gaps: [
              'Public web search timed out; no external evidence was retrieved.',
            ],
          },
        ],
      });
      expect(run.search).toHaveBeenCalledTimes(1);
      expect(run.search.mock.calls[0]![1]!.signal!.aborted).toBe(true);
      expect(run.controller.signal.aborted).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  },
);

test('parent cancellation never becomes a fallback result', async () => {
  const run = publicEvidenceFixture();
  run.search.mockImplementation(async () => {
    run.controller.abort();
    return new Promise(() => {});
  });
  await expect(
    createPublicWebEvidence({ ...run, recoverUnavailable: true })!.tool.search(
      run.request,
    ),
  ).rejects.toThrow();
  expect(run.search).toHaveBeenCalledTimes(1);
});

test('explicit provider unavailability returns a durable coverage limitation', async () => {
  const run = publicEvidenceFixture();
  run.search.mockResolvedValue({
    ok: false,
    error: {
      code: 'provider_unavailable',
      message: 'synthetic',
      retryable: true,
    },
  });
  await expect(
    createPublicWebEvidence({ ...run, recoverUnavailable: true })!.tool.search(
      run.request,
    ),
  ).resolves.toMatchObject({
    items: [],
    coverage: [
      { returnedCount: 0, gaps: [expect.stringContaining('unavailable')] },
    ],
  });
});

test('unknown provider throws remain terminal instead of being converted to empty evidence', async () => {
  const run = publicEvidenceFixture();
  run.search.mockRejectedValue(new Error('synthetic unexpected failure'));
  await expect(
    createPublicWebEvidence({ ...run, recoverUnavailable: true })!.tool.search(
      run.request,
    ),
  ).rejects.toThrow('synthetic unexpected failure');
});
