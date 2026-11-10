import { verifyTreatmentClaim } from '../safety';
import type { TreatmentExplanationRequest } from '../interfaces';

const reference = {
  sourceKind: 'personal_record' as const,
  sourceId: 'synthetic',
  sourceRevision: '1',
  evidenceId: 'synthetic',
  evidenceRevision: '1',
  locator: {},
  effectiveTime: null,
  reviewState: 'unknown' as const,
};
const claim = { text: 'A synthetic claim.', citations: [reference] };

function request(revalidateEvidence = jest.fn().mockResolvedValue(true)) {
  return {
    context: {
      version: 1,
      conditions: [],
      clinicianPlans: { status: 'unavailable' },
      publicEvidence: [],
      missingContext: [],
      conflicts: [],
    },
    sources: [{ reference, records: [] }],
    revalidateEvidence,
  } as unknown as TreatmentExplanationRequest;
}

test('requires an independent verifier and a source in the inventory', async () => {
  const signal = new AbortController().signal;
  expect(await verifyTreatmentClaim(claim, request(), undefined, signal)).toBe(
    false,
  );
  const verifier = { verify: jest.fn().mockResolvedValue(true) };
  expect(
    await verifyTreatmentClaim(
      { ...claim, citations: [{ ...reference, sourceRevision: '2' }] },
      request(),
      verifier,
      signal,
    ),
  ).toBe(false);
  expect(verifier.verify).not.toHaveBeenCalled();
});

test('withholds if the source changes during verification', async () => {
  const revalidate = jest
    .fn()
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(false);
  expect(
    await verifyTreatmentClaim(
      claim,
      request(revalidate),
      { verify: async () => true },
      new AbortController().signal,
    ),
  ).toBe(false);
  expect(revalidate).toHaveBeenCalledTimes(2);
});

test('withholds rejected, failed and cancelled verification', async () => {
  const abort = new AbortController();
  for (const verify of [
    async () => false,
    async () => {
      throw new Error('unavailable');
    },
    async () => {
      abort.abort();
      return true;
    },
  ]) {
    expect(
      await verifyTreatmentClaim(claim, request(), { verify }, abort.signal),
    ).toBe(false);
  }
});

test('allows an independently supported claim after both freshness checks', async () => {
  const revalidate = jest.fn().mockResolvedValue(true);
  expect(
    await verifyTreatmentClaim(
      claim,
      request(revalidate),
      { verify: async () => true },
      new AbortController().signal,
    ),
  ).toBe(true);
  expect(revalidate).toHaveBeenCalledTimes(2);
});
