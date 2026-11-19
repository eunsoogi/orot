import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Button } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useInferenceConsent } from '../../../agent/execution/useInferenceConsent';
import { createPublicWebEvidence } from '../publicWebEvidence';
import { runDefaultPublicSearch } from '../defaultPublicSearch';
import { resolveSettingsConsentOwner } from '../../../agent/execution/settingsConsentOwner';
import { settingsConsentRepository } from '../../../storage/settingsConsentRepository';
import { publicSearchSettingsPermissions } from '../../../agent/execution/settingsConsentCatalog';
import { t } from '../../../i18n';
import { publicEvidenceFixture } from '../testSupport/publicWebEvidenceTestSupport';

jest.mock('../../../agent/execution/settingsConsentOwner', () => ({
  resolveSettingsConsentOwner: jest.fn(),
}));
jest.mock('../../../storage/settingsConsentRepository', () => ({
  settingsConsentRepository: jest.fn(),
}));

test.each(['missing', 'approved', 'wrong-recipient', 'revoked'] as const)(
  'public search uses the settings grant without a chat modal: %s',
  async state => {
    const fixture = publicEvidenceFixture();
    const onResult = jest.fn();
    let live = true;
    const identity = {
      providerId: fixture.selected.provider.id,
      modelId: fixture.selected.modelId,
      recipient: t('externalMedicalEvidence.publicSearchRecipient', {
        recipient: fixture.selected.recipient,
      }),
      authorityGeneration: 'synthetic-generation',
      credentialEpoch: 'synthetic-credential',
    };
    // Only protected persistence/selected-owner I/O is synthetic; authorization and dispatch stay real.
    jest.mocked(resolveSettingsConsentOwner).mockResolvedValue({
      slot: 'conversation',
      domain: 'public-web',
      identity,
      isCurrent: () => live,
    });
    jest.mocked(settingsConsentRepository).mockResolvedValue({
      read: jest.fn(async () =>
        state === 'missing'
          ? null
          : {
              version: 1,
              catalogVersion: 'model-settings-v1',
              identity: {
                ...identity,
                recipient:
                  state === 'wrong-recipient'
                    ? 'Other recipient'
                    : identity.recipient,
              },
              permissions: [publicSearchSettingsPermissions.web],
            },
      ),
    } as never);
    function Harness() {
      const { consent, disclosureSheet } = useInferenceConsent();
      const web = createPublicWebEvidence({
        selected: fixture.selected,
        consent,
        beforeDispatch: async () => {
          if (state === 'revoked') live = false;
          return true;
        },
      });
      function start() {
        // Leave the screen interactive while its consent decision is pending.
        runDefaultPublicSearch({
          tool: web?.tool,
          operationRunId: 'public-search-screen',
          request: '김테스트 혈압 170/100',
          signal: fixture.controller.signal,
        }).then(onResult);
      }
      return (
        <>
          <Button title="Search" testID="search" onPress={start} />
          {disclosureSheet}
        </>
      );
    }
    const view = await render(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 430, height: 800 },
          insets: { top: 0, right: 0, bottom: 24, left: 0 },
        }}
      >
        <Harness />
      </SafeAreaProvider>,
    );
    await fireEvent.press(view.getByTestId('search'));
    expect(view.queryByTestId('inference-disclosure-sheet')).toBeNull();
    expect(view.queryByText(/김테스트|170\/100/)).toBeNull();
    await waitFor(() =>
      expect(onResult).toHaveBeenCalledWith(
        expect.objectContaining({
          status:
            state === 'approved'
              ? 'success'
              : state === 'revoked'
                ? 'unavailable'
                : 'consent_required',
        }),
      ),
    );
    expect(fixture.search).toHaveBeenCalledTimes(state === 'approved' ? 1 : 0);
    if (state === 'approved') {
      expect(fixture.search.mock.calls[0]![0].query).toBe(
        'General public health information about: blood pressure. Guidelines, associations, possible explanations and limitations.',
      );
      expect(fixture.search.mock.calls[0]![0].query).not.toMatch(
        /김테스트|170\/100/,
      );
    }
  },
);
