import { resolve } from 'node:path';
import { hashCurrentInputs } from './detox-cache-fingerprint.mjs';

// Key Pods by dependency and build integration inputs; app source remains in the DerivedData key.
const COCOAPODS_CACHE_INPUT_PATHS = [
  '.npmrc',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'apps/mobile/package.json',
  'apps/mobile/react-native.config.js',
  'apps/mobile/ios/Podfile',
  'apps/mobile/ios/Podfile.lock',
  'apps/mobile/ios/OrotMobile.xcodeproj/project.pbxproj',
  'apps/mobile/ios/OrotMobile/PrivacyInfo.xcprivacy',
  'packages/**/package.json',
  'packages/**/react-native.config.js',
  'packages/**/*.podspec',
  'scripts/ci/build-detox-apps.sh',
  'scripts/ci/build-ios-simulator-app.sh',
];

export function computeDetoxCocoapodsCacheFingerprint(repositoryRoot = process.cwd()) {
  return hashCurrentInputs(resolve(repositoryRoot), COCOAPODS_CACHE_INPUT_PATHS).fingerprint;
}
