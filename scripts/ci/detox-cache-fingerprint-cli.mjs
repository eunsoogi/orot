import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeDetoxCacheFingerprints,
  computeDetoxDerivedDataFingerprints,
  computeDetoxReactNativeArtifactFingerprint,
} from './detox-cache-fingerprint.mjs';

function writeGitHubOutputs(outputPath, fingerprints) {
  const outputLines = [];
  if (fingerprints.buildInputs) outputLines.push(`build_inputs=${fingerprints.buildInputs}`);
  if (fingerprints.reactNativeArtifacts) {
    outputLines.push(`react_native_artifacts=${fingerprints.reactNativeArtifacts}`);
  }
  if (fingerprints.nativeDependencies) {
    outputLines.push(`native_dependencies=${fingerprints.nativeDependencies}`);
  }
  appendFileSync(outputPath, `${outputLines.join('\n')}\n`);
}

function computeFingerprints(mode) {
  if (mode === '--react-native-artifacts-only') {
    return computeDetoxReactNativeArtifactFingerprint();
  }
  if (mode === '--derived-data-only') return computeDetoxDerivedDataFingerprints();
  return computeDetoxCacheFingerprints();
}

function main() {
  const [mode] = process.argv.slice(2);
  if (
    process.argv.length > 3 ||
    ![undefined, '--react-native-artifacts-only', '--derived-data-only'].includes(mode)
  ) {
    throw new Error(
      'Usage: detox-cache-fingerprint-cli.mjs [--react-native-artifacts-only|--derived-data-only]',
    );
  }
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath)
    throw new Error('GITHUB_OUTPUT is required to publish Detox cache fingerprints.');

  const fingerprints = computeFingerprints(mode);
  writeGitHubOutputs(outputPath, fingerprints);
  console.log(
    [
      'DETOX_CACHE_FINGERPRINT',
      `build_inputs=${fingerprints.buildInputs ?? 'not_requested'}`,
      `tracked_files=${fingerprints.buildInputCount ?? 'not_requested'}`,
      `react_native_artifacts=${fingerprints.reactNativeArtifacts ?? 'not_requested'}`,
      `lockfiles=${fingerprints.reactNativeArtifactInputCount ?? 'not_requested'}`,
      `native_dependencies=${fingerprints.nativeDependencies ?? 'not_requested'}`,
      `native_inputs=${fingerprints.nativeDependencyInputCount ?? 'not_requested'}`,
    ].join(' '),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
