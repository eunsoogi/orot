import { openSavedWebSettingsFixture } from '../testSupport/SavedWebSearchRoundTrip.fixture';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { setGenericPassword } from 'react-native-keychain';
import { calendarModelStore } from '../../../calendarModelSettings/calendarModelStore';
import { saveModelSettingsConsent } from '../../../agent/execution/saveModelSettingsConsent';
import { providerSelectionStore } from '../keychainSelectionStore';

test.each([
  { hasCalendar: false, branch: 'same' },
  { hasCalendar: true, branch: 'same' },
  { hasCalendar: true, branch: 'first-time' },
  { hasCalendar: true, branch: 'changed' },
])(
  'one combined approval (Calendar: $hasCalendar, Conversation: $branch)',
  async ({ hasCalendar, branch }) => {
    const {
      sql,
      execution,
      selection,
      recipient,
      commit,
      credential,
      authority,
      calendarAuthority,
      classifyProviderCall,
      calendarChoice,
      selectionView,
      reloaded,
      run,
      classify,
      setEpoch,
    } = openSavedWebSettingsFixture();
    try {
      jest.mocked(setGenericPassword).mockClear();
      if (hasCalendar) await calendarModelStore.save(calendarChoice);
      const priorChoice =
        branch === 'first-time'
          ? null
          : branch === 'changed'
            ? {
                providerId: selection.providerId,
                modelId: 'synthetic-prior-model',
              }
            : selection;
      // Legacy users have a model-only grant; first-time setup has no model.
      if (priorChoice)
        await saveModelSettingsConsent({
          slot: 'conversation',
          selection: priorChoice,
          recipient,
          remote: true,
          store: providerSelectionStore,
          signal: new AbortController().signal,
          isCurrent: () => true,
        });
      const legacy = await reloaded.read('conversation');
      expect(Boolean(legacy)).toBe(Boolean(priorChoice));
      expect(await reloaded.read('conversation', 'public-web')).toBeNull();
      expect((await run('legacy-model-only')).search.status).toBe(
        'consent_required',
      );

      if (hasCalendar)
        expect((await classify()).failure?.status).toBe('consent_required');
      expect(classifyProviderCall).not.toHaveBeenCalled();
      const view = await render(selectionView());
      const press = (id: string) => fireEvent.press(view.getByTestId(id));
      expect(
        view.queryByTestId('settings-provider-review-web-search'),
      ).toBeNull();
      await press('provider-option-0');
      expect(view.queryByTestId('settings-consent-web')).toBeNull();
      await waitFor(() =>
        expect(view.getByTestId('provider-selection-confirm')).toBeEnabled(),
      );
      await press('provider-selection-confirm');
      await waitFor(() =>
        expect(
          view.getByTestId('inference-disclosure-scope'),
        ).toHaveTextContent(/건강 기록[\s\S]+공개 웹검색/),
      );
      if (hasCalendar)
        expect(
          view.getByTestId('inference-disclosure-scope'),
        ).toHaveTextContent(
          /OpenAI API의 gpt-6-luna[\s\S]+캘린더 일정 제목과 시간만/,
        );
      else
        expect(
          view.getByTestId('inference-disclosure-scope'),
        ).not.toHaveTextContent(/캘린더 일정 제목과 시간만/);
      expect(
        view.getByTestId('inference-disclosure-scope'),
      ).not.toHaveTextContent(/Europe PMC/);
      expect(await reloaded.read('conversation', 'public-web')).toBeNull();
      expect(await reloaded.read('calendar')).toBeNull();
      await press('inference-disclosure-cancel');
      expect(await reloaded.read('conversation')).toEqual(legacy);
      expect(await providerSelectionStore.load()).toEqual(priorChoice);
      expect(await reloaded.read('conversation', 'public-web')).toBeNull();
      await press('provider-selection-confirm');
      await waitFor(() =>
        expect(view.getByTestId('inference-disclosure-allow')).toBeEnabled(),
      );
      await press('inference-disclosure-allow');
      await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
      const saved = await reloaded.read('conversation', 'public-web');
      expect(saved?.permissions[0]?.purpose).toBe('public_web_search');
      expect(saved?.identity.authorityGeneration).toBe(
        (await reloaded.read('conversation'))?.identity.authorityGeneration,
      );
      expect(await reloaded.read('conversation', 'medical-search')).toBeNull();
      if (hasCalendar) {
        const calendarGrant = await reloaded.read('calendar');
        expect(calendarGrant?.identity).toMatchObject({
          providerId: 'openai-api-decisions',
          modelId: 'gpt-6-luna',
          recipient: 'OpenAI API',
        });
        expect(calendarGrant?.permissions).toEqual([
          {
            purpose: 'calendar_classification',
            policyVersion: 'upcoming-year-v1',
            dataCategories: ['calendar_title_time'],
            sourceKinds: ['personal_record'],
          },
        ]);
        expect((await classify()).status).toBe('complete');
        expect(classifyProviderCall).toHaveBeenCalledTimes(1);
      }
      await view.unmount();

      const resumed = await render(selectionView());
      await fireEvent.press(resumed.getByTestId('provider-option-0'));
      await waitFor(() =>
        expect(resumed.getByTestId('provider-selection-confirm')).toBeEnabled(),
      );
      await fireEvent.press(resumed.getByTestId('provider-selection-confirm'));
      await waitFor(() => expect(commit).toHaveBeenCalledTimes(2));
      expect(resumed.queryByTestId('inference-disclosure-allow')).toBeNull();
      expect(await reloaded.read('conversation', 'public-web')).toEqual(saved);
      expect(setGenericPassword).toHaveBeenCalledTimes(
        branch === 'changed' ? 3 : 2,
      );
      expect(await providerSelectionStore.load()).toEqual(selection);
      await resumed.unmount();

      const success = await run('exact-approved');
      expect(success.search.status).toBe('success');
      expect(execution.search).toHaveBeenCalledTimes(1);
      expect(execution.search.mock.calls[0]?.[0].query).not.toContain(
        'do not send',
      );
      expect(success.answer).toMatchObject({
        status: 'answer',
        answer: 'Synthetic answer',
        citations: [
          expect.objectContaining({ sourceKind: 'external_medical' }),
        ],
      });
      const finish = credential.begin();
      setEpoch('epoch-two');
      finish();
      expect((await run('changed-credential')).search.status).toBe(
        'consent_required',
      );
      expect(execution.search).toHaveBeenCalledTimes(1);
      setEpoch('epoch-one');
      if (hasCalendar) {
        setEpoch('epoch-one');
        await calendarAuthority.revoke();
        expect((await classify()).failure?.status).toBe('consent_required');
        expect(classifyProviderCall).toHaveBeenCalledTimes(1);
      }
      await authority.revoke();
      expect((await run('revoked-authority')).search.status).toBe(
        'consent_required',
      );
      expect(execution.search).toHaveBeenCalledTimes(1);
    } finally {
      sql.close();
    }
  },
);
