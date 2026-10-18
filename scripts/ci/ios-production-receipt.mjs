import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { getDerivedDataRoot, inspectCachedApp } from './ios-derived-data-cache-paths.mjs';
import { buildInputDigest } from './ios-test-product-context.mjs';

import {
  productionBuildObligations,
  verifyProductionBuildReceipt,
  verifyProductionReceipt,
} from './ios-production-receipt-policy.mjs';

const obligations = productionBuildObligations();

const [command, path, ...extra] = process.argv.slice(2);
if (extra.length) throw new Error('Unexpected production receipt arguments');
if (command === 'write') {
  if (
    process.env.GITHUB_ACTIONS !== 'true' ||
    execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !==
      process.env.GITHUB_SHA
  )
    throw new Error('Production receipts require their actual hosted source');
  // This producer inspects only its own app and completed static guards. The Linux aggregate requires OAuth's separate executor receipt.
  const app = inspectCachedApp('production', getDerivedDataRoot(process.cwd(), 'production'));
  if (app.reason) throw new Error('Production app inspection failed: ' + app.reason);
  const receipt = verifyProductionBuildReceipt(
    {
      schemaVersion: 2,
      sourceSha: process.env.GITHUB_SHA,
      runId: process.env.GITHUB_RUN_ID,
      attempt: process.env.GITHUB_RUN_ATTEMPT,
      profile: 'production',
      configuration: 'Debug',
      entry: 'index.js',
      flags: 'default',
      derivedData: 'apps/mobile/ios/build-production',
      inputDigest: buildInputDigest(process.cwd()),
      appArtifacts: app.artifacts,
      obligations: Object.fromEntries(obligations.map((name) => [name, 'passed'])),
    },
    process.env,
  );
  writeFileSync(path, JSON.stringify(receipt, null, 2) + '\n');
} else if (command === 'verify') {
  const oauthDecision = process.env.OROT_IOS_OAUTH_REQUIRED;
  const oauthPath = process.env.OROT_IOS_OAUTH_RECEIPT_PATH;
  if (oauthDecision !== 'true' && oauthDecision !== 'false')
    throw new Error('Production validation requires an explicit OROT_IOS_OAUTH_REQUIRED decision');
  if (oauthDecision === 'true' && !oauthPath)
    throw new Error('The selected OAuth suite requires its separate executor receipt');
  if (oauthDecision === 'false' && oauthPath)
    throw new Error('Unexpected OAuth executor receipt for a non-OAuth selection');

  const oauthReceipt = oauthPath ? JSON.parse(readFileSync(oauthPath, 'utf8')) : undefined;
  verifyProductionReceipt(JSON.parse(readFileSync(path, 'utf8')), process.env, {
    oauthRequired: oauthDecision === 'true',
    oauthReceipt,
  });
  console.log(
    oauthDecision === 'true'
      ? 'Current-run production build and OAuth obligations verified'
      : 'Current-run production build obligations verified; OAuth was not selected',
  );
} else
  throw new Error(
    'Usage: ios-production-receipt.mjs write <build-receipt> | verify <build-receipt> (set OROT_IOS_OAUTH_REQUIRED and, when true, OROT_IOS_OAUTH_RECEIPT_PATH)',
  );
