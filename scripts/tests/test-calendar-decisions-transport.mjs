import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

// Exercise production Foundation against loopback synthetic data, never real credentials.
// Only a temporary compiler input substitutes the endpoint; shipped code stays fixed-origin.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const execute = promisify(execFile);
const seen = [];
const server = http.createServer(async (request, response) => {
  if (request.method !== 'POST') {
    seen.push({ path: request.url, mode: 'get-replay' });
    response.writeHead(500).end();
    return;
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const { mode } = JSON.parse(Buffer.concat(chunks).toString());
  seen.push({ path: request.url, mode });
  if (mode.startsWith('redirect')) {
    response
      .writeHead(Number(mode.slice(8)), {
        Location: `http://127.0.0.1:${server.address().port}/forbidden`,
        'Content-Length': 0,
      })
      .end();
    return;
  }
  const payload = mode === 'oversize' ? 'x'.repeat(262145) : '{"synthetic":true}';
  response.writeHead(200, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  response.end(payload);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const temporary = await mkdtemp(path.join(os.tmpdir(), 'calendar-transport-test-'));
try {
  const source = await readFile(
    path.join(root, 'apps/mobile/ios/OrotMobile/CalendarDecisionsRequest.swift'),
    'utf8',
  );
  const endpoint = 'https://api.openai.com/v1/decisions';
  assert.equal(source.split(endpoint).length, 2);
  await writeFile(
    path.join(temporary, 'Transport.swift'),
    source.replace(endpoint, `http://127.0.0.1:${server.address().port}/v1/decisions`),
  );
  await writeFile(
    path.join(temporary, 'Main.swift'),
    'import Foundation\n@main struct Main {\n    static func main() async {\n        let mode = CommandLine.arguments[1]\n        let result: Result<String, Error> = await withCheckedContinuation { continuation in\n            let request = CalendarDecisionsRequest { continuation.resume(returning: $0) }\n            if mode == "cancel" { request.cancel() }\n            request.start(body: "{\\"mode\\":\\"\\(mode)\\"}", apiKey: "synthetic-not-a-secret")\n        }\n        switch result {\n        case .success: print("success")\n        case .failure: print("failure")\n        }\n    }\n}\n',
  );
  const binary = path.join(temporary, 'test');
  await execute('xcrun', [
    'swiftc',
    path.join(temporary, 'Transport.swift'),
    path.join(temporary, 'Main.swift'),
    '-o',
    binary,
  ]);
  for (const mode of [
    'success',
    'redirect301',
    'redirect302',
    'redirect303',
    'redirect307',
    'redirect308',
    'oversize',
    'cancel',
  ]) {
    const result = await execute(binary, [mode], { timeout: 10000 });
    assert.equal(result.stdout.trim(), mode === 'success' ? 'success' : 'failure', mode);
  }
  assert.equal(seen.length, 7, 'unexpected synthetic request count');
  assert.ok(
    seen.every((item) => item.path === '/v1/decisions'),
    'redirect replay detected',
  );
  assert.ok(
    seen.every((item) => item.mode !== 'cancel'),
    'pre-start cancellation leaked request',
  );
  console.log(
    'PASS: success, 5 redirects without replay, bounded response, pre-start cancellation',
  );
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(temporary, { recursive: true, force: true });
}
