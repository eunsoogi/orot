import type { OutboundProcessingRequest } from '@orot/agent-runtime';
import {
  makeProvider,
  preparedContext,
  selectedOption,
  successfulOutputs,
} from '../testing/workflowFixtures';
import { runVisitQuestionWorkflow } from '../workflow';

describe('visit-question shared workflow', () => {
  it('hands off bounded research, restores exact citations, and refreshes remote consent', async () => {
    const prepared = preparedContext();
    const { provider, requests } = makeProvider(
      successfulOutputs(
        prepared.initialEvidence,
        prepared.supplementalEvidence,
      ),
    );
    const { selection, option } = selectedOption(provider);
    const consentRequests: OutboundProcessingRequest[] = [];
    const confirmConsent = jest.fn(
      async (request: OutboundProcessingRequest) => {
        consentRequests.push(request);
        return true;
      },
    );

    const result = await runVisitQuestionWorkflow({
      prepared,
      selection,
      providerOptions: [option],
      recipient: 'ChatGPT account selected for this run',
      confirmConsent,
    });

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.questions).toHaveLength(3);
    expect(result.questions[0]?.citations).toEqual([
      prepared.supplementalEvidence,
    ]);
    expect(prepared.searchEvidence).toHaveBeenCalledWith(
      '최근 검사 결과',
      expect.any(Number),
      'personal_record',
      expect.any(AbortSignal),
    );
    expect(prepared.revalidateEvidence).toHaveBeenCalledWith(
      expect.arrayContaining([
        prepared.initialEvidence,
        prepared.supplementalEvidence,
      ]),
    );
    expect(requests).toHaveLength(3);
    expect(confirmConsent).toHaveBeenCalledTimes(3);
    expect(
      new Set(consentRequests.map(request => JSON.stringify(request.payload)))
        .size,
    ).toBe(3);
    expect(JSON.stringify(requests)).not.toContain('private-source-');
    expect(JSON.stringify(requests)).not.toContain('private-span-');
  });

  it('does not call the selected provider when remote payload consent is declined', async () => {
    const prepared = preparedContext();
    const { provider, requests } = makeProvider([
      JSON.stringify({ type: 'request_evidence', need: 'missing_coverage' }),
    ]);
    const { selection, option } = selectedOption(provider);
    const confirmConsent = jest.fn(async () => false);

    const result = await runVisitQuestionWorkflow({
      prepared,
      selection,
      providerOptions: [option],
      recipient: 'ChatGPT account selected for this run',
      confirmConsent,
    });

    expect(result.status).toBe('consent_required');
    expect(confirmConsent).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(0);
  });

  it('stops after cancellation before dispatching a role or local search', async () => {
    const prepared = preparedContext();
    const controller = new AbortController();
    const { provider, requests } = makeProvider(
      [JSON.stringify({ type: 'request_evidence', need: 'missing_coverage' })],
      () => controller.abort(),
    );
    const { selection, option } = selectedOption(provider, 'on-device');

    const result = await runVisitQuestionWorkflow({
      prepared,
      selection,
      providerOptions: [option],
      signal: controller.signal,
    });

    expect(result.status).toBe('cancelled');
    expect(requests).toHaveLength(1);
    expect(prepared.searchEvidence).not.toHaveBeenCalled();
  });
});
