const pathNames = ['database', 'wal', 'shm', 'recordings', 'deletions', 'exports'];
const serviceNames = [
  'com.orot.mobile.database-encryption-key.v1',
  'com.orot.mobile.database-initialization.v1',
  'com.orot.mobile.provider-selection.v1',
  'com.orot.provider.openai.credentials',
  'com.orot.provider.openai.simulator-fixture',
];

function exactBooleans(value, names, expected) {
  return (
    value &&
    Object.keys(value).length === names.length &&
    names.every((name) => value[name] === expected)
  );
}

/** Observed absence is mandatory; a successful launch or omitted field cannot stand in for state reset. */
export function verifyIosFixtureReceipt(receipt, action, token) {
  if (
    receipt?.token !== token ||
    receipt?.action !== action ||
    receipt?.ok !== true ||
    !Number.isSafeInteger(receipt.processIdentifier) ||
    receipt.processIdentifier <= 0
  )
    throw new Error('Missing, stale or failed scoped fixture receipt');
  const state = receipt.state;
  if (
    action === 'reset' &&
    (!exactBooleans(state?.paths, pathNames, false) ||
      !exactBooleans(state?.keys, serviceNames, false) ||
      state.keyFingerprint !== null ||
      state.preferencesEmpty !== true ||
      state.pollutedPreferencesAbsent !== true ||
      state.microphoneUndetermined !== true ||
      state.speechUndetermined !== true)
  )
    throw new Error('Scoped reset left database, files, keys, preferences or permissions');
  if (
    action === 'seed' &&
    (!exactBooleans(state?.paths, pathNames, true) ||
      !exactBooleans(state?.keys, serviceNames, true) ||
      !/^[a-f0-9]{64}$/.test(state.keyFingerprint ?? '') ||
      state.preferencesEmpty !== false ||
      state.pollutedPreferencesAbsent !== false ||
      state.microphoneGranted !== true ||
      state.foreignFile !== true ||
      state.foreignKey !== true)
  )
    throw new Error('Scoped reset regression did not inject every required contamination category');
  return receipt;
}
