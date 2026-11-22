import { NativeModules } from 'react-native';
import {
  fixture,
  output,
  supported,
  unsupported,
} from '../testing/numericCorrectionFixtures';
import { makeProvider, selectedOption } from '../testing/workflowFixtures';
import { runVisitQuestionWorkflow } from '../workflow';

test.each([true, false])(
  'attributes the one-shot correction separately while fresh consent is held (grant: %s)',
  async grant => {
    const f = await fixture();
    const original = NativeModules.OrotProviderDiagnostics;
    const report = jest.fn();
    NativeModules.OrotProviderDiagnostics = { report };
    let enterCorrection!: () => void;
    const entered = new Promise<void>(resolve => {
      enterCorrection = resolve;
    });
    let settleConsent!: (authorized: boolean) => void;
    const heldConsent = new Promise<boolean>(resolve => {
      settleConsent = resolve;
    });
    const { provider, requests } = makeProvider([
      output(unsupported),
      output(supported),
    ]);
    const { selection, option } = selectedOption(provider);
    let approvals = 0;
    const pending = runVisitQuestionWorkflow({
      prepared: f.context,
      selection,
      providerOptions: [option],
      recipient: 'Synthetic selected account',
      confirmConsent: async () => {
        if (++approvals === 1) return true;
        enterCorrection();
        return heldConsent;
      },
    });
    const relevantStages = () =>
      report.mock.calls.filter(
        ([feature, stage]) =>
          feature === 'visit' &&
          ['consent_wait', 'provider_wait', 'response_correction'].includes(
            stage,
          ),
      );
    try {
      // Observe the real consent pause rather than simulate elapsed time.
      await Promise.race([entered, pending]);
      const expectedStart = [
        ['visit', 'consent_wait', 'started'],
        ['visit', 'consent_wait', 'completed'],
        ['visit', 'provider_wait', 'started'],
        ['visit', 'provider_wait', 'completed'],
        ['visit', 'response_correction', 'started'],
        ['visit', 'consent_wait', 'started'],
      ];
      expect(relevantStages()).toEqual(expectedStart);
      expect(requests).toHaveLength(1);
      settleConsent(grant);
      expect((await pending).status).toBe(grant ? 'ready' : 'consent_required');
      expect(relevantStages()).toEqual([
        ...expectedStart,
        ['visit', 'consent_wait', 'completed'],
        ...(grant
          ? [
              ['visit', 'provider_wait', 'started'],
              ['visit', 'provider_wait', 'completed'],
            ]
          : []),
        ['visit', 'response_correction', 'completed'],
      ]);
      expect(approvals).toBe(2);
      expect(requests).toHaveLength(grant ? 2 : 1);
    } finally {
      settleConsent(false);
      await pending.catch(() => undefined);
      NativeModules.OrotProviderDiagnostics = original;
      f.close();
    }
  },
);
