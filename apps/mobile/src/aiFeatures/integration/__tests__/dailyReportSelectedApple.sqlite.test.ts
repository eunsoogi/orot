import { AppleFoundationModelsProvider } from '@orot/provider-apple';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createSettingsConsentAuthorization } from '../../../agent/execution/settingsConsentAuthorization';
import {
  SETTINGS_CONSENT_CATALOG_VERSION,
  settingsPermissionsForFeature,
} from '../../../agent/execution/settingsConsentCatalog';
import { createDailyReportService } from '../dailyReportService';
import { createSettingsConsentStorage } from '../../../storage/settingsConsentStorage';
import {
  prepareReportDatabase,
  reportRequest,
} from '../testSupport/dailyReportFailureStageFixtures';

test.each(['on-device', 'approved-pcc', 'missing-pcc'] as const)(
  'uses the actual Daily Report scope for selected Apple route %s',
  async mode => {
    const connection = openSqliteTestDatabase(':memory:');
    try {
      await prepareReportDatabase(connection.database);
      const remoteProcessing = mode !== 'on-device';
      const response = {
        text: '{"indexes":[0]}',
        toolCalls: [],
        finishReason: 'complete' as const,
      };
      const stream = jest.fn(async function* () {
        yield { type: 'completed' as const, response };
      });
      const provider = new AppleFoundationModelsProvider(
        {
          getAvailability: async () => ({ status: 'available' }),
          generate: async () => response,
          stream,
          cancel: jest.fn(),
        },
        remoteProcessing ? 'private-cloud-compute' : 'on-device',
      );
      const modelId = remoteProcessing
        ? 'apple-private-cloud-compute-default'
        : 'apple-foundation-models-system-default';
      const recipient = remoteProcessing
        ? 'Apple Private Cloud Compute'
        : 'on-device';
      const identity = {
        providerId: provider.id,
        modelId,
        recipient,
        authorityGeneration: 'synthetic-settings-generation',
        credentialEpoch: 'apple-platform-pcc-v1',
      };
      const grants = createSettingsConsentStorage(connection.database);
      if (mode === 'approved-pcc') {
        const token = 'synthetic-activation-017';
        await grants.stage('conversation', token, {
          version: 1,
          catalogVersion: SETTINGS_CONSENT_CATALOG_VERSION,
          identity,
          permissions: settingsPermissionsForFeature(
            'conversation',
            provider.id,
          ),
        });
        await grants.activate('conversation', token, () => true);
      }
      const resolveOwner = jest.fn(async () => ({
        slot: 'conversation' as const,
        domain: 'model' as const,
        identity,
        isCurrent: () => true,
      }));
      const consent = createSettingsConsentAuthorization({
        catalogVersion: SETTINGS_CONSENT_CATALOG_VERSION,
        resolveOwner,
        readGrant: grants.read,
      });
      const authorize = jest.spyOn(consent, 'authorize');
      const service = createDailyReportService({
        database: connection.database,
        consent,
        now: () => '2035-01-01T12:00:00Z',
        createRunId: () => 'synthetic-daily-run',
        resolveSelected: async () => ({
          status: 'ready',
          provider,
          modelId,
          recipient,
          remoteProcessing,
          selection: { providerId: provider.id, modelId },
          option: {
            provider,
            modelId,
            displayName: 'Synthetic Apple',
            privacyBoundary: remoteProcessing
              ? 'selected-context-remote'
              : 'on-device',
            availability: { status: 'available' },
          },
        }),
      });
      const result = await service(reportRequest());
      if (mode === 'missing-pcc') {
        expect(result).toEqual({ status: 'failed', code: 'consent_required' });
        expect(stream).not.toHaveBeenCalled();
      } else {
        expect(result.status).toBe('completed');
        expect(stream).toHaveBeenCalledTimes(1);
      }
      if (remoteProcessing) {
        expect(authorize).toHaveBeenCalledWith(
          expect.objectContaining({
            providerId: provider.id,
            recipient,
            remoteProcessing: true,
            consentScope: expect.objectContaining({ purpose: 'daily_report' }),
          }),
        );
      } else {
        expect(authorize).not.toHaveBeenCalled();
        expect(resolveOwner).not.toHaveBeenCalled();
      }
    } finally {
      connection.close();
    }
  },
);
