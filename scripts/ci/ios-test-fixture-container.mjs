import { execFileSync } from 'node:child_process';
import { verifyIosTestSimulator } from './ios-test-simulator.mjs';

const bundleIdentifier = 'com.orot.mobile';

/** Only dedicated fixture profiles may replace their app container or Keychain; shared Core and Speech destinations are excluded. */
export function resetIosTestFixtureContainer(
  profile,
  owner,
  application,
  { preserveKeychain = false } = {},
) {
  if (!['backup', 'fixtures', 'health-import'].includes(profile))
    throw new Error('Fresh fixture state requires a dedicated execution profile');
  if (preserveKeychain && profile !== 'backup')
    throw new Error('Only backup snapshot restore may retain fixture Keychain state');
  function simctl(...args) {
    if (verifyIosTestSimulator(owner, profile).state !== 'Booted')
      throw new Error('Fixture reset requires its booted owned destination');
    return execFileSync('xcrun', ['simctl', ...args], { encoding: 'utf8', timeout: 30000 }).trim();
  }
  const apps = JSON.parse(
    execFileSync('plutil', ['-convert', 'json', '-o', '-', '-'], {
      input: simctl('listapps', owner.udid),
      encoding: 'utf8',
    }),
  );
  if (Object.hasOwn(apps, bundleIdentifier)) simctl('uninstall', owner.udid, bundleIdentifier);
  if (!preserveKeychain) simctl('keychain', owner.udid, 'reset');
  simctl('install', owner.udid, application);
}
