/** Defaults are independent evidence, not a signature or permission to skip live checks. */
export function verifyProductionDefaults(receipt, env, expected) {
  const context = receipt?.context;
  if (
    receipt?.schemaVersion !== 1 ||
    receipt?.passed !== true ||
    receipt?.obligation !== 'simulator-keychain-defaults' ||
    !context ||
    context.sourceSha !== env.GITHUB_SHA ||
    context.runId !== env.GITHUB_RUN_ID ||
    context.attempt !== env.GITHUB_RUN_ATTEMPT ||
    !/^[a-f0-9]{40}$/.test(context.sourceSha ?? '') ||
    !/^[1-9]\d*$/.test(context.runId ?? '') ||
    !/^[1-9]\d*$/.test(context.attempt ?? '') ||
    !/^[a-f0-9]{64}$/.test(context.inputDigest ?? '') ||
    !/^[a-f0-9]{64}$/.test(context.signingInputDigest ?? '') ||
    !/^Xcode 27\.2\nBuild version [A-Za-z0-9]+$/.test(context.xcode ?? '') ||
    context.sdk !== '27.2' ||
    context.developerDirectory !== '/Applications/Xcode_27.2.app/Contents/Developer'
  )
    throw new Error('Production defaults evidence is missing, stale or incompatible');
  for (const [key, value] of Object.entries(expected))
    if (context[key] !== value) throw new Error('Production defaults context mismatch: ' + key);
  return receipt;
}
