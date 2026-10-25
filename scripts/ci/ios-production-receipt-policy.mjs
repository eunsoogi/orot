import { verifyOAuthReceipt } from './oauth-test-results.mjs';

const obligations = [
  'production-app',
  'foundation-models-production-boundary',
  'simulator-keychain-defaults',
  'oauth-unit',
  'oauth-simulator-harness',
];

const buildObligations = obligations.slice(0, 3);

/** A build receipt proves only the default app, its real SDK linkage and Keychain defaults. OAuth execution is a separate required fact. */
export function verifyProductionBuildReceipt(receipt, env) {
  if (
    !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '') ||
    !/^[1-9]\d*$/.test(env.GITHUB_RUN_ID ?? '') ||
    !/^[1-9]\d*$/.test(env.GITHUB_RUN_ATTEMPT ?? '')
  )
    throw new Error('Production receipt requires its actual workflow context');
  if (
    receipt.schemaVersion !== 2 ||
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
      .join(',') !== buildObligations.slice().sort().join(',') ||
    buildObligations.some((key) => receipt.obligations[key] !== 'passed')
  )
    throw new Error('Production build obligations did not complete');
  if (
    !/^[a-f0-9]{64}$/.test(receipt.appArtifacts?.appBinarySha256 ?? '') ||
    !/^[a-f0-9]{64}$/.test(receipt.appArtifacts?.infoPlistSha256 ?? '')
  )
    throw new Error('Production receipt lacks inspected app artifacts');
  return receipt;
}

/**
 * Every selected run requires its three production build obligations; OAuth adds the two execution obligations only when the validated plan selects it.
 * Keeping the selection explicit prevents a build-only receipt from either requiring an absent OAuth artifact or manufacturing OAuth evidence.
 */
export function verifyProductionReceipt(receipt, env, selection) {
  if (!selection || typeof selection.oauthRequired !== 'boolean')
    throw new Error('Production validation requires an explicit OAuth selection');

  verifyProductionBuildReceipt(receipt, env);
  if (selection.oauthRequired) verifyOAuthReceipt(selection.oauthReceipt, env);
  else if (selection.oauthReceipt !== undefined)
    throw new Error('Unexpected OAuth execution receipt for a non-OAuth selection');

  const verifiedObligations = selection.oauthRequired ? obligations : buildObligations;
  return {
    ...receipt,
    obligations: Object.fromEntries(verifiedObligations.map((name) => [name, 'passed'])),
  };
}

export const productionObligations = () => obligations.slice();
export const productionBuildObligations = () => buildObligations.slice();
