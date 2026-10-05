import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

const EXPECTED_APP_METADATA = {
  CFBundleIdentifier: 'com.orot.mobile',
  CFBundleExecutable: 'Orot',
  CFBundlePackageType: 'APPL',
};

export const APP_PROFILES = {
  release: {
    derivedDataPath: 'apps/mobile/ios/build-detox-release',
    configuration: 'Release-iphonesimulator',
    productPath: 'Build/Products/Release-iphonesimulator/Orot.app',
    binaryPath: 'Build/Products/Release-iphonesimulator/Orot.app/Orot',
    embeddedBundlePath: 'Build/Products/Release-iphonesimulator/Orot.app/main.jsbundle',
  },
  'openai-provider': {
    derivedDataPath: 'apps/mobile/ios/build-detox-openai-provider',
    configuration: 'Debug-iphonesimulator',
    productPath: 'Build/Products/Debug-iphonesimulator/Orot.app',
    binaryPath: 'Build/Products/Debug-iphonesimulator/Orot.app/Orot',
    embeddedBundlePath: 'Build/Products/Debug-iphonesimulator/Orot.app/main.jsbundle',
  },
  production: {
    derivedDataPath: 'apps/mobile/ios/build-production',
    configuration: 'Debug-iphonesimulator',
    productPath: 'Build/Products/Debug-iphonesimulator/Orot.app',
    binaryPath: 'Build/Products/Debug-iphonesimulator/Orot.app/Orot',
  },
};

export function getProfile(profile) {
  const value = APP_PROFILES[profile];
  if (!value) throw new Error('Unknown iOS app cache profile: ' + profile);
  return value;
}

