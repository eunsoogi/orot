import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const verifyScript = join(repositoryRoot, 'scripts/ci/verify-toolchain.sh');

export const currentSimulator = {
  name: 'iPhone 18 Pro',
  deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro',
  isAvailable: true,
};
export const transcriptionSimulator = {
  name: 'iPhone 17 Pro',
  deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro',
  isAvailable: true,
};

// Stub host tools so runner-version checks stay deterministic outside macOS CI.
export function runToolchainCheck(profile, { availableRuntimes, availableDevices }, args = []) {
  const directory = mkdtempSync(join(tmpdir(), 'orot-toolchain-'));
  try {
    const githubOutputPath = join(directory, 'github-output');
    const githubEnvironmentPath = join(directory, 'github-environment');
    writeFileSync(githubOutputPath, '');
    writeFileSync(githubEnvironmentPath, '');
    const binDirectory = join(directory, 'bin');
    mkdirSync(binDirectory, { recursive: true });
    const writeCommand = (name, content) => {
      writeFileSync(join(binDirectory, name), `#!/usr/bin/env bash\n${content}\n`, {
        mode: 0o755,
      });
    };
    writeCommand(
      'node',
      'if [[ "$1" == "-p" ]]; then printf \'22.23.2\\n\'; else exec "$REAL_NODE_EXECUTABLE" "$@"; fi',
    );
    writeCommand('pnpm', "printf '12.3.4\\n'");
    writeCommand(
      'uname',
      'if [[ "$1" == "-s" ]]; then printf \'%s\\n\' "${SIMULATED_UNAME_SYSTEM:-Linux}"; elif [[ "$1" == "-m" ]]; then printf \'%s\\n\' "${SIMULATED_UNAME_ARCH:-x86_64}"; else exit 97; fi',
    );
    writeCommand(
      'sw_vers',
      'printf \'%s\\n\' "${SIMULATED_MACOS_VERSION:-$EXPECTED_MACOS_VERSION}"',
    );
    writeCommand(
      'xcodebuild',
      'printf \'Xcode %s\\nBuild version %s\\n\' "$EXPECTED_XCODE_VERSION" "${SIMULATED_XCODE_BUILD_VERSION:-test}"',
    );
    writeCommand(
      'xcrun',
      [
        'if [[ "$*" == "--sdk iphonesimulator --show-sdk-version" ]]; then',
        '  printf \'%s\\n\' "$EXPECTED_IOS_SIMULATOR_SDK"',
        'elif [[ "$*" == "simctl list runtimes --json" ]]; then',
        '  cat "$SIMULATOR_RUNTIMES_JSON"',
        'elif [[ "$*" == "simctl list devices available --json" ]]; then',
        '  cat "$SIMULATOR_DEVICES_JSON"',
        'else',
        '  exit 97',
        'fi',
      ].join('\n'),
    );
    writeCommand('ruby', 'printf \'%s\\n\' "${SIMULATED_RUBY_VERSION:-$EXPECTED_RUBY_VERSION}"');
    writeCommand(
      'pod',
      'printf \'%s\\n\' "${SIMULATED_COCOAPODS_VERSION:-$EXPECTED_COCOAPODS_VERSION}"',
    );
    const runtimesPath = join(directory, 'runtimes.json');
    const devicesPath = join(directory, 'devices.json');
    writeFileSync(runtimesPath, JSON.stringify({ runtimes: availableRuntimes }));
    writeFileSync(devicesPath, JSON.stringify({ devices: availableDevices }));
    const result = spawnSync('bash', [verifyScript, ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: [binDirectory, process.env.PATH].join(':'),
        REAL_NODE_EXECUTABLE: process.execPath,
        GITHUB_OUTPUT: githubOutputPath,
        GITHUB_ENV: githubEnvironmentPath,
        SIMULATOR_RUNTIMES_JSON: runtimesPath,
        SIMULATOR_DEVICES_JSON: devicesPath,
        EXPECTED_RUBY_VERSION: '4.0.7',
        EXPECTED_COCOAPODS_VERSION: '1.17.0',
        EXPECTED_IOS_SIMULATOR_RUNTIME_NAME: '',
        EXPECTED_IOS_SIMULATOR_RUNTIME_IDENTIFIER: '',
        EXPECTED_DETOX_SIMULATOR_DEVICE_NAME: '',
        EXPECTED_DETOX_SIMULATOR_DEVICE_TYPE_ID: '',
        ...profile,
      },
    });
    return {
      ...result,
      githubOutput: readFileSync(githubOutputPath, 'utf8'),
      githubEnvironment: readFileSync(githubEnvironmentPath, 'utf8'),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export const runtime27 = {
  name: 'iOS 27.0',
  identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-27-0',
  isAvailable: true,
};
export const runtime26 = {
  name: 'iOS 26.2',
  identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-26-2',
  isAvailable: true,
};

export function expectedXcodeBuildFingerprint(version, build = 'test') {
  return createHash('sha256').update(`Xcode ${version}\nBuild version ${build}\n`).digest('hex');
}
