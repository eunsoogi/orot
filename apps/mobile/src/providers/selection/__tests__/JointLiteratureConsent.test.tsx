import { openSavedWebSettingsFixture } from '../testSupport/SavedWebSearchRoundTrip.fixture';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { createEuropePmcEvidenceSearchTool } from '@orot/agent-runtime';
import { calendarModelStore } from '../../../calendarModelSettings/calendarModelStore';
import { createSettingsConsentAuthorization } from '../../../agent/execution/settingsConsentAuthorization';
import { SETTINGS_CONSENT_CATALOG_VERSION } from '../../../agent/execution/settingsConsentCatalog';
import { publicMedicalQueryConsent } from '../../../agent/execution/publicMedicalQueryConsent';
import { resolveSettingsConsentOwner } from '../../../agent/execution/settingsConsentOwner';
import { saveModelSettingsConsent } from '../../../agent/execution/saveModelSettingsConsent';
import { providerSelectionStore } from '../keychainSelectionStore';

test('one explicit model settings approval grants literature search for its separate recipient', async () => {
  const fixture = openSavedWebSettingsFixture();
  const { sql, selection, recipient, reloaded, selectionView, commit } =
    fixture;
  const search = jest.fn(async () => ({ status: 'empty' as const }));
  const consent = createSettingsConsentAuthorization({
    catalogVersion: SETTINGS_CONSENT_CATALOG_VERSION,
    resolveOwner: resolveSettingsConsentOwner,
    readGrant: reloaded.read,
  });
  const tool = createEuropePmcEvidenceSearchTool({
    consent: publicMedicalQueryConsent(consent),
    service: { search },
  });
  const signal = new AbortController().signal;
  const request = {
    operationRunId: 'synthetic-literature',
    operationKey: 'paper-search',
    input: { query: 'sleep randomized review' },
    allowedScope: { sourceKinds: ['external_medical' as const] },
    maxPayloadBytes: 2048,
    resultLimit: 2,
    signal,
  };
  try {
    await saveModelSettingsConsent({
      slot: 'calendar',
      selection: fixture.calendarChoice,
      recipient: 'OpenAI API',
      remote: true,
      store: calendarModelStore,
      signal,
      isCurrent: () => true,
    });
    await saveModelSettingsConsent({
      slot: 'conversation',
      selection,
      recipient,
      remote: true,
      search: { web: true, medical: false },
      store: providerSelectionStore,
      signal,
      isCurrent: () => true,
    });
    const oldWeb = await reloaded.read('conversation', 'public-web');
    expect(oldWeb).not.toBeNull();
    const oldCalendar = await reloaded.read('calendar');
    expect(oldCalendar).not.toBeNull();
    expect(await tool.search(request)).toEqual({ status: 'consent_required' });
    expect(search).not.toHaveBeenCalled();
    const view = await render(selectionView());
    try {
      const press = (id: string) => fireEvent.press(view.getByTestId(id));
      await press('provider-option-0');
      expect(view.queryByTestId('settings-consent-medical')).toBeNull();
      await waitFor(() =>
        expect(view.getByTestId('provider-selection-confirm')).toBeEnabled(),
      );
      await press('provider-selection-confirm');
      expect(
        await view.findByTestId('inference-disclosure-scope'),
      ).toHaveTextContent(
        /건강 기록[\s\S]+공개 웹검색[\s\S]+캘린더 일정 제목과 시간[\s\S]+Europe PMC[\s\S]+의학 문헌/,
      );
      expect(await reloaded.read('conversation', 'medical-search')).toBeNull();
      await press('inference-disclosure-cancel');
      expect(await reloaded.read('conversation', 'public-web')).toEqual(oldWeb);
      expect(await reloaded.read('calendar')).toEqual(oldCalendar);
      expect(await tool.search(request)).toEqual({
        status: 'consent_required',
      });
      expect(search).not.toHaveBeenCalled();
      await press('provider-selection-confirm');
      await fireEvent.press(
        await view.findByTestId('inference-disclosure-allow'),
      );
      await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
      const medical = await reloaded.read('conversation', 'medical-search');
      const web = await reloaded.read('conversation', 'public-web');
      expect(medical).toMatchObject({
        identity: {
          providerId: 'europe-pmc',
          modelId: 'public-medical-search',
          recipient: 'Europe PMC',
          credentialEpoch: web?.identity.credentialEpoch,
          authorityGeneration: web?.identity.authorityGeneration,
        },
        permissions: [
          {
            purpose: 'public_medical_search',
            policyVersion: 'public-query-v1',
            dataCategories: ['medical_search_terms'],
            sourceKinds: ['external_medical'],
          },
        ],
      });
      expect(web?.identity.providerId).toBe(selection.providerId);
      expect(await reloaded.read('calendar')).not.toBeNull();
      expect(await tool.search(request)).toMatchObject({ items: [] });
      expect(search).toHaveBeenCalledTimes(1);
      expect(search).toHaveBeenCalledWith(
        request.input.query,
        expect.objectContaining({
          externalQueryConsented: true,
        }),
      );
      expect(fixture.execution.search).not.toHaveBeenCalled();
      await fixture.calendarAuthority.revoke();
      expect(await tool.search(request)).toMatchObject({ items: [] });
      expect(search).toHaveBeenCalledTimes(2);
      const changedSelection = await tool.prepareAuthorizedSearch!(request);
      if (changedSelection.status !== 'authorized')
        throw new Error('Expected current search');
      await providerSelectionStore.save({
        ...selection,
        modelId: 'synthetic-replaced-model',
      });
      expect(await changedSelection.dispatch()).toEqual({
        status: 'consent_required',
      });
      expect(search).toHaveBeenCalledTimes(2);
      await providerSelectionStore.save(selection);
      const prepared = await tool.prepareAuthorizedSearch!(request);
      expect(prepared.status).toBe('authorized');
      if (prepared.status !== 'authorized')
        throw new Error('Expected authorized search');
      await act(async () => {
        await fixture.authority.revoke();
      });
      expect(await prepared.dispatch()).toEqual({ status: 'consent_required' });
      expect(search).toHaveBeenCalledTimes(2);
    } finally {
      await view.unmount();
    }
  } finally {
    sql.close();
  }
});
