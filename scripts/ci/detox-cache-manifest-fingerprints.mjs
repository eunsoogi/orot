import { readFileSync } from 'node:fs';
import {
  computeDetoxCacheFingerprints,
  listChangedDetoxBuildInputs,
} from './detox-cache-fingerprint.mjs';
import { readExpectedDetoxCacheFingerprints } from './detox-cocoapods-input-provenance.mjs';

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
export function prepareDetoxManifestFingerprints(repositoryRoot, baselineInputs, capturedInputs) {
  const shared = capturedInputs ? readExpectedDetoxCacheFingerprints() : null;
  if (shared) {
    // Simulator prep writes artifacts outside this set, and cache restore writes only ignored app/Detox outputs.
    const precomputedInputs = readPrecomputedChangedInputs(
      process.env.DETOX_CACHE_BUILD_INPUTS_SCAN_PATH,
    );
    const changedInputs = precomputedInputs ?? listChangedDetoxBuildInputs(repositoryRoot);
    console.log(
      `DETOX_DERIVEDDATA_CACHE build_input_scan_source=${precomputedInputs ? 'precomputed' : 'synchronous'}`,
    );
    if (changedInputs.length === 0) {
      console.log('DETOX_DERIVEDDATA_CACHE fingerprint_source=shared');
      return {
        ...shared,
        privacyManifestInputHash: baselineInputs.privacyManifest,
        cocoapodsProjectInputHash: baselineInputs.projectFile,
      };
    }
    console.log(
      `DETOX_DERIVEDDATA_CACHE fingerprint_source=local reason=working_tree_changed inputs=${JSON.stringify(changedInputs)}`,
    );
  } else {
    console.log(
      'DETOX_DERIVEDDATA_CACHE fingerprint_source=local reason=shared_fingerprints_unavailable',
    );
  }

  return computeDetoxCacheFingerprints(repositoryRoot, {
    privacyManifestInputHash: baselineInputs.privacyManifest,
    cocoapodsProjectInputHash: baselineInputs.projectFile,
  });
}
