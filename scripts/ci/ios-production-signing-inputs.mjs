import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

/** Bind the settings actually read on both hosts, including generated CocoaPods
 * inputs. Normalize only delimited literal checkout paths. Other spellings remain
 * byte-sensitive: this is not general Xcode settings semantic equivalence. */
export function productionSigningInputDigest(root) {
  root = realpathSync(root);
  const files = new Set([
    'apps/mobile/ios/Podfile.lock',
    'apps/mobile/ios/Pods/Manifest.lock',
    'apps/mobile/ios/OrotMobile.xcodeproj/project.pbxproj',
    'apps/mobile/ios/OrotMobile.xcworkspace/contents.xcworkspacedata',
    'apps/mobile/ios/Pods/Pods.xcodeproj/project.pbxproj',
  ]);
  const tracked = execFileSync('git', ['-C', root, 'ls-files', '-z', 'apps/mobile/ios'], {
    encoding: 'utf8',
  }).split('\0');
  for (const file of tracked)
    if (/\.(xcconfig|entitlements|xcscheme|xcsettings)$/.test(file)) files.add(file);
  function inside(path) {
    const actual = realpathSync(resolve(root, path));
    const rel = relative(root, actual);
    if (rel === '..' || rel.startsWith('..' + sep))
      throw new Error('Signing input escapes checkout: ' + path);
    return actual;
  }
  function visit(directory, ancestors = new Set()) {
    const actual = inside(directory);
    if (ancestors.has(actual)) throw new Error('Signing directory cycle: ' + directory);
    const lineage = new Set([...ancestors, actual]);
    for (const entry of readdirSync(actual, { withFileTypes: true })) {
      const path = directory + '/' + entry.name;
      // CocoaPods can expose generated settings through directory aliases. Follow
      // in-checkout aliases, retaining logical paths, but never omit or escape one.
      const isDirectory =
        entry.isDirectory() || (entry.isSymbolicLink() && statSync(inside(path)).isDirectory());
      if (isDirectory) visit(path, lineage);
      else if (/\.(xcconfig|xcsettings)$/.test(path) || /\/project\.pbxproj$/.test(path))
        files.add(path);
    }
  }
  visit('apps/mobile/ios/Pods');
  const hash = createHash('sha256');
  for (const file of [...files].sort()) {
    const actual = inside(file);
    const escapedRoot = root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const literalPath = new RegExp('(^|[\\s"\'=(:])' + escapedRoot + '(?=$|[/\\s"\';,)])', 'g');
    const content = readFileSync(actual, 'utf8').replace(literalPath, '$1$$CHECKOUT');
    hash.update(JSON.stringify([file, content]));
  }
  return hash.digest('hex');
}
