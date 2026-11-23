import {
  fixture,
  mockSelection,
} from '../testSupport/dailyRecoveryOwnerFixture';
import { settingsConsentCredential } from '../settingsConsentCredential';
import { readDailyReportWarmSettingsOwner } from '../dailyReportWarmSettingsOwner';

test.each(['selection', 'credential', 'authority', 'abort'] as const)(
  'live protected Daily grant retires on %s without provider resolution',
  async boundary => {
    const f = await fixture();
    const controller = new AbortController();
    try {
      const read = () =>
        readDailyReportWarmSettingsOwner(
          'openai-api-decisions',
          'synthetic-model',
          'OpenAI API',
          controller.signal,
        );
      const owner = await read();
      expect(owner?.isCurrent()).toBe(true);
      expect(settingsConsentCredential).toHaveBeenLastCalledWith(
        'openai-api-decisions',
        false,
      );
      if (boundary === 'selection') mockSelection.begin()();
      if (boundary === 'credential') f.credential.begin()();
      if (boundary === 'authority') await f.authority.suspend();
      if (boundary === 'abort') controller.abort();
      expect(owner?.isCurrent()).toBe(false);
    } finally {
      f.db.close();
    }
  },
);

test('declines wrong recipient, wrong model, and a saved non-Daily grant', async () => {
  const f = await fixture();
  const signal = new AbortController().signal;
  try {
    expect(
      await readDailyReportWarmSettingsOwner(
        'openai-api-decisions',
        'synthetic-model',
        'wrong',
        signal,
      ),
    ).toBeNull();
    expect(
      await readDailyReportWarmSettingsOwner(
        'openai-api-decisions',
        'wrong',
        'OpenAI API',
        signal,
      ),
    ).toBeNull();
    const token = 's'.repeat(32);
    await f.grants.stage('conversation', token, {
      ...f.grant,
      permissions: f.grant.permissions.filter(
        permission => permission.purpose !== 'daily_report',
      ),
    });
    await f.grants.activate('conversation', token, () => true);
    expect(
      await readDailyReportWarmSettingsOwner(
        'openai-api-decisions',
        'synthetic-model',
        'OpenAI API',
        signal,
      ),
    ).toBeNull();
  } finally {
    f.db.close();
  }
});
