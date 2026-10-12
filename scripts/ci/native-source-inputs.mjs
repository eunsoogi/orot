import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

// CocoaPods may reorder this plist. Only equivalent generated serialization is
// restored; any semantic source change is rejected before product provenance is recorded.
const path = 'apps/mobile/ios/OrotMobile/PrivacyInfo.xcprivacy';
const original = execFileSync('git', ['show', 'HEAD:' + path]);
const parse = (input) =>
  JSON.parse(
    execFileSync('plutil', ['-convert', 'json', '-o', '-', '-'], { input, encoding: 'utf8' }),
  );
const current = execFileSync('plutil', ['-convert', 'json', '-o', '-', path], { encoding: 'utf8' });
if (!isDeepStrictEqual(parse(original), JSON.parse(current)))
  throw new Error('Generated native privacy metadata changed its meaning');
writeFileSync(path, original);
