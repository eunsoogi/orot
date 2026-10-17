import { isDeepStrictEqual } from 'node:util';

/** The producer discovers every XCTest method without running it; the consumer must execute exactly that list once. */
export function oauthDiscoveredTests(text) {
  const tests = text.trim().split('\n').filter(Boolean);
  if (
    !tests.length ||
    new Set(tests).size !== tests.length ||
    tests.some((id) => !/^OpenAIProviderTests\.\w+\/test\w+$/.test(id))
  )
    throw new Error('OAuth discovery must contain unique package XCTest identifiers');
  return tests.sort();
}

export function verifyOAuthTestOutput(text, expected) {
  const events = [
    ...text.matchAll(/^Test Case '-\[([\w.]+) (test\w+)\]' (started|passed|failed|skipped)[. (]/gm),
  ];
  const identifiers = (status) =>
    events
      .filter((event) => event[3] === status)
      .map((event) => event[1] + '/' + event[2])
      .sort();
  const tests = oauthDiscoveredTests(expected.join('\n'));
  if (
    events.some((event) => ['failed', 'skipped'].includes(event[3])) ||
    !isDeepStrictEqual(identifiers('started'), tests) ||
    !isDeepStrictEqual(identifiers('passed'), tests)
  )
    throw new Error('OAuth execution omitted, repeated, skipped or failed a discovered test');
  return tests;
}

/** Linux checks the completed executor result independently of production's app-only receipt. */
export function verifyOAuthReceipt(receipt, env) {
  const context = receipt?.context;
  if (
    receipt?.schemaVersion !== 1 ||
    context?.profile !== 'oauth-macos' ||
    context.configuration !== 'Debug' ||
    context.sourceSha !== env.GITHUB_SHA ||
    context.runId !== env.GITHUB_RUN_ID ||
    context.attempt !== env.GITHUB_RUN_ATTEMPT ||
    !/^[a-f0-9]{40}$/.test(context.sourceSha ?? '') ||
    !/^[1-9]\d*$/.test(context.runId ?? '') ||
    !/^[1-9]\d*$/.test(context.attempt ?? '') ||
    !/^[a-f0-9]{64}$/.test(context.inputDigest ?? '') ||
    receipt.passed !== true
  )
    throw new Error('Missing, failed or stale OAuth execution receipt');
  for (const hash of [receipt.archiveDigest, receipt.manifestDigest, receipt.harnessBinaryDigest])
    if (!/^[a-f0-9]{64}$/.test(hash ?? ''))
      throw new Error('OAuth receipt lacks verified build provenance');
  if (!isDeepStrictEqual(receipt.tests, oauthDiscoveredTests(receipt.tests?.join('\n') ?? '')))
    throw new Error('OAuth receipt lacks its exact executed inventory');
  return receipt;
}
