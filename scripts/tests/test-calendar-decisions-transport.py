#!/usr/bin/env python3
"""Exercise production Foundation redirect/cancellation handling against synthetic loopback only.

The harness replaces only the fixed URL literal in a temporary compiler input. No test endpoint
is exposed in the shipped module and no account credentials or calendar records are read.
"""
import http.server
import json
from pathlib import Path
import subprocess
import tempfile
import threading

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'apps/mobile/ios/OrotMobile/CalendarDecisionsRequest.swift'
seen = []


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get('Content-Length', '0')))
        mode = json.loads(body)['mode']
        seen.append((self.path, mode))
        if mode.startswith('redirect'):
            self.send_response(int(mode.removeprefix('redirect')))
            self.send_header('Location', f'http://127.0.0.1:{self.server.server_port}/forbidden')
            self.send_header('Content-Length', '0')
            self.end_headers()
        else:
            payload = b'x' * 262145 if mode == 'oversize' else b'{"synthetic":true}'
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            try:
                self.wfile.write(payload)
            except (BrokenPipeError, ConnectionResetError):
                pass

    def do_GET(self):
        seen.append((self.path, 'get-replay'))
        self.send_response(500)
        self.end_headers()


server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    with tempfile.TemporaryDirectory(prefix='calendar-transport-test-') as temporary:
        temporary = Path(temporary)
        source = SOURCE.read_text()
        endpoint = 'https://api.openai.com/v1/decisions'
        assert source.count(endpoint) == 1
        (temporary / 'Transport.swift').write_text(source.replace(
            endpoint, f'http://127.0.0.1:{server.server_port}/v1/decisions'))
        (temporary / 'Main.swift').write_text('''import Foundation
@main struct Main {
    static func main() async {
        let mode = CommandLine.arguments[1]
        let result: Result<String, Error> = await withCheckedContinuation { continuation in
            let request = CalendarDecisionsRequest { continuation.resume(returning: $0) }
            if mode == "cancel" { request.cancel() }
            request.start(body: "{\\"mode\\":\\"\\(mode)\\"}", apiKey: "synthetic-not-a-secret")
        }
        switch result {
        case .success: print("success")
        case .failure: print("failure")
        }
    }
}
''')
        subprocess.run(['xcrun', 'swiftc', str(temporary / 'Transport.swift'),
                        str(temporary / 'Main.swift'), '-o', str(temporary / 'test')], check=True)
        modes = ['success', 'redirect301', 'redirect302', 'redirect303', 'redirect307',
                 'redirect308', 'oversize', 'cancel']
        for mode in modes:
            result = subprocess.run([str(temporary / 'test'), mode], check=True,
                                    capture_output=True, text=True, timeout=10)
            expected = 'success' if mode == 'success' else 'failure'
            assert result.stdout.strip() == expected, mode
        assert len(seen) == 7, f'unexpected synthetic request count: {len(seen)}'
        assert all(path == '/v1/decisions' for path, _ in seen), 'redirect replay detected'
        assert not any(mode == 'cancel' for _, mode in seen), 'pre-start cancellation leaked request'
        print('PASS: success, 5 redirects without replay, bounded response, pre-start cancellation')
finally:
    server.shutdown()
    server.server_close()
