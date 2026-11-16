import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

// Source/resource contracts are not UIKit or Bundle runtime acceptance.
test('new photo display names retain Korean bytes and bounded existing extensions', () => {
  const copy = read('apps/mobile/ios/OrotMobile/NativeInterfaceCopy.strings');
  const template = copy.match(
    /<key>medicalPhoto\.displayName<\/key>\s*<string>([^<]+)<\/string>/,
  )?.[1];
  assert.equal(template, '사진.%@');
  for (const extension of ['jpg', 'heic', 'png']) {
    assert.equal(template.replace('%@', extension), `사진.${extension}`);
  }
  const source = read('apps/mobile/ios/OrotMobile/MedicalDocumentPhotoPicker.swift');
  assert.match(
    source,
    /"displayName": String\(format: NSLocalizedString\("medicalPhoto\.displayName", tableName: "NativeInterfaceCopy"/,
  );
  assert.match(
    source,
    /fileStore\.store\(data: data, identifier: identifier, fileExtension: ext\)/,
  );
  assert.match(
    read('apps/mobile/ios/OrotMobile.xcodeproj/project.pbxproj'),
    /NativeInterfaceCopy\.strings in Resources/,
  );
  assert.match(
    read('apps/mobile/src/medicalDocuments/medicalDocumentImportRecords.ts'),
    /title: document\.displayName/,
  );
});
