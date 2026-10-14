import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { getDerivedDataRoot, inspectCachedApp } from './ios-derived-data-cache-paths.mjs';
import { buildInputDigest } from './ios-test-product-context.mjs';

import {
  productionObligations,
  verifyProductionReceipt,
} from './ios-production-receipt-policy.mjs';

const obligations = productionObligations();

const [command, path] = process.argv.slice(2);
if (command === 'write') {
  if (
    process.env.GITHUB_ACTIONS !== 'true' ||
    execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !==
      process.env.GITHUB_SHA
  )
    throw new Error('Production receipts require their actual hosted source');
  // Only the sequential producer step after production, Keychain-defaults, Swift tests and OAuth harness success may call this writer.
  const app = inspectCachedApp('production', getDerivedDataRoot(process.cwd(), 'production'));
  if (app.reason) throw new Error('Production app inspection failed: ' + app.reason);
  const receipt = verifyProductionReceipt(
    {
      schemaVersion: 1,
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
  verifyProductionReceipt(JSON.parse(readFileSync(path, 'utf8')), process.env);
  console.log('Current-run production and OAuth build obligations verified');
} else throw new Error('Usage: ios-production-receipt.mjs <write|verify> <receipt-file>');
