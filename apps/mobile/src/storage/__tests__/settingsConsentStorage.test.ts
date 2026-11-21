import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createSettingsConsentStorage } from '../settingsConsentStorage';
import type { SettingsConsentGrant } from '../../agent/execution/settingsConsentGrant';

const grant: SettingsConsentGrant = {
  version: 1,
  catalogVersion: 'synthetic-v1',
  identity: {
    providerId: 'p',
    modelId: 'm',
    recipient: 'Synthetic recipient',
    authorityGeneration: 'a',
    credentialEpoch: 'synthetic-credential',
  },
  permissions: [
    {
      purpose: 'record_conversation',
      policyVersion: 'v1',
      dataCategories: ['conversation'],
      sourceKinds: ['personal_record'],
    },
  ],
};
const first = 'synthetic-first-token';
const second = 'synthetic-second-token';

test('pending and cancelled settings never grant permission or replace an active choice', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    const store = createSettingsConsentStorage(connection.database);
    await store.stage('conversation', first, grant);
    expect(await store.read('conversation')).toBeNull();
    await store.activate('conversation', first, () => true);
    await store.stage('conversation', second, {
      ...grant,
      identity: { ...grant.identity, modelId: 'other' },
    });
    expect(await store.read('conversation')).toEqual(grant);
    await store.cancel(second);
    expect(await store.read('conversation')).toEqual(grant);
    await expect(
      store.activate('conversation', second, () => true),
    ).rejects.toThrow();
    await store.cancel(first);
    expect(await store.read('conversation')).toEqual(grant);
  } finally {
    connection.close();
  }
});

test('failed activation rolls back replacement and clearing removes pending and active permission', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    const store = createSettingsConsentStorage(connection.database);
    await store.stage('conversation', first, grant);
    await store.activate('conversation', first, () => true);
    await store.stage('conversation', second, {
      ...grant,
      identity: { ...grant.identity, authorityGeneration: 'b' },
    });
    let checks = 0;
    await expect(
      store.activate('conversation', second, () => ++checks < 3),
    ).rejects.toThrow('changed');
    expect(await store.read('conversation')).toEqual(grant);
    expect(await store.read('calendar')).toBeNull();
    await store.activate('conversation', second, () => true);
    expect(
      (await store.read('conversation'))?.identity.authorityGeneration,
    ).toBe('b');
    await store.clear();
    expect(await store.read('conversation')).toBeNull();
    expect(
      (
        await connection.database.execute(
          'SELECT * FROM settings_inference_grants',
        )
      ).rows,
    ).toEqual([]);
  } finally {
    connection.close();
  }
});

test('a change after transaction callback but before commit returns never activates a usable grant', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  let invalidateAfterCommit = false;
  let valid = true;
  const database: typeof connection.database = {
    execute: (sql, params) => connection.database.execute(sql, params),
    async transaction(operation) {
      await connection.database.transaction(operation);
      if (invalidateAfterCommit) {
        invalidateAfterCommit = false;
        valid = false;
      }
    },
  };
  try {
    const store = createSettingsConsentStorage(database);
    await store.stage('conversation', first, grant);
    invalidateAfterCommit = true;
    await expect(
      store.activate('conversation', first, () => valid),
    ).rejects.toThrow('after commit');
    expect(await store.read('conversation')).toBeNull();
  } finally {
    connection.close();
  }
});

test('recipient domains coexist without a model grant implicitly approving search', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    const store = createSettingsConsentStorage(connection.database);
    await store.stage('conversation', first, grant);
    await store.activate('conversation', first, () => true);
    expect(await store.read('conversation', 'public-web')).toBeNull();
    expect(await store.read('conversation', 'medical-search')).toBeNull();
    const search = {
      ...grant,
      identity: { ...grant.identity, recipient: 'Synthetic search recipient' },
    };
    await store.stage('conversation', second, search, 'public-web');
    await expect(
      store.activate('conversation', second, () => true),
    ).rejects.toThrow('unavailable');
    expect(await store.read('conversation', 'public-web')).toBeNull();
    await store.activate('conversation', second, () => true, 'public-web');
    expect(await store.read('conversation')).toEqual(grant);
    expect(await store.read('conversation', 'public-web')).toEqual(search);
    expect(await store.read('conversation', 'medical-search')).toBeNull();
    await store.clear();
    expect(await store.read('conversation')).toBeNull();
    expect(await store.read('conversation', 'public-web')).toBeNull();
  } finally {
    connection.close();
  }
});

test('joint activation rolls back both active replacements if the second write fails', async () => {
  const conn = openSqliteTestDatabase(':memory:');
  try {
    const storage = createSettingsConsentStorage(conn.database);
    const selections = [
      { token: 'synthetic-new-model', domain: 'model' },
      { token: 'synthetic-new-web-search', domain: 'public-web' },
    ] as const;
    const replacement = {
      ...grant,
      identity: { ...grant.identity, authorityGeneration: 'next' },
    };
    for (const { token, domain } of selections) {
      await storage.stage('conversation', `${token}-old`, grant, domain);
      await storage.activate(
        'conversation',
        `${token}-old`,
        () => true,
        domain,
      );
      await storage.stage('conversation', token, replacement, domain);
    }
    await conn.database.execute(`CREATE TRIGGER reject_web_permission
      BEFORE UPDATE ON settings_inference_grants
      WHEN NEW.domain = 'public-web' AND NEW.state = 'active'
      BEGIN SELECT RAISE(ABORT, 'synthetic second activation failure'); END`);
    await expect(
      storage.activateTogether('conversation', selections, () => true),
    ).rejects.toThrow('synthetic second activation failure');
    for (const { domain } of selections)
      expect(await storage.read('conversation', domain)).toEqual(grant);
    await conn.database.execute('DROP TRIGGER reject_web_permission');
    await storage.activateTogether('conversation', selections, () => true);
    for (const { domain } of selections)
      expect(await storage.read('conversation', domain)).toEqual(replacement);
  } finally {
    conn.close();
  }
});
