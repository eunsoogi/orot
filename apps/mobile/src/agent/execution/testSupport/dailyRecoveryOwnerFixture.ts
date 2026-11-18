import { createDailyReportCalendarWindow } from '../../../healthEvidence/healthContext/dailyReportWindow';

import { createCredentialMutationOwner } from '../credentialMutation';
import { createConsentAuthority } from '../consentAuthority';
import { createSettingsConsentStorage } from '../../../storage/settingsConsentStorage';
import {
  settingsPermissionsForFeature,
  SETTINGS_CONSENT_CATALOG_VERSION,
} from '../settingsConsentCatalog';
import { settingsConsentAuthority } from '../../../storage/settingsConsentAuthority';
import { settingsConsentRepository } from '../../../storage/settingsConsentRepository';
import { settingsConsentCredential } from '../settingsConsentCredential';
import { dailyReportRecoveryFixture } from '../../../storage/testSupport/dailyReportRecoveryFixture';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';

export const mockSelection = createCredentialMutationOwner();
let mockSelected = {
  providerId: 'openai-api-decisions',
  modelId: 'synthetic-model',
};
jest.mock('../../../providers/selection/keychainSelectionStore', () => ({
  providerSelectionStore: {
    load: async () => mockSelected,
    liveWitness: () => mockSelection.capture(),
    subscribeChanges: (f: () => void) => mockSelection.subscribe(f),
  },
}));
jest.mock('../settingsConsentCredential', () => ({
  settingsConsentCredential: jest.fn(),
}));
jest.mock('../../../storage/settingsConsentAuthority', () => ({
  settingsConsentAuthority: jest.fn(),
}));
jest.mock('../../../storage/settingsConsentRepository', () => ({
  settingsConsentRepository: jest.fn(),
}));
jest.mock('../../../aiFeatures/integration/provider', () => ({
  resolveSelectedAiProvider: () => {
    throw new Error('Provider resolution forbidden');
  },
}));
jest.mock('../settingsConsentAuthorization', () => ({
  createSettingsConsentAuthorization: () => {
    throw new Error('Authorization forbidden');
  },
}));

export async function fixture() {
  mockSelected = {
    providerId: 'openai-api-decisions',
    modelId: 'synthetic-model',
  };
  const db = openSqliteTestDatabase(':memory:');
  const original = await dailyReportRecoveryFixture(db.database);
  const candidate = {
    ...original.candidate,
    context: { ...original.candidate.context, provider: { ...mockSelected } },
  };
  let state: unknown = null;
  const backing = {
    read: async () => state,
    write: async (s: unknown) => {
      state = s;
    },
  };
  const authority = createConsentAuthority(backing, () => 'a'.repeat(64));
  const active = await authority.activate();
  if (!active) throw new Error('Expected active authority');
  const credential = createCredentialMutationOwner();
  jest.mocked(settingsConsentAuthority).mockReturnValue(authority);
  jest.mocked(settingsConsentCredential).mockImplementation(async () => ({
    epoch: 'synthetic-epoch',
    isCurrent: credential.capture()!,
    subscribe: credential.subscribe,
  }));
  const grants = createSettingsConsentStorage(db.database);
  jest.mocked(settingsConsentRepository).mockResolvedValue(grants);
  const grant = {
    version: 1 as const,
    catalogVersion: SETTINGS_CONSENT_CATALOG_VERSION,
    identity: {
      ...mockSelected,
      recipient: 'OpenAI API',
      authorityGeneration: active.generation,
      credentialEpoch: 'synthetic-epoch',
    },
    permissions: settingsPermissionsForFeature('conversation'),
  };
  await grants.stage('conversation', 't'.repeat(32), grant);
  await grants.activate('conversation', 't'.repeat(32), () => true);
  const calendar = createDailyReportCalendarWindow({
    localDate: '2035-01-01',
    timeZone: 'UTC',
    requestedAt: '2035-01-01T12:00:00Z',
  });
  if (calendar.status !== 'ready') throw new Error('Invalid fixture calendar');
  let target = {
    ownerId: 'active-request',
    runId: candidate.runId,
    window: calendar.context,
  };
  const listeners = new Set<() => void>();
  const scope = {
    current: () => target,
    subscribeChanges(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  const changeTarget = (next: typeof target) => {
    target = next;
    for (const l of listeners) l();
  };
  return {
    db,
    candidate,
    authority,
    backing,
    credential,
    grants,
    grant,
    scope,
    changeTarget,
    subscriberCount: () => listeners.size,
  };
}

export const setSelected = (value: typeof mockSelected) => {
  mockSelected = value;
};