export function getDerivedDataRoot(repositoryRoot, profile) {
  const root = realpathSync(resolve(repositoryRoot));
  for (const path of ['apps', 'apps/mobile', 'apps/mobile/ios']) {
    const directory = join(root, path);
    if (
      !existsSync(directory) ||
      lstatSync(directory).isSymbolicLink() ||
      !lstatSync(directory).isDirectory()
    ) {
      throw new Error('Refusing to use a symlinked iOS project directory: ' + directory);
    }
  }
  const iosRoot = join(root, 'apps/mobile/ios');
  const dataRoot = resolve(root, getProfile(profile).derivedDataPath);
  const relativeToIos = relative(iosRoot, dataRoot);
  if (!relativeToIos || relativeToIos.startsWith('..') || isAbsolute(relativeToIos)) {
    throw new Error('Unsafe iOS DerivedData path: ' + dataRoot);
  }
  // lstat detects dangling cache-root links that existsSync would mistake for a cold cache.
  try {
    const stat = lstatSync(dataRoot);
    if (stat.isSymbolicLink()) {
      throw new Error('Refusing to use a symbolic link as the iOS DerivedData root: ' + dataRoot);
    }
    if (!stat.isDirectory()) {
      throw new Error('Refusing to use a non-directory iOS DerivedData root: ' + dataRoot);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return dataRoot;
}

function assertManagedDirectory(directoryPath, expectedRoot) {
  const relativeToRoot = relative(expectedRoot, directoryPath);
  if (!relativeToRoot || relativeToRoot.startsWith('..') || isAbsolute(relativeToRoot)) {
    throw new Error('Refusing to remove a path outside cached DerivedData: ' + directoryPath);
  }
  if (
    !existsSync(expectedRoot) ||
    lstatSync(expectedRoot).isSymbolicLink() ||
    !lstatSync(expectedRoot).isDirectory()
  ) {
    throw new Error('Refusing to remove a path through an unsafe cache root: ' + expectedRoot);
  }
  let currentPath = expectedRoot;
  for (const segment of relativeToRoot.split(sep)) {
    currentPath = join(currentPath, segment);
    if (!existsSync(currentPath)) return false;
    const stat = lstatSync(currentPath);
    if (stat.isSymbolicLink()) {
      throw new Error('Refusing to follow a symbolic link in cached DerivedData: ' + currentPath);
    }
    if (!stat.isDirectory()) {
      throw new Error('Refusing to remove a non-directory cache path: ' + currentPath);
    }
  }
  return true;
}

function removeManagedDirectory(directoryPath, expectedRoot) {
  if (assertManagedDirectory(directoryPath, expectedRoot)) {
    rmSync(directoryPath, { recursive: true });
  }
}

export function removeDerivedDataRoot(profile, dataRoot) {
  getProfile(profile);
  const iosRoot = resolve(dataRoot, '..');
  // Incompatible profile roots are isolated; shared CocoaPods Codegen stays under ios/build.
  removeManagedDirectory(dataRoot, iosRoot);
}

export function clearAppOutputs(profile, dataRoot) {
  const configuration = getProfile(profile).configuration;
  // Compatible native dependencies keep their Pods products; only the app's intermediates and bundle need rebuilding.
  const outputs = [
    join(dataRoot, 'Build/Intermediates.noindex/OrotMobile.build', configuration),
    join(dataRoot, 'Build/Products', configuration, 'Orot.app'),
  ];
  outputs.forEach((path) => assertManagedDirectory(path, dataRoot));
  outputs.forEach((path) => removeManagedDirectory(path, dataRoot));
}

function regularFileDigest(path) {
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size === 0) return null;
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function plistValue(infoPlist, key) {
  return execFileSync('plutil', ['-extract', key, 'raw', '-o', '-', infoPlist], {
    encoding: 'utf8',
  }).trim();
}

function isSimulatorPlatform(infoPlist) {
  const platforms = JSON.parse(
    execFileSync(
      'plutil',
      ['-extract', 'CFBundleSupportedPlatforms', 'json', '-o', '-', infoPlist],
      {
        encoding: 'utf8',
      },
    ),
  );
  return Array.isArray(platforms) && platforms.includes('iPhoneSimulator');
}

export function inspectCachedApp(profile, dataRoot, expectedArtifacts) {
  // A matching key is not enough to skip Xcode: validate identity, platform, architecture, bundle and recorded digests.
  const config = getProfile(profile);
  const product = join(dataRoot, config.productPath);
  if (!assertManagedDirectory(product, dataRoot)) return { reason: 'app_product_missing' };
  const binary = join(dataRoot, config.binaryPath);
  const infoPlist = join(product, 'Info.plist');
  const appBinarySha256 = regularFileDigest(binary);
  const infoPlistSha256 = regularFileDigest(infoPlist);
  if (!appBinarySha256) return { reason: 'app_binary_missing_or_invalid' };
  if (!infoPlistSha256) return { reason: 'app_info_plist_missing_or_invalid' };

  try {
    for (const [key, expected] of Object.entries(EXPECTED_APP_METADATA)) {
      if (plistValue(infoPlist, key) !== expected) return { reason: 'app_metadata_mismatch' };
    }
    if (!isSimulatorPlatform(infoPlist)) return { reason: 'app_platform_mismatch' };
  } catch {
    return { reason: 'app_metadata_invalid' };
  }

  const architecture = process.arch === 'x64' ? 'x86_64' : process.arch;
  try {
    const actual = execFileSync('xcrun', ['lipo', '-archs', binary], { encoding: 'utf8' })
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .sort();
    if (actual.length !== 1 || actual[0] !== architecture) {
      return { reason: 'app_architecture_invalid' };
    }
  } catch {
    return { reason: 'app_architecture_invalid' };
  }

  const artifacts = { appBinarySha256, infoPlistSha256 };
  if (config.embeddedBundlePath) {
    const bundleSha256 = regularFileDigest(join(dataRoot, config.embeddedBundlePath));
    if (!bundleSha256) return { reason: 'app_embedded_bundle_missing_or_invalid' };
    artifacts.mainJsBundleSha256 = bundleSha256;
  }
  if (expectedArtifacts) {
    const expectedKeys = Object.keys(artifacts).sort().join(',');
    const actualKeys = Object.keys(expectedArtifacts).sort().join(',');
    if (expectedKeys !== actualKeys) return { reason: 'app_manifest_artifacts_invalid' };
    if (Object.keys(artifacts).some((key) => artifacts[key] !== expectedArtifacts[key])) {
      return { reason: 'app_artifact_digest_mismatch' };
    }
  } else if (expectedArtifacts === null) {
    return { reason: 'app_manifest_artifacts_missing' };
  }
  return { reason: null, artifacts };
}
