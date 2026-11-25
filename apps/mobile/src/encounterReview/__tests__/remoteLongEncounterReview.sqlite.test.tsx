import { resolveSelectedAiProvider } from '../../aiFeatures/integration/provider';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { OutboundProcessingRequest } from '@orot/agent-runtime';
import {
  fixture,
  harness,
  recordingId,
} from '../__fixtures__/longReviewHarness';
import { EncounterReviewPanel } from '../EncounterReviewPanel';
import { reviewCopy } from '../strings';
import {
  isSettingsOnlyExecutionConsent,
  useInferenceConsent,
} from '../../agent/execution/useInferenceConsent';
import { settingsConsentCredential } from '../../agent/execution/settingsConsentCredential';
import { resolveSettingsConsentTarget } from '../../agent/execution/settingsConsentOwner';

jest.mock('../../agent/execution/useInferenceConsent', () => ({
  isSettingsOnlyExecutionConsent: jest.fn(),
  useInferenceConsent: jest.fn(),
}));
jest.mock('../../agent/execution/settingsConsentCredential', () => ({
  settingsConsentCredential: jest.fn(),
}));
jest.mock('../../agent/execution/settingsConsentOwner', () => ({
  resolveSettingsConsentTarget: jest.fn(),
}));

test.each(['save', 'revoked', 'denied', 'late-owner'] as const)(
  'mounted long remote review preserves exact separate authorization and %s',
  async mode => {
    const { choice, service, calls, repository } = await harness(9, 'pcc');
    const evidenceBefore = await repository.list('evidence_span');
    let active = true;
    const listeners = new Set<() => void>();
    const subscribe = (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    };
    const authorized = new WeakSet<OutboundProcessingRequest>();
    let grants = 0;
    const authorize = jest.fn(async (request: OutboundProcessingRequest) => {
      grants++;
      expect(request.providerId).toBe(choice.providerId);
      expect(request.modelId).toBe(choice.modelId);
      expect(request.allowedScope.sourceIds).toEqual([recordingId]);
      if (mode === 'denied' && grants === 2) return 'renewal_required' as const;
      authorized.add(request);
      return 'authorized' as const;
    });
    const consent = {
      authorize,
      isAuthorizationCurrent: (request: OutboundProcessingRequest) =>
        active && authorized.has(request),
      subscribeAuthorizationInvalidation: (
        _: OutboundProcessingRequest,
        listener: () => void,
      ) => subscribe(listener),
    };
    jest
      .mocked(isSettingsOnlyExecutionConsent)
      .mockImplementation(port => port === consent);
    jest
      .mocked(useInferenceConsent)
      .mockReturnValue({ consent, disclosureSheet: null });
    jest.mocked(settingsConsentCredential).mockResolvedValue({
      epoch: 'synthetic-credential',
      isCurrent: () => active,
      subscribe,
    });
    jest.mocked(resolveSettingsConsentTarget).mockResolvedValue({
      slot: 'conversation',
      domain: 'model',
      identity: {
        ...choice,
        recipient: 'synthetic-recipient',
        authorityGeneration: 'synthetic-generation',
        credentialEpoch: 'synthetic-credential',
      },
      isCurrent: () => active,
      subscribeInvalidation: subscribe,
    });
    let receiptWasTentative = false;
    if (mode === 'late-owner') {
      const database = fixture.database();
      const transaction = database.transaction.bind(database);
      jest.spyOn(database, 'transaction').mockImplementation(operation =>
        transaction(tx =>
          operation({
            commit: () => tx.commit(),
            rollback: () => tx.rollback(),
            async execute(query, parameters) {
              const result = await tx.execute(query, parameters);
              if (
                /INSERT\s+INTO\s+healthkit_sync_checkpoints/iu.test(query) &&
                parameters?.some(
                  value =>
                    typeof value === 'string' &&
                    value.startsWith('encounter-approval:'),
                )
              ) {
                receiptWasTentative = true;
                // Invalidate after tentatively writing the receipt, not as
                // early as the UI action or before the storage transaction.
                active = false;
              }
              return result;
            },
          }),
        ),
      );
    }
    const ui = await render(
      <EncounterReviewPanel
        sourceId={recordingId}
        disabled={false}
        service={service}
        onInteractionChange={() => undefined}
      />,
    );
    try {
      await fireEvent.press(screen.getByTestId('encounter-start'));
      if (mode === 'denied')
        expect(
          await screen.findByText(reviewCopy['consent-denied']),
        ).toBeTruthy();
      else expect(await screen.findByTestId('encounter-save')).toBeTruthy();
      expect(await fixture.rows()).toHaveLength(0);
      expect(authorize).toHaveBeenCalledTimes(2);
      expect(calls()).toBe(mode === 'denied' ? 1 : 2);
      if (mode === 'revoked') {
        await act(() => {
          active = false;
          listeners.forEach(listener => listener());
        });
        expect(screen.queryByTestId('encounter-save')).toBeNull();
      } else if (mode === 'save' || mode === 'late-owner') {
        await fireEvent.press(screen.getByTestId('encounter-save'));
        expect(
          await screen.findByText(
            mode === 'late-owner' ? reviewCopy.unavailable : reviewCopy.saved,
          ),
        ).toBeTruthy();
        expect(screen.queryByTestId('encounter-save')).toBeNull();
      }
      expect(await fixture.rows()).toHaveLength(mode === 'save' ? 1 : 0);
      if (mode === 'late-owner') {
        expect(receiptWasTentative).toBe(true);
        expect(await repository.list('evidence_span')).toEqual(evidenceBefore);
        expect(
          (
            await fixture
              .database()
              .execute(
                "SELECT checkpoint_key FROM healthkit_sync_checkpoints WHERE checkpoint_key LIKE 'encounter-approval:%'",
              )
          ).rows,
        ).toEqual([]);
      }
      // Settlement cannot dispatch the selected recording again.
      expect(calls()).toBe(mode === 'denied' ? 1 : 2);
      expect(authorize).toHaveBeenCalledTimes(2);
    } finally {
      await ui.unmount();
    }
  },
);

test('non-PCC retains the existing no-resolution long review limit', async () => {
  const { controller, calls } = await harness(9, 'unsupported');
  const authorize = jest.fn(async () => 'authorized' as const);
  const resolve = jest.mocked(resolveSelectedAiProvider);
  resolve.mockClear();
  try {
    await controller.start({ authorize });
    expect(controller.state.status).toBe('transcript-too-long');
    expect(resolve).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
    expect(calls()).toBe(0);
  } finally {
    controller.dispose();
  }
});
