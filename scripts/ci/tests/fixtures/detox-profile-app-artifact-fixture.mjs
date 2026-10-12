// Create isolated fake Xcode, Detox, and app inputs for provenance and integrity tests.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  createProfileAppArtifact,
  verifyProfileAppArtifact,
} from '../../detox-profile-app-artifact.mjs';
import { getProfile } from '../../ios-derived-data-cache-paths.mjs';
import { createFixtureRepository, writeFixtureFile } from './detox-derived-data-cache.mjs';

export const productPath = 'Build/Products/Release-iphonesimulator/Orot.app';
export const artifactFiles = ['profile-app.tar', 'manifest.json'];
const fixtureXcode = 'Xcode 27.0\nBuild version CI-27.0\n';

const appConfigurations = {
  release: {
    configPath: 'apps/mobile/.detoxrc.js',
    appKey: 'ios.release',
    configurationName: 'ios.sim.release',
    entryPoint: 'e2e/e2eRouterEntry.tsx',
    buildCommand:
      'FORCE_BUNDLING=1 xcodebuild -workspace ios/OrotMobile.xcworkspace -scheme OrotMobile -configuration Release -sdk iphonesimulator -destination \'generic/platform=iOS Simulator\' -derivedDataPath ios/build-detox-release CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- ARCHS="$(uname -m)" ONLY_ACTIVE_ARCH=YES -showBuildTimingSummary ENTRY_FILE=e2e/e2eRouterEntry.tsx',
  },
  transcription: {
    configPath: 'apps/mobile/e2e/transcription.detox.config.js',
    appKey: 'ios.speech-transcription',
    configurationName: 'ios.sim.release.transcription',
    entryPoint: 'e2e/transcriptionProbeEntry.tsx',
    buildCommand:
      "DEVELOPMENT_TEAM=OROTSIM000 FORCE_BUNDLING=1 xcodebuild -workspace ios/OrotMobile.xcworkspace -scheme OrotMobile -configuration Release -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath ios/build-detox-transcription CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- ARCHS=\"$(uname -m)\" ONLY_ACTIVE_ARCH=YES OROT_SIMULATOR_ENTITLEMENTS=OrotMobile/OrotMobile.simulator.entitlements OTHER_SWIFT_FLAGS='$(inherited) -DOROT_SPEECH_TRANSCRIPTION_SIMULATOR_TEST' ENTRY_FILE=e2e/transcriptionProbeEntry.tsx",
  },
};

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function prepareFixture({ buildApp = true, profile = 'release' } = {}) {
  const repositoryRoot = createFixtureRepository();
  const configuration = appConfigurations[profile];
  if (!configuration) throw new Error('Unsupported fixture profile: ' + profile);
  const app = getProfile(profile);
  const artifactDirectory = join(repositoryRoot, 'artifacts/detox/' + profile + '-app');
  const appRoot = join(repositoryRoot, app.derivedDataPath, productPath);
  const architecture = process.arch === 'x64' ? 'x86_64' : process.arch;
  mkdirSync(join(repositoryRoot, 'bin'), { recursive: true });
  writeFixtureFile(
    repositoryRoot,
    configuration.configPath,
    [
      profile === 'transcription' ? "const derivedDataPath = 'ios/build-detox-transcription';" : '',
      'module.exports = {',
      `  apps: { '${configuration.appKey}': {`,
      "    type: 'ios.app',",
      profile === 'transcription'
        ? "    binaryPath: derivedDataPath + '/Build/Products/Release-iphonesimulator/Orot.app',"
        : "    binaryPath: 'ios/build-detox-release/Build/Products/Release-iphonesimulator/Orot.app',",
      `    build: ${JSON.stringify(configuration.buildCommand)},`,
      '  } },',
      `  configurations: { '${configuration.configurationName}': { device: 'simulator', app: '${configuration.appKey}' } },`,
      "  devices: { simulator: { type: 'ios.simulator', device: { type: 'iPhone 18 Pro' } } },",
      '};',
    ]
      .filter(Boolean)
      .join('\n'),
  );
  writeFixtureFile(
    repositoryRoot,
    'bin/uname',
    [
      '#!/bin/sh',
      'case "$1" in',
      '  -s) echo Darwin ;;',
      '  -m) echo ' + architecture + ' ;;',
      '  *) exit 2 ;;',
      'esac',
      '',
    ].join('\n'),
  );
  writeFixtureFile(repositoryRoot, 'bin/sw_vers', '#!/bin/sh\necho 27.0.1\n');
  writeFixtureFile(
    repositoryRoot,
    'bin/xcodebuild',
    '#!/bin/sh\nprintf "Xcode 27.0\\nBuild version CI-27.0\\n"\n',
  );
  writeFixtureFile(
    repositoryRoot,
    'bin/xcrun',
    [
      '#!/bin/sh',
      'if [ "$1:$2" = "lipo:-archs" ]; then',
      '  [ "$(cat "$3")" = valid-architecture ] || exit 1',
      '  echo ' + architecture,
      'elif [ "$1:$2:$3" = "--sdk:iphonesimulator:--show-sdk-version" ]; then',
      '  echo 27.0',
      'else',
      '  exit 2',
      'fi',
      '',
    ].join('\n'),
  );
  for (const tool of ['uname', 'sw_vers', 'xcodebuild', 'xcrun']) {
    execFileSync('chmod', ['755', join(repositoryRoot, 'bin', tool)]);
  }
  if (buildApp) {
    writeFixtureFile(
      repositoryRoot,
      join(app.derivedDataPath, productPath, 'Orot'),
      'valid-architecture',
    );
    writeFixtureFile(
      repositoryRoot,
      join(app.derivedDataPath, productPath, 'Info.plist'),
      'valid-plist',
    );
    writeFixtureFile(
      repositoryRoot,
      join(app.derivedDataPath, productPath, 'main.jsbundle'),
      profile + '-bundle',
    );
  }
  const outputPath = join(repositoryRoot, 'github-output.txt');
  const environment = {
    ...process.env,
    GITHUB_ACTIONS: 'true',
    GITHUB_OUTPUT: outputPath,
    GITHUB_RUN_ID: '38185573169',
    GITHUB_RUN_ATTEMPT: '1',
    GITHUB_SHA: execFileSync('git', ['-C', repositoryRoot, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim(),
    EXPECTED_DETOX_BUILD_INPUT_FINGERPRINT: 'a'.repeat(64),
    EXPECTED_DETOX_NATIVE_DEPENDENCY_FINGERPRINT: 'b'.repeat(64),
    EXPECTED_XCODE_VERSION: '27.0',
    EXPECTED_IOS_SIMULATOR_SDK: '27.0',
    XCODEBUILD_FINGERPRINT: sha256(fixtureXcode),
    DETOX_CACHE_RUNNER_OS: 'macOS',
    DETOX_CACHE_RUNNER_ARCH: architecture,
    DEVELOPER_DIR: '/Applications/Xcode.app/Contents/Developer',
    PATH: join(repositoryRoot, 'bin') + ':' + process.env.PATH,
  };
  return { repositoryRoot, artifactDirectory, appRoot, outputPath, environment, profile };
}

export async function produce(fixture) {
  return withFixturePath(fixture, () =>
    createProfileAppArtifact({
      profile: fixture.profile,
      repositoryRoot: fixture.repositoryRoot,
      artifactDirectory: fixture.artifactDirectory,
      environment: fixture.environment,
    }),
  );
}

export async function consume(
  fixture,
  hashes,
  environment = fixture.environment,
  profile = fixture.profile,
) {
  return withFixturePath(fixture, () =>
    verifyProfileAppArtifact({
      profile,
      repositoryRoot: fixture.repositoryRoot,
      artifactDirectory: fixture.artifactDirectory,
      expectedArchiveSha256: hashes.archiveSha256,
      expectedManifestSha256: hashes.manifestSha256,
      environment,
    }),
  );
}

async function withFixturePath(fixture, action) {
  const previousPath = process.env.PATH;
  process.env.PATH = fixture.environment.PATH;
  try {
    return await action();
  } finally {
    process.env.PATH = previousPath;
  }
}

export function clean(fixture) {
  rmSync(fixture.repositoryRoot, { recursive: true, force: true });
}
