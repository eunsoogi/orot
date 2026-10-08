import {
  computeDetoxCacheFingerprints,
  listChangedDetoxBuildInputs,
} from './detox-cache-fingerprint.mjs';
import { readExpectedDetoxCacheFingerprints } from './detox-cocoapods-input-provenance.mjs';

// Profile preparation reuses the shared scan only when its immutable checkout has no local input drift.
export function prepareDetoxManifestFingerprints(repositoryRoot, baselineInputs, capturedInputs) {
  const shared = capturedInputs ? readExpectedDetoxCacheFingerprints() : null;
  if (shared) {
    const changedInputs = listChangedDetoxBuildInputs(repositoryRoot);
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
