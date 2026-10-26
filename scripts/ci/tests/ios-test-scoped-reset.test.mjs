import assert from 'node:assert/strict';
import test from 'node:test';
import { fixtureTests } from '../ios-test-inventory.mjs';
import { iosFixtureResetMode, verifyIosFixtureReceipt } from '../ios-test-scoped-reset.mjs';

const token = '11111111-2222-4333-8444-555555555555';
const paths = ['database', 'wal', 'shm', 'recordings', 'deletions', 'exports'];
const keys = [
  'com.orot.mobile.database-encryption-key.v1',
  'com.orot.mobile.database-initialization.v1',
  'com.orot.mobile.provider-selection.v1',
  'com.orot.provider.openai.credentials',
  'com.orot.provider.openai.simulator-fixture',
];
const booleans = (names, value) => Object.fromEntries(names.map((name) => [name, value]));
const reset = {
  token,
  action: 'reset',
  ok: true,
  processIdentifier: 123,
  state: {
    paths: booleans(paths, false),
    keys: booleans(keys, false),
    keyFingerprint: null,
    preferencesEmpty: false,
    preferences: {
      OrotFixturePollution: false,
      'com.orot.provider.openai.ext-agent-host-id': false,
    },
    pollutedPreferencesAbsent: true,
    microphoneUndetermined: true,
    speechUndetermined: true,
  },
};

test('scoped reset requires complete observed absence and rejects each contaminated category', () => {
  assert.deepEqual(verifyIosFixtureReceipt(reset, 'reset', token), reset);
  const badStates = [
    ...paths.map((name) => ({ paths: { ...reset.state.paths, [name]: true } })),
    ...keys.map((name) => ({ keys: { ...reset.state.keys, [name]: true } })),
    { paths: {} },
    { keys: {} },
    { keyFingerprint: 'old' },
    { preferences: {} },
    { preferences: { ...reset.state.preferences, OrotFixturePollution: true } },
    {
      preferences: {
        ...reset.state.preferences,
        'com.orot.provider.openai.ext-agent-host-id': true,
      },
    },
    { pollutedPreferencesAbsent: false },
    { microphoneUndetermined: false },
    { speechUndetermined: false },
  ];
  for (const state of badStates)
    assert.throws(() =>
      verifyIosFixtureReceipt({ ...reset, state: { ...reset.state, ...state } }, 'reset', token),
    );
  for (const change of [
    { token: 'old' },
    { ok: false },
    { action: 'seed' },
    { processIdentifier: null },
  ])
    assert.throws(() => verifyIosFixtureReceipt({ ...reset, ...change }, 'reset', token));
});

test('cold pollution proof requires real database, files, keys, permission and foreign file/key sentinels', () => {
  const seeded = {
    ...reset,
    action: 'seed',
    state: {
      paths: booleans(paths, true),
      keys: booleans(keys, true),
      keyFingerprint: 'a'.repeat(64),
      microphoneGranted: true,
      foreignFile: true,
      foreignKey: true,
    },
  };
  assert.deepEqual(verifyIosFixtureReceipt(seeded, 'seed', token), seeded);
  for (const state of [
    { paths: { ...seeded.state.paths, database: false } },
    { keys: {} },
    { keyFingerprint: null },
    { microphoneGranted: false },
    { foreignFile: false },
    { foreignKey: false },
  ])
    assert.throws(() =>
      verifyIosFixtureReceipt({ ...seeded, state: { ...seeded.state, ...state } }, 'seed', token),
    );
});

test('fresh creation, migration, key lifecycle, backup and native permission cases retain full resets', () => {
  const full = fixtureTests.filter(
    (identifier) => iosFixtureResetMode('fixtures', identifier) === 'fresh-install',
  );
  // The new summary/library journeys retain conservative fresh installation isolation.
  assert.deepEqual(full, [
    'OrotUITests/SummaryAndLiteratureUITests/testSavedSummaryRestoresAfterRelaunchAndHistoryReadRecoversAcrossAppearances',
    'OrotUITests/SummaryAndLiteratureUITests/testLiteratureConsentSearchRecoveryAndCancelledReadAcrossAppearances',
    'OrotUITests/StorageMigrationUITests/testLegacyEncryptedSchemaReopensThroughAppointmentsAfterProcessRestart',
    'OrotUITests/AppointmentReminderJourneyUITests/testLocalReplacementCancellationAndActualRunningAndColdNotificationTaps',
    'OrotUITests/AppointmentReminderJourneyUITests/testReminderControlsAndPreparationAcrossAppearancesAndLargeText',
    'OrotUITests/SymptomJournalUITests/testCreationEditingFilteringAndResolutionSurviveRelaunch',
  ]);
  assert.equal(
    iosFixtureResetMode('fixtures', 'OrotUITests/NewTests/testUnknown'),
    'fresh-install',
  );
  for (const profile of [
    'microphone',
    'health-import',
    'provider-selection',
    'backup',
    'local-model',
  ])
    for (const identifier of fixtureTests)
      assert.equal(iosFixtureResetMode(profile, identifier), 'fresh-install');
});
