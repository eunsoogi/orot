import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

// This regression compiles the actual common base against Apple's XCTest. Linux cannot execute that boundary.
test(
  'host fixture preparation leaves XCTest lifecycle delivery responsive',
  { skip: process.platform !== 'darwin' },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), 'orot-fixture-runloop-'));
    const main = join(directory, 'main.swift');
    const binary = join(directory, 'probe');
    const platform = spawnSync('xcrun', ['--sdk', 'macosx', '--show-sdk-platform-path'], {
      encoding: 'utf8',
    });
    assert.equal(platform.status, 0, platform.stderr);
    const frameworks = join(platform.stdout.trim(), 'Developer/Library/Frameworks');
    const libraries = join(platform.stdout.trim(), 'Developer/usr/lib');
    writeFileSync(main, 'import Foundation\nexit(exerciseFixtureRunLoop())\n');
    let child;
    const requests = [];
    const server = createServer((socket) => {
      let input = '';
      socket.on('data', (data) => {
        input += data;
        if (!input.endsWith('\n')) return;
        const request = JSON.parse(input);
        requests.push(request.stage);
        // Holding the host callback open exposes a blocking setup even when the socket eventually succeeds.
        setTimeout(
          () =>
            socket.end(
              JSON.stringify({ session: request.session, token: request.token, ok: true }),
            ),
          request.stage === 'prepare' ? 500 : 0,
        );
      });
    });
    try {
      const build = spawnSync(
        'xcrun',
        [
          'swiftc',
          '-F',
          frameworks,
          '-I',
          libraries,
          '-L',
          libraries,
          '-lXCTestSwiftSupport',
          '-framework',
          'XCTest',
          '-Xlinker',
          '-rpath',
          '-Xlinker',
          libraries,
          '-Xlinker',
          '-rpath',
          '-Xlinker',
          frameworks,
          resolve('apps/mobile/ios/OrotTestSupport/OrotFailFastTestCase.swift'),
          resolve('scripts/ci/tests/fixtures/ios-fixture-runloop.swift'),
          main,
          '-o',
          binary,
        ],
        { encoding: 'utf8' },
      );
      assert.equal(build.status, 0, build.stderr);
      await new Promise((done) => server.listen(0, '127.0.0.1', done));
      for (const failing of [false, true]) {
        requests.length = 0;
        child = spawn(binary, [], {
          env: {
            ...process.env,
            OROT_IOS_TEST_INVOCATION: randomUUID(),
            OROT_IOS_FIXTURE_SESSION: randomUUID(),
            OROT_IOS_FIXTURE_PORT: String(server.address().port),
            OROT_FIXTURE_PROBE_FAILURE: failing ? 'YES' : 'NO',
          },
        });
        let output = '';
        child.stdout.on('data', (data) => (output += data));
        child.stderr.on('data', (data) => (output += data));
        const status = await new Promise((done, reject) => {
          child.once('error', reject);
          child.once('exit', done);
        });
        assert.equal(status, 0, output);
        assert.deepEqual(requests, ['prepare', 'complete']);
        if (failing) {
          assert.match(output, /Controlled original failure/);
          assert.match(output, /Not run after failed or interrupted case/);
          assert.doesNotMatch(output, /OROT_TEST_CASE_CLEARED/);
        } else assert.match(output, /OROT_TEST_CASE_CLEARED/);
      }
    } finally {
      if (child?.exitCode === null) child.kill('SIGTERM');
      if (server.listening) await new Promise((done) => server.close(done));
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
