import type { OutboundProcessingRequest } from '@orot/agent-runtime';
import { selectDailyReportFacts } from '../dailyReportModel';
import { createDailyReportDeadlineContext } from '../dailyReportDeadline';
import {
  reportProvider,
  selectedReportProvider,
} from '../testSupport/dailyReportFailureStageFixtures';
import { createPublicWebEvidence } from '../publicWebEvidence';
import { publicEvidenceFixture } from '../testSupport/publicWebEvidenceTestSupport';

function consent() {
  let current = true;
  let approved: OutboundProcessingRequest | undefined;
  return {
    revoke() {
      current = false;
    },
    port: {
      authorize: async (request: OutboundProcessingRequest) => {
        approved = request;
        return 'authorized' as const;
      },
      isAuthorizationCurrent: (request: OutboundProcessingRequest) =>
        current && request === approved,
    },
  };
}

test('daily-report source read cannot carry an earlier approval past revocation', async () => {
  const provider = reportProvider();
  const generate = jest.spyOn(provider, 'generate');
  const selected = selectedReportProvider(provider, true);
  if (selected.status !== 'ready') throw new Error('Synthetic fixture');
  const gate = consent();
  expect(
    await selectDailyReportFacts({
      selected,
      consent: gate.port,
      runId: 'synthetic',
      facts: [{ text: 'Synthetic evidence', role: 'evidence' }],
      signal: new AbortController().signal,
      timeoutMs: null,
      deadlineContext: createDailyReportDeadlineContext(),
      revalidate: async () => {
        await Promise.resolve();
        gate.revoke();
        return true;
      },
    }),
  ).toEqual({ status: 'failed', code: 'consent_required' });
  expect(generate).not.toHaveBeenCalled();
});

test('public search preserves the exact outbound witness after its awaited source fence', async () => {
  const fixture = publicEvidenceFixture();
  const gate = consent();
  const web = createPublicWebEvidence({
    ...fixture,
    consent: gate.port,
    beforeDispatch: async () => {
      await Promise.resolve();
      gate.revoke();
      return true;
    },
  })!;
  await expect(web.tool.search(fixture.request)).rejects.toThrow(
    'permission changed',
  );
  expect(fixture.search).not.toHaveBeenCalled();
});

test('daily-report permission loss at actual provider entry is consent failure, never provider failure', async () => {
  const provider = reportProvider();
  const generate = jest.spyOn(provider, 'generate');
  const selected = selectedReportProvider(provider, true);
  if (selected.status !== 'ready') throw new Error('Synthetic fixture');
  let checks = 0;
  const result = await selectDailyReportFacts({
    selected,
    consent: {
      authorize: async () => 'authorized',
      // Source validation succeeds, then the live provider-boundary check observes revocation.
      isAuthorizationCurrent: () => ++checks === 1,
    },
    runId: 'synthetic',
    facts: [{ text: 'Synthetic evidence', role: 'evidence' }],
    signal: new AbortController().signal,
    timeoutMs: null,
    deadlineContext: createDailyReportDeadlineContext(),
    revalidate: async () => true,
  });
  expect(checks).toBe(2);
  expect(result).toEqual({ status: 'failed', code: 'consent_required' });
  expect(generate).not.toHaveBeenCalled();
});
