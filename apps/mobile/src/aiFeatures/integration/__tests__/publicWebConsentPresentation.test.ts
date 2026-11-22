import { providerFailure } from '@orot/model-runtime';
import { createSettingsConsentAuthorization } from '../../../agent/execution/settingsConsentAuthorization';
import { SETTINGS_CONSENT_CATALOG_VERSION } from '../../../agent/execution/settingsConsentCatalog';
import { settingsSearchGrants } from '../../../agent/execution/settingsSearchGrants';
import { createSettingsConsentStorage } from '../../../storage/settingsConsentStorage';
import { publicEvidenceFixture } from '../testSupport/publicWebEvidenceTestSupport';
import { createPublicWebEvidence } from '../publicWebEvidence';
import { runDefaultPublicSearch } from '../defaultPublicSearch';
import { finishRagConversation } from '../finishRagConversation';
import { openMigrationSqlite } from '../../../../../../packages/storage/__tests__/migrationSqliteDatabase';

test.each([
  ['missing', 'consent_required', 0],
  ['saved', 'success', 1],
  ['stale-credential', 'consent_required', 0],
  ['storage-unavailable', 'consent_required', 0],
  ['provider-unavailable', 'unavailable', 1],
] as const)(
  'presents the settings-approved public search outcome without attributing %s to a missing grant',
  async (scenario, status, calls) => {
    const fixture = publicEvidenceFixture();
    const opened = openMigrationSqlite(':memory:');
    try {
      const { selected, controller } = fixture;
      const identity = {
        providerId: selected.provider.id,
        modelId: selected.modelId,
        recipient: selected.recipient,
        authorityGeneration: 'synthetic-generation',
        credentialEpoch: 'synthetic-credential',
      };
      const token = 'synthetic-settings-token';
      const grants = createSettingsConsentStorage(opened.database);
      const stored = settingsSearchGrants(identity, {
        web: true,
        medical: false,
      })[0]!;
      if (scenario !== 'missing') {
        await grants.stage('conversation', token, stored.grant, stored.domain);
        await grants.activate('conversation', token, () => true, stored.domain);
      }
      // A new reader and authorization object reload the committed store, not a cached grant.
      const reader = createSettingsConsentStorage(opened.database);
      const consent = createSettingsConsentAuthorization({
        catalogVersion: SETTINGS_CONSENT_CATALOG_VERSION,
        resolveOwner: async () => ({
          slot: 'conversation',
          domain: 'public-web',
          identity: {
            ...stored.grant.identity,
            ...(scenario === 'stale-credential'
              ? { credentialEpoch: 'changed' }
              : {}),
          },
          isCurrent: () => true,
        }),
        readGrant: async (slot, domain) => {
          if (scenario === 'storage-unavailable')
            throw Error('Synthetic protected storage error');
          return reader.read(slot, domain);
        },
      });
      if (scenario === 'provider-unavailable') {
        fixture.search.mockResolvedValueOnce(
          providerFailure({
            code: 'provider_unavailable',
            message: 'Synthetic failure',
            retryable: false,
          }),
        );
      }
      const web = createPublicWebEvidence({
        selected,
        consent,
        recoverUnavailable: true,
      });
      const search = await runDefaultPublicSearch({
        tool: web?.tool,
        operationRunId: 'synthetic-public-search',
        request: 'sleep synthetic isolated marker 123',
        signal: controller.signal,
      });
      expect(search.status).toBe(status);
      expect(fixture.search).toHaveBeenCalledTimes(calls);
      if (calls)
        expect(fixture.search.mock.calls[0]?.[0].query).not.toContain(
          'synthetic isolated marker',
        );
      const citations = search.status === 'success' ? search.batch.items : [];
      const answer = await finishRagConversation({
        outcome: {
          status: 'answer',
          answer: 'Synthetic local result',
          citations,
        },
        publicSearch: search,
        continuation: false,
        signal: controller.signal,
        retention: {
          onValidatedEvidence() {},
          async finish(outcome) {
            return { outcome, retained: false };
          },
        },
      });
      if (answer.status !== 'answer')
        throw Error('Synthetic local answer was lost');
      if (status === 'consent_required') {
        expect(answer.answer).toContain('공개 웹검색 동의를 확인하지 못해');
        expect(answer.answer).toContain('모델 설정');
      } else {
        expect(answer.answer).not.toContain('공개 웹검색 동의를 확인하지 못해');
      }
      expect(answer.answer).not.toContain('동의가 없어');
      if (status === 'unavailable')
        expect(answer.answer).toContain('공개 웹검색을 사용할 수 없어');
      if (status === 'success') {
        expect(answer.answer).toBe('Synthetic local result');
        expect(answer.citations).toEqual(citations);
        expect(answer.citations.length).toBeGreaterThan(0);
      }
    } finally {
      opened.close();
    }
  },
);
