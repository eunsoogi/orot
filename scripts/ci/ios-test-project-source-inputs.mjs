import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { join, resolve } from 'node:path';
import { projectMetadataDifference } from './ios-test-project-metadata-shape.mjs';

const projectPath = 'apps/mobile/ios/OrotMobile.xcodeproj/project.pbxproj';
const projectParts = projectPath.split('/');

/** Resolve only ordinary checkout directories and a regular project file. */
export function projectFilePath(root) {
  let current = resolve(root);
  for (const [index, part] of projectParts.entries()) {
    current = join(current, part);
    const metadata = lstatSync(current);
    const isFile = index === projectParts.length - 1;
    if (metadata.isSymbolicLink() || (isFile ? !metadata.isFile() : !metadata.isDirectory()))
      throw new Error(
        'Xcode project source path must contain only checkout directories and a regular file',
      );
  }
  return current;
}

/** Restore committed bytes only when CocoaPods changed the project's serialization. */
export function restoreEquivalentProjectSerialization(original, current, parseProject) {
  // Deep comparison ignores dictionary key order but keeps arrays ordered because PBX list order can be meaningful.
  const before = parseProject(original);
  const after = parseProject(current);
  if (!isDeepStrictEqual(before, after)) {
    const summary = projectMetadataDifference(before, after);
    throw new Error(`Generated Xcode project metadata changed its meaning (${summary})`);
  }
  return original;
}

function parseOpenStepProject(input) {
  return JSON.parse(
    execFileSync('plutil', ['-convert', 'json', '-o', '-', '-'], { input, encoding: 'utf8' }),
  );
}

function verifyAndRestoreProjectSerialization(root = process.cwd()) {
  // CocoaPods/Xcodeproj may rewrite project dictionaries and comments; parse both versions before restoring checkout bytes.
  const original = execFileSync('git', ['-C', root, 'show', 'HEAD:' + projectPath]);
  const file = projectFilePath(root);
  const current = readFileSync(file);
  const restored = restoreEquivalentProjectSerialization(original, current, parseOpenStepProject);
  writeFileSync(file, restored);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  verifyAndRestoreProjectSerialization();
