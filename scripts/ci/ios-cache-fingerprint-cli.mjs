import { appendFileSync } from 'node:fs';
import { computeIosDerivedDataFingerprints } from './ios-cache-fingerprint.mjs';

// Capture source and generated-input baselines before Pods; later stages verify these exact expectations.
if (process.argv.slice(2).join(' ') !== '--derived-data-only')
  throw new Error('Usage: ios-cache-fingerprint-cli.mjs --derived-data-only');
const fingerprints = computeIosDerivedDataFingerprints();
if (!process.env.GITHUB_OUTPUT || !process.env.GITHUB_ENV)
  throw new Error('Production fingerprint capture requires workflow outputs and environment');
appendFileSync(
  process.env.GITHUB_OUTPUT,
  `build_inputs=${fingerprints.buildInputs}\nplatform_dependencies=${fingerprints.platformDependencies}\n`,
);
appendFileSync(
  process.env.GITHUB_ENV,
  [
    `EXPECTED_COCOAPODS_INPUT_HASHES_JSON=${JSON.stringify({ privacyManifest: fingerprints.privacyManifestInputHash, projectFile: fingerprints.cocoapodsProjectInputHash })}`,
    `EXPECTED_IOS_BUILD_INPUT_FINGERPRINT=${fingerprints.buildInputs}`,
    `EXPECTED_IOS_PLATFORM_DEPENDENCY_FINGERPRINT=${fingerprints.platformDependencies}`,
  ].join('\n') + '\n',
);
console.log(JSON.stringify(fingerprints));
