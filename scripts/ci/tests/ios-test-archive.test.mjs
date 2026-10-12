import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const verifier = fileURLToPath(new URL('../verify-ios-test-archive.mjs', import.meta.url));
const fixture = `
import sys,tarfile,json
with tarfile.open(sys.argv[1],'w') as archive:
    for name,kind,target in json.loads(sys.argv[2]):
        item=tarfile.TarInfo(name)
        item.type={'directory':tarfile.DIRTYPE,'file':tarfile.REGTYPE,'link':tarfile.SYMTYPE,'hardlink':tarfile.LNKTYPE}[kind]
        item.linkname=target
        archive.addfile(item)
`;
test('checks tar headers before extraction, rejecting traversal and link-based writes', () => {
  const root = mkdtempSync(join(tmpdir(), 'native-archive-'));
  const archive = join(root, 'products.tar');
  const header = ['products', 'directory', ''];
  try {
    const cases = [
      [['products/app', 'file', '']],
      [['products/../outside', 'file', '']],
      [['products/link', 'link', '../../outside']],
      [
        ['products/link', 'link', 'app'],
        ['products/link/child', 'file', ''],
      ],
      [['products/hard', 'hardlink', '/outside']],
      [
        ['products/app', 'file', ''],
        ['products/app', 'file', ''],
      ],
    ];
    for (const [index, entries] of cases.entries()) {
      execFileSync('python3', ['-c', fixture, archive, JSON.stringify([header, ...entries])]);
      const verify = () => execFileSync(process.execPath, [verifier, archive], { stdio: 'pipe' });
      if (index === 0) assert.doesNotThrow(verify);
      else assert.throws(verify);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
