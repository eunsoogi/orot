import { readFileSync } from 'node:fs';
import {
  computeIosCacheFingerprints,
  listChangedIosBuildInputs,
} from './ios-cache-fingerprint.mjs';
import { readExpectedIosCacheFingerprints } from './ios-cocoapods-input-provenance.mjs';

function readPrecomputedChangedInputs(path) {
  if (!path) return null;
  try {
    const changedInputs = JSON.parse(readFileSync(path, 'utf8'));
    return Array.isArray(changedInputs) && changedInputs.every((input) => typeof input === 'string')
      ? changedInputs
      : null;
  } catch {
    return null;
  }
}

// Use the complete post-install drift scan; missing or invalid output keeps the synchronous path.
export function prepareIosManifestFingerprints(repositoryRoot, baselineInputs, capturedInputs) {
  const shared = capturedInputs ? readExpectedIosCacheFingerprints() : null;
  if (shared) {
    // Simulator prep writes artifacts outside this set, and cache restore writes only ignored app/Ios outputs.
    const precomputedInputs = readPrecomputedChangedInputs(
      process.env.IOS_CACHE_BUILD_INPUTS_SCAN_PATH,
    );
    const changedInputs = precomputedInputs ?? listChangedIosBuildInputs(repositoryRoot);
    console.log(
      `IOS_DERIVEDDATA_CACHE build_input_scan_source=${precomputedInputs ? 'precomputed' : 'synchronous'}`,
    );
    if (changedInputs.length === 0) {
      console.log('IOS_DERIVEDDATA_CACHE fingerprint_source=shared');
      return {
        ...shared,
        privacyManifestInputHash: baselineInputs.privacyManifest,
        cocoapodsProjectInputHash: baselineInputs.projectFile,
      };
    }
    console.log(
      `IOS_DERIVEDDATA_CACHE fingerprint_source=local reason=working_tree_changed inputs=${JSON.stringify(changedInputs)}`,
    );
  } else {
    console.log(
      'IOS_DERIVEDDATA_CACHE fingerprint_source=local reason=shared_fingerprints_unavailable',
    );
  }

  return computeIosCacheFingerprints(repositoryRoot, {
    privacyManifestInputHash: baselineInputs.privacyManifest,
    cocoapodsProjectInputHash: baselineInputs.projectFile,
  });
}
