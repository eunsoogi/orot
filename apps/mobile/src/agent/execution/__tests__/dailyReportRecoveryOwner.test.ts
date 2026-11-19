import {
  fixture,
  mockSelection,
  setSelected,
} from '../testSupport/dailyRecoveryOwnerFixture';
import { createDailyReportLocalRecovery } from '../../../storage/dailyReportLocalRecovery';
import { readDailyReportRecoveryOwner } from '../dailyReportRecoveryOwner';
import { createConsentAuthority } from '../consentAuthority';
import { settingsConsentAuthority } from '../../../storage/settingsConsentAuthority';
import { settingsConsentRepository } from '../../../storage/settingsConsentRepository';
import { settingsConsentCredential } from '../settingsConsentCredential';
test('reads a real SQL grant without provider/authorize and rebuilds authority after owner restart', async () => {
  const f = await fixture();
  try {
    const first = await readDailyReportRecoveryOwner(
      f.candidate,
      new AbortController().signal,
      f.scope,
    );
    expect(first?.isCurrent()).toBe(true);
    const recovery = createDailyReportLocalRecovery(f.db.database);
    expect(
      await recovery.stage(f.candidate, first!, new AbortController().signal),
    ).toEqual({ status: 'staged' });
    const restarted = createConsentAuthority(f.backing, () => 'b'.repeat(64));
    jest.mocked(settingsConsentAuthority).mockReturnValue(restarted);
    const second = await readDailyReportRecoveryOwner(
      f.candidate,
      new AbortController().signal,
      f.scope,
    );
    expect(second?.identity).toEqual(first?.identity);
    expect(second?.isCurrent()).toBe(true);
    expect(
      await recovery.resume(
        f.candidate.runId,
        second!,
        new AbortController().signal,
      ),
    ).toEqual({ status: 'saved' });
    expect(settingsConsentCredential).toHaveBeenLastCalledWith(
      'openai-api-decisions',
      false,
    );
  } finally {
    f.db.close();
  }
});

test.each(['selection', 'credential', 'authority', 'abort'] as const)(
  'live %s invalidation reaches the owner subscriber',
  async kind => {
    const f = await fixture();
    const controller = new AbortController();
    try {
      const owner = await readDailyReportRecoveryOwner(
        f.candidate,
        controller.signal,
        f.scope,
      );
      expect(owner).not.toBeNull();
      const listener = jest.fn();
      const stop = owner!.subscribeInvalidation(listener);
      if (kind === 'selection') mockSelection.begin()();
      if (kind === 'credential') f.credential.begin()();
      if (kind === 'authority') await f.authority.suspend();
      if (kind === 'abort') controller.abort();
      expect(owner!.isCurrent()).toBe(false);
      expect(listener).toHaveBeenCalled();
      stop();
    } finally {
      f.db.close();
    }
  },
);

test.each([
  'purpose',
  'category',
  'kind',
  'epoch',
  'recipient',
  'catalog',
  'model',
  'missing',
] as const)(
  'fails closed for mismatched %s, never serialized authority',
  async mismatch => {
    const f = await fixture();
    try {
      const grant = JSON.parse(JSON.stringify(f.grant));
      if (mismatch === 'purpose')
        grant.permissions = grant.permissions.filter(
          (p: { purpose: string }) => p.purpose !== 'daily_report',
        );
      if (mismatch === 'category')
        grant.permissions = [
          {
            purpose: 'daily_report',
            policyVersion: 'daily-report-analysis-v2',
            dataCategories: ['calendar_plans'],
            sourceKinds: ['personal_record'],
          },
        ];
      if (mismatch === 'kind')
        grant.permissions = [
          {
            purpose: 'daily_report',
            policyVersion: 'daily-report-analysis-v2',
            dataCategories: ['health_records'],
            sourceKinds: ['reviewed_memory'],
          },
        ];
      if (mismatch === 'epoch') grant.identity.credentialEpoch = 'other';
      if (mismatch === 'recipient') grant.identity.recipient = 'other';
      if (mismatch === 'catalog') grant.catalogVersion = 'other';
      if (mismatch === 'model')
        setSelected({ providerId: 'openai-api-decisions', modelId: 'other' });
      await f.db.database.execute(
        'UPDATE settings_inference_grants SET grant_json = ?',
        [JSON.stringify(grant)],
      );
      if (mismatch === 'missing') await f.grants.clear();
      expect(
        await readDailyReportRecoveryOwner(
          f.candidate,
          new AbortController().signal,
          f.scope,
        ),
      ).toBeNull();
    } finally {
      f.db.close();
    }
  },
);

test('storage failure, suspended authority and mid-read revocation never issue a witness', async () => {
  const f = await fixture();
  try {
    jest
      .mocked(settingsConsentRepository)
      .mockRejectedValueOnce(new Error('SQL unavailable'));
    expect(
      await readDailyReportRecoveryOwner(
        f.candidate,
        new AbortController().signal,
        f.scope,
      ),
    ).toBeNull();
    const read = f.grants.read.bind(f.grants);
    jest.spyOn(f.grants, 'read').mockImplementation(async (...args) => {
      const result = await read(...args);
      await f.authority.suspend();
      return result;
    });
    expect(
      await readDailyReportRecoveryOwner(
        f.candidate,
        new AbortController().signal,
        f.scope,
      ),
    ).toBeNull();
    expect(
      await readDailyReportRecoveryOwner(
        f.candidate,
        new AbortController().signal,
        f.scope,
      ),
    ).toBeNull();
  } finally {
    f.db.close();
  }
});
