import {
  sqliteEncounterFixture,
  sourceId,
} from '../../agent/encounter/__fixtures__/sqliteFixture';
import { syntheticEncounterModel } from '../../agent/encounter/syntheticFixture';
import { openLocalStorage } from '../../storage/secureDatabase';
import { createEncounterReviewService } from '../service';
import type { SelectedAiResolution } from '../../aiFeatures/integration/provider';

jest.mock('../../aiFeatures/integration/provider', () => ({
  resolveSelectedAiProvider: jest.fn(),
}));
const fixture = sqliteEncounterFixture();
beforeEach(() => {
  jest.mocked(openLocalStorage).mockResolvedValue(fixture.repository());
  const secure = require('../../storage/secureDatabase');
  secure.openLocalAgentMemoryDatabase = jest.fn(async () => fixture.database());
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: {
      getRandomValues: (bytes: Uint8Array) =>
        require('node:crypto').randomFillSync(bytes),
    },
  });
});

test('actual recording review service preserves the live settings fence through model composition', async () => {
  const synthetic = syntheticEncounterModel(sourceId, true);
  const resolve = async (): Promise<SelectedAiResolution> => ({
    status: 'ready',
    selection: {
      providerId: synthetic.model.provider.id,
      modelId: 'synthetic-model',
    },
    option: {
      provider: synthetic.model.provider,
      modelId: 'synthetic-model',
      displayName: 'Synthetic',
      privacyBoundary: 'selected-context-remote',
      availability: { status: 'available' },
    },
    provider: synthetic.model.provider,
    modelId: 'synthetic-model',
    recipient: 'Synthetic',
    remoteProcessing: true,
  });
  const consent = {
    authorize: jest.fn(async () => 'authorized' as const),
    isAuthorizationCurrent: jest.fn(() => false),
  };
  const result = await createEncounterReviewService(resolve).start(
    sourceId,
    consent,
    new AbortController().signal,
  );
  expect(result.status).toBe('consent-denied');
  expect(consent.authorize).toHaveBeenCalled();
  expect(consent.isAuthorizationCurrent).toHaveBeenCalled();
  expect(synthetic.calls()).toBe(0);
  expect(await fixture.repository().list('health_observation')).toHaveLength(0);
});
