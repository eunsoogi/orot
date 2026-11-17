import { runVisitQuestionWorkflow } from '../workflow';
import {
  makeProvider,
  preparedContext,
  selectedOption,
  successfulOutputs,
} from '../testing/workflowFixtures';
import { jsonByteLength } from '../../../aiFeatures/integration/evidenceUtils';

// Interactive requests are not rejected by the former aggregate app cap. The
// actual provider, source validation and remote consent still own their boundaries.
test.each([true, false])(
  'oversized interactive visit request respects consent=%s rather than the old app cap',
  async allowed => {
    const prepared = preparedContext();
    const { provider, requests } = makeProvider(
      successfulOutputs(
        prepared.initialEvidence,
        prepared.supplementalEvidence,
      ),
    );
    const { selection, option } = selectedOption(provider);
    const confirmConsent = jest.fn(async () => allowed);
    const result = await runVisitQuestionWorkflow({
      prepared,
      request: '합성'.repeat(12_000),
      selection,
      providerOptions: [option],
      recipient: 'Synthetic selected account',
      confirmConsent,
    });
    expect(confirmConsent).toHaveBeenCalled();
    expect(result.status).toBe(allowed ? 'ready' : 'consent_required');
    if (allowed) {
      expect(requests.length).toBeGreaterThan(0);
      expect(jsonByteLength(requests[0])).toBeGreaterThan(65536);
      if (result.status !== 'ready')
        throw new Error('Expected synthetic grounded questions');
      expect(result.questions).toHaveLength(3);
    } else expect(requests).toEqual([]);
  },
);
