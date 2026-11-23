import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

test('the iOS app compiles the bubble host exactly once and exposes its React view name', () => {
  const project = read('apps/mobile/ios/OrotMobile.xcodeproj/project.pbxproj');
  const host = 'ConversationBubbleCopyViewManager';
  const target = project.match(
    /\/\* OrotMobile \*\/ = \{\s*isa = PBXNativeTarget;([\s\S]+?)\n\t\t};/,
  )?.[1];
  const phase = target?.match(/([A-F0-9]+) \/\* Sources \*\//)?.[1];
  assert.ok(phase, 'OrotMobile must own an app Sources phase');
  const appSources = project.match(
    new RegExp(phase + ' /\\* Sources \\*/ = \\{([\\s\\S]+?)\\n\\t\\t};'),
  )?.[1];
  const file = project.match(
    new RegExp(
      '([A-F0-9]+) /\\* ' +
        host +
        '\\.m \\*/ = \\{isa = PBXFileReference;[^\n]+path = OrotMobile/' +
        host +
        '\\.m;',
    ),
  )?.[1];
  assert.ok(file, 'the target references the real source path');
  const build = project.match(
    new RegExp(
      '([A-F0-9]+) /\\* ' +
        host +
        '\\.m in Sources \\*/ = \\{isa = PBXBuildFile; fileRef = ' +
        file +
        ' ',
    ),
  )?.[1];
  assert.ok(build);
  assert.equal(appSources?.split(build).length, 2);
  const allSources = project.split('/* Begin PBXSourcesBuildPhase section */')[1];
  assert.equal(allSources.split(build).length, 2, 'not in any other target');
  const native = read('apps/mobile/ios/OrotMobile/' + host + '.m');
  const react = read('apps/mobile/src/ragConversation/ConversationBubbleCopyHost.tsx');
  assert.match(native, /RCT_EXPORT_MODULE\(ConversationBubbleCopyView\)/);
  assert.match(react, /const name = 'ConversationBubbleCopyView'/);
});
