import { providerSuccess } from '@orot/model-runtime';
import { createPublicWebEvidence } from '../publicWebEvidence';
import { referenceOnly } from '../../../diseaseHypotheses/resultValidation';
import {
  publicEvidenceFixture,
  publicResponse,
} from '../testSupport/publicWebEvidenceTestSupport';

// Synthetic provider output crosses the previous call and byte ceilings without
// changing the query-only consent or evidence identity boundary.
test('retains a complete large search result after more than two provider calls', async () => {
  const run = publicEvidenceFixture();
  const text = 'Synthetic public explanation. '.repeat(4000);
  run.search.mockResolvedValue(
    providerSuccess({ ...publicResponse, text, callCount: 5 }),
  );
  const web = createPublicWebEvidence(run)!;
  const result = await web.tool.search({
    ...run.request,
    executionLimits: 'unbounded',
    maxPayloadBytes: 100,
  });
  if ('status' in result) throw new Error('Expected complete public evidence');
  expect(result.items).toHaveLength(1);
  expect(result.items[0]!.content).toContain(text);
  expect(web.validates(referenceOnly(result.items[0]!))).toBe(true);
  expect(run.authorize).toHaveBeenCalledTimes(1);
  expect(run.search).toHaveBeenCalledTimes(1);
});

test('unbounded work still requires consent and never dispatches after cancellation', async () => {
  const run = publicEvidenceFixture();
  run.authorize.mockResolvedValue('renewal_required');
  const web = createPublicWebEvidence(run)!;
  const request = { ...run.request, executionLimits: 'unbounded' as const };
  expect(await web.tool.search(request)).toEqual({
    status: 'consent_required',
  });
  run.controller.abort();
  expect(await web.tool.search(request)).toEqual({
    status: 'consent_required',
  });
  expect(run.search).not.toHaveBeenCalled();
});
