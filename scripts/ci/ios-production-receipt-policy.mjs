const obligations = [
  'production-app',
  'simulator-keychain-defaults',
  'oauth-unit',
  'oauth-simulator-harness',
];

/** A producer receipt records completed build steps independently of later native execution. Missing or stale receipts fail the protected production context. */
export function verifyProductionReceipt(receipt, env) {
  if (
    !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '') ||
    !/^[1-9]\d*$/.test(env.GITHUB_RUN_ID ?? '') ||
    !/^[1-9]\d*$/.test(env.GITHUB_RUN_ATTEMPT ?? '')
  )
    throw new Error('Production receipt requires its actual workflow context');
  if (
    receipt.schemaVersion !== 1 ||
    receipt.sourceSha !== env.GITHUB_SHA ||
    receipt.runId !== env.GITHUB_RUN_ID ||
    receipt.attempt !== env.GITHUB_RUN_ATTEMPT ||
    receipt.profile !== 'production' ||
    receipt.configuration !== 'Debug' ||
    receipt.entry !== 'index.js' ||
    receipt.flags !== 'default' ||
    receipt.derivedData !== 'apps/mobile/ios/build-production' ||
    !/^[a-f0-9]{64}$/.test(receipt.inputDigest ?? '')
  )
    throw new Error('Production receipt is stale or incompatible');
  if (
    Object.keys(receipt.obligations ?? {})
      .sort()
      .join(',') !== obligations.slice().sort().join(',') ||
    obligations.some((key) => receipt.obligations[key] !== 'passed')
  )
    throw new Error('Production or OAuth obligations did not complete');
  if (
    !/^[a-f0-9]{64}$/.test(receipt.appArtifacts?.appBinarySha256 ?? '') ||
    !/^[a-f0-9]{64}$/.test(receipt.appArtifacts?.infoPlistSha256 ?? '')
  )
    throw new Error('Production receipt lacks inspected app artifacts');
  return receipt;
}

export const productionObligations = () => obligations.slice();
