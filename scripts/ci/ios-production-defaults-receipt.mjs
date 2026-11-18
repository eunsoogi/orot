import { productionSigningInputDigest } from './ios-production-signing-inputs.mjs';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildInputDigest } from './ios-test-product-context.mjs';
import { verifyProductionDefaults } from './ios-production-defaults-policy.mjs';

export function productionDefaultsContext(env = process.env) {
  if (
    env.GITHUB_ACTIONS !== 'true' ||
    execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== env.GITHUB_SHA
  )
    throw new Error('Production defaults require their actual hosted source');
  return {
    sourceSha: env.GITHUB_SHA,
    runId: env.GITHUB_RUN_ID,
    attempt: env.GITHUB_RUN_ATTEMPT,
    inputDigest: buildInputDigest(process.cwd()),
    signingInputDigest: productionSigningInputDigest(process.cwd()),
    xcode: execFileSync('xcodebuild', ['-version'], { encoding: 'utf8' }).trim(),
    sdk: execFileSync('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-version'], {
      encoding: 'utf8',
    }).trim(),
    developerDirectory: env.DEVELOPER_DIR,
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve('scripts/ci/ios-production-defaults-receipt.mjs')
) {
  const [command, path, ...extra] = process.argv.slice(2);
  if (command !== 'write' || !path || extra.length)
    throw new Error('Usage: ios-production-defaults-receipt.mjs write <receipt>');
  const context = productionDefaultsContext();
  // Only successful execution of the original four real Xcode queries can emit evidence.
  execFileSync(process.execPath, ['scripts/ci/verify-simulator-keychain-defaults.mjs'], {
    stdio: 'inherit',
  });
  const receipt = verifyProductionDefaults(
    { schemaVersion: 1, passed: true, obligation: 'simulator-keychain-defaults', context },
    process.env,
    productionDefaultsContext(),
  );
  writeFileSync(path, JSON.stringify(receipt, null, 2) + '\n');
}
