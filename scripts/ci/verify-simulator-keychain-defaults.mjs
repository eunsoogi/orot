#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const workspace = 'apps/mobile/ios/OrotMobile.xcworkspace';
const simulatorEntitlements = 'apps/mobile/ios/OrotMobile/OrotMobile.simulator.entitlements';
const bundleIdentifiers = [];
const simulatorEntitlementsSetting = 'OrotMobile/OrotMobile.simulator.entitlements';

function fail(message) {
  throw new Error(`Simulator Keychain defaults check failed: ${message}`);
}

function resolvedSettings(configuration, sdk, destination) {
  // Remove caller-provided signing values so this checks the project defaults.
  const env = { ...process.env };
  delete env.CODE_SIGN_ENTITLEMENTS;
  delete env.DEVELOPMENT_TEAM;
  delete env.OROT_SIMULATOR_ENTITLEMENTS;

  const output = execFileSync(
    'xcodebuild',
    [
      '-workspace',
      workspace,
      '-scheme',
      'OrotMobile',
      '-configuration',
      configuration,
      '-sdk',
      sdk,
      '-destination',
      destination,
      '-showBuildSettings',
      '-json',
    ],
    { cwd: root, encoding: 'utf8', env, maxBuffer: 16 * 1024 * 1024 },
  );

  let targets;
  try {
    targets = JSON.parse(output).filter((target) => target.target === 'OrotMobile');
  } catch (error) {
    fail(`Xcode returned invalid build settings (${error.message})`);
  }
  if (targets.length !== 1) {
    fail(`expected one OrotMobile target, found ${targets.length}`);
  }
  return targets[0].buildSettings;
}

function plistValue(key) {
  return execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, simulatorEntitlements], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
}

for (const configuration of ['Debug', 'Release']) {
  const settings = resolvedSettings(
    configuration,
    'iphonesimulator',
    'generic/platform=iOS Simulator',
  );
  if (settings.CONFIGURATION !== configuration) {
    fail(`${configuration} resolved as ${settings.CONFIGURATION}`);
  }
  if (
    settings.CODE_SIGN_ENTITLEMENTS !== simulatorEntitlementsSetting ||
    settings.OROT_SIMULATOR_ENTITLEMENTS !== simulatorEntitlementsSetting ||
    settings.DEVELOPMENT_TEAM !== 'OROTSIM000' ||
    settings.CODE_SIGNING_ALLOWED !== 'YES'
  ) {
    fail(`${configuration} does not resolve to the shared Simulator signing defaults`);
  }
  bundleIdentifiers.push(settings.PRODUCT_BUNDLE_IDENTIFIER);
}

const simulatorGroup = plistValue('keychain-access-groups:0');
const simulatorApplicationIdentifier = plistValue('application-identifier');
const expectedApplicationIdentifier = `OROTSIM000.${bundleIdentifiers[0]}`;
if (
  bundleIdentifiers[0] !== 'com.orot.mobile' ||
  bundleIdentifiers[1] !== bundleIdentifiers[0] ||
  simulatorGroup !== expectedApplicationIdentifier ||
  simulatorApplicationIdentifier !== expectedApplicationIdentifier
) {
  fail('the Simulator entitlement file does not name the shared app Keychain group');
}

for (const configuration of ['Debug', 'Release']) {
  const settings = resolvedSettings(configuration, 'iphoneos', 'generic/platform=iOS');
  if (
    settings.CODE_SIGN_ENTITLEMENTS !== 'OrotMobile/OrotMobile.entitlements' ||
    settings.DEVELOPMENT_TEAM ||
    settings.OROT_SIMULATOR_ENTITLEMENTS
  ) {
    fail(`${configuration} changed the user-controlled iPhoneOS signing settings`);
  }
}

console.log(
  'PASS Debug and Release Simulator signing resolve the shared Keychain group; iPhoneOS signing remains user-controlled.',
);
