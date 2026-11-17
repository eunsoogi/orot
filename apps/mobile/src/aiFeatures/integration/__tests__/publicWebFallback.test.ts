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
      await jest.advanceTimersByTimeAsync(180_000);
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

// Provider failures are outcomes of the isolated optional read, not valid citations.
test.each([
  'rate_limited',
  'authentication_required',
  'credential_unavailable',
  'unsupported_capability',
  'unsupported_input',
  'invalid_request',
] as const)(
  'preserves local fallback after explicit search failure %s',
  async code => {
    const run = publicEvidenceFixture();
    run.search.mockResolvedValue({
      ok: false,
      error: { code, message: 'private synthetic detail', retryable: false },
    });
    const web = createPublicWebEvidence({ ...run, recoverUnavailable: true })!;
    await expect(web.tool.search(run.request)).resolves.toMatchObject({
      items: [],
      coverage: [
        { returnedCount: 0, gaps: [expect.stringContaining('unavailable')] },
      ],
    });
    expect(run.search).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(web.snapshot())).not.toContain('web-result');
  },
);

test.each([
  'internal_error',
  'safety_refusal',
  'invalid_provider',
  'duplicate_provider',
] as const)(
  'does not recover policy or provider configuration failure %s',
  async code => {
    const run = publicEvidenceFixture();
    run.search.mockResolvedValue({
      ok: false,
      error: { code, message: 'synthetic', retryable: false },
    });
    await expect(
      createPublicWebEvidence({
        ...run,
        recoverUnavailable: true,
      })!.tool.search(run.request),
    ).rejects.toThrow();
  },
);

test('typed failures do not recover cancellation or opt-out of optional recovery', async () => {
  const run = publicEvidenceFixture();
  run.search.mockResolvedValue({
    ok: false,
    error: { code: 'rate_limited', message: 'synthetic', retryable: false },
  });
  await expect(
    createPublicWebEvidence(run)!.tool.search(run.request),
  ).rejects.toThrow();
  run.search.mockImplementation(async () => {
    run.controller.abort();
    return {
      ok: false,
      error: { code: 'internal_error', message: 'synthetic', retryable: false },
    };
  });
  await expect(
    createPublicWebEvidence({ ...run, recoverUnavailable: true })!.tool.search(
      run.request,
    ),
  ).rejects.toThrow();
});

test('denied search consent never dispatches or turns into a failed-search result', async () => {
  const run = publicEvidenceFixture();
  run.authorize.mockResolvedValue('renewal_required');
  await expect(
    createPublicWebEvidence({ ...run, recoverUnavailable: true })!.tool.search(
      run.request,
    ),
  ).resolves.toEqual({ status: 'consent_required' });
  expect(run.search).not.toHaveBeenCalled();
});
