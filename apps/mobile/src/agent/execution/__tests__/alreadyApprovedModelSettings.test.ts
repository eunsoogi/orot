import { alreadyApprovedModelSettings } from '../alreadyApprovedModelSettings';
import type { ProviderSelectionOption } from '../../../providers/selection/types';
import {
  settingsPermissionsForFeature,
  SETTINGS_CONSENT_CATALOG_VERSION,
} from '../settingsConsentCatalog';
import { settingsSearchGrants } from '../settingsSearchGrants';
import type { SettingsConsentReadServices } from '../SettingsConsentReadServices';
import type { SettingsConsentGrant } from '../settingsConsentGrant';

const identity = {
  providerId: 'openai-api-decisions',
  modelId: 'gpt-6-luna',
  recipient: 'OpenAI API',
  authorityGeneration: 'authority',
  credentialEpoch: 'epoch',
};
const option = {
  provider: { id: identity.providerId },
  modelId: identity.modelId,
  privacyBoundary: 'selected-context-remote',
} as ProviderSelectionOption;

function fixture(slot: 'calendar' | 'conversation') {
  const grant: SettingsConsentGrant = {
    version: 1,
    catalogVersion: SETTINGS_CONSENT_CATALOG_VERSION,
    identity,
    permissions: settingsPermissionsForFeature(slot, identity.providerId),
  };
  const byDomain = new Map<string, SettingsConsentGrant>([['model', grant]]);
  let authorized = true,
    epoch = 'epoch';
  const resolveTarget = jest.fn(
    async (
      ...[_slot, domain, request]: Parameters<
        NonNullable<SettingsConsentReadServices['resolveTarget']>
      >
    ) => ({
      slot,
      domain,
      identity: {
        ...identity,
        providerId: request.providerId,
        modelId: request.modelId,
        recipient: request.recipient,
        credentialEpoch: epoch,
      },
      isCurrent: () => authorized,
    }),
  );
  return {
    revoke: () => {
      authorized = false;
    },
    swap: () => {
      epoch = 'new-epoch';
    },
    input: {
      slot,
      option,
      signal: new AbortController().signal,
      isCurrent: () => true,
      services: {
        resolveOwner: jest.fn(),
        resolveTarget,
        readGrant: jest.fn(
          async (
            ...[_slot, domain]: Parameters<
              SettingsConsentReadServices['readGrant']
            >
          ) => byDomain.get(domain) ?? null,
        ),
      },
    },
    grant,
    byDomain,
  };
}

test('skips only complete active calendar permission; changed identity or scope requires review', async () => {
  const f = fixture('calendar');
  await expect(alreadyApprovedModelSettings(f.input)).resolves.toBe(true);
  f.byDomain.set('model', { ...f.grant, catalogVersion: 'old' });
  await expect(alreadyApprovedModelSettings(f.input)).resolves.toBe(false);
  f.byDomain.set('model', f.grant);
  f.swap();
  await expect(alreadyApprovedModelSettings(f.input)).resolves.toBe(false);
});

test('search domains selected and deselected both compare exact independent rows', async () => {
  const f = fixture('conversation');
  await expect(alreadyApprovedModelSettings(f.input)).resolves.toBe(true);
  const search = { web: true, medical: true };
  await expect(
    alreadyApprovedModelSettings({ ...f.input, search }),
  ).resolves.toBe(false);
  for (const row of settingsSearchGrants(identity, search))
    f.byDomain.set(row.domain, row.grant);
  await expect(
    alreadyApprovedModelSettings({ ...f.input, search }),
  ).resolves.toBe(true);
  await expect(
    alreadyApprovedModelSettings({
      ...f.input,
      search: { ...search, medical: false },
    }),
  ).resolves.toBe(false);
  f.revoke();
  await expect(
    alreadyApprovedModelSettings({ ...f.input, search }),
  ).resolves.toBe(false);
});
