import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Only the maintained default production recipe influences this cache. iOS test products have their own exact build specification and portable manifest. */
export function fingerprintIosBuildConfigs(repositoryRoot) {
  return [
    {
      profile: 'production',
      scheme: 'OrotMobile',
      configuration: 'Debug',
      sdk: 'iphonesimulator',
      entry: 'index.js',
      platformFlags: 'default',
      signing: 'NO',
      derivedDataPath: 'apps/mobile/ios/build-production',
      recipeSha256: createHash('sha256')
        .update(readFileSync(resolve(repositoryRoot, 'scripts/ci/build-ios-simulator-app.sh')))
        .digest('hex'),
    },
  ];
}
