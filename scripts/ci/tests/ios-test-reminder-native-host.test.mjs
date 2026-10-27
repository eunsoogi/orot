import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('native sentinel privacy, same-error propagation, writer gates and terminal failure precede success', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-reminder-native-host-'));
  try {
    const module = readFileSync(
      'apps/mobile/ios/OrotMobile/AppointmentReminderModule.swift',
      'utf8',
    );
    const notifications = readFileSync(
      'apps/mobile/ios/OrotMobile/AppointmentReminderNotifications.swift',
      'utf8',
    );
    const form = readFileSync(
      'apps/mobile/ios/OrotUITests/ReminderJourneyDiagnostic.swift',
      'utf8',
    );
    const enums = module.slice(
      module.indexOf('enum AppointmentReminderDiagnosticStage'),
      module.indexOf('/// Ordinary products'),
    );
    const errors = notifications.slice(
      notifications.indexOf('enum AppointmentReminderError'),
      notifications.indexOf('/// Keeps feature-owned'),
    );
    const terminal = form.slice(
      form.indexOf('    static func failConfirmedRejection'),
      form.indexOf('    private static func diagnosticValue'),
    );
    let trace = readFileSync(
      'apps/mobile/ios/OrotMobile/AppointmentReminderDiagnosticTrace.swift',
      'utf8',
    );
    // The host overlay changes only the destination; the actual encoder, gating and I/O code execute unchanged.
    trace = trace.replace(
      /FileManager\.default\.urls\(for: \.cachesDirectory, in: \.userDomainMask\)\.first\?\s*\.appendingPathComponent\(fileName\)/,
      `URL(fileURLWithPath: ${JSON.stringify(join(directory, 'trace.jsonl'))})`,
    );
    writeFileSync(join(directory, 'Trace.swift'), trace);
    writeFileSync(
      join(directory, 'main.swift'),
      `import Foundation
${enums}
${errors}
enum Terminal { ${terminal} }
@main struct Control {
  static func main() async throws {
    let sentinel = NSError(domain: "private-domain", code: 47, userInfo: [NSLocalizedDescriptionKey: "private-health", "appointmentId": "private-visit"])
    var events: [AppointmentReminderDiagnosticStage] = []
    var observed: Error?
    do {
      try await AppointmentReminderDiagnosticTrace.aroundAdd(emit: { stage, error in events.append(stage); observed = error }, enabled: true) { throw sentinel }
      fatalError("Missing original rejection")
    } catch {
      precondition(error as NSError === sentinel)
      precondition(observed as NSError? === sentinel)
    }
    precondition(events == [.centerAddEnter, .centerAddReject])
    let event = AppointmentReminderDiagnosticTrace.Event(runID: UUID().uuidString, processID: 1, callSequence: 1, monotonicNanoseconds: "1", stage: .centerAddReject, error: sentinel)
    let data = try event.jsonLine()
    let value = try JSONSerialization.jsonObject(with: data) as! [String: Any]
    precondition(value["errorDomain"] as? String == "other")
    precondition(value["errorCode"] as? Int == 47)
    precondition(!String(decoding: data, as: UTF8.self).contains("private-"))
    var order: [String] = []
    do {
      try Terminal.failConfirmedRejection(["outcome": "reject", "status": "error", "busy": false, "currentBusy": false, "currentStatus": "error"]) { order.append("failure-evidence") }
      order.append("success-assertion")
    } catch { order.append("thrown") }
    precondition(order == ["failure-evidence", "thrown"])
    try Terminal.failConfirmedRejection(["outcome": "resolve", "status": "scheduled", "busy": false]) { fatalError("False product failure") }
    for value: [String: Any] in [["outcome": "begin", "status": "error", "busy": false], ["outcome": "reject", "status": "error", "busy": false, "currentBusy": true, "currentStatus": "error"]] {
      try Terminal.failConfirmedRejection(value) { fatalError("Unconfirmed product failure") }
    }
    await AppointmentReminderDiagnosticTrace.withOperation {
      AppointmentReminderDiagnosticTrace.record(.bridgeEnter)
      await Task { AppointmentReminderDiagnosticTrace.record(.centerAddEnter) }.value
      AppointmentReminderDiagnosticTrace.record(.bridgeReject, error: sentinel)
    }
    let ready = AppointmentReminderDiagnosticTrace.readiness
    if ready["status"] as? String == "ready" {
      let path = URL(fileURLWithPath: ${JSON.stringify(join(directory, 'trace.jsonl'))})
      if ProcessInfo.processInfo.environment["OROT_HOST_WRITER_FAILURE"] == "io" {
        try FileManager.default.removeItem(at: path)
        try FileManager.default.createDirectory(at: path, withIntermediateDirectories: false)
        precondition(!AppointmentReminderDiagnosticTrace.record(.bridgeEnter))
      } else {
        var failed = false
        for _ in 0..<1000 {
          if !AppointmentReminderDiagnosticTrace.record(.bridgeEnter) { failed = true; break }
        }
        precondition(failed)
      }
      do {
        try await AppointmentReminderDiagnosticTrace.aroundAdd { throw sentinel }
        fatalError("Writer failure must not swallow original error")
      } catch { precondition(error as NSError === sentinel) }
      precondition(AppointmentReminderDiagnosticTrace.currentReadiness()["status"] as? String == "writer-failed")
      print("ready->writer-failed")
    } else { print(ready["status"] as! String) }
  }
}
`,
    );
    const binary = join(directory, 'control');
    execFileSync(
      'swiftc',
      [
        '-parse-as-library',
        '-D',
        'OROT_TESTS',
        join(directory, 'Trace.swift'),
        join(directory, 'main.swift'),
        '-o',
        binary,
      ],
      { timeout: 60000 },
    );
    const run = (flag, runID, failure = 'capacity') =>
      execFileSync(binary, [], {
        encoding: 'utf8',
        timeout: 10000,
        env: {
          ...process.env,
          OROT_HOST_WRITER_FAILURE: failure,
          OROT_TEST_REMINDER_DIAGNOSTICS: flag,
          OROT_TEST_REMINDER_DIAGNOSTIC_RUN_ID: runID,
        },
      }).trim();
    assert.equal(run('NO', ''), 'disabled');
    assert.equal(run('YES', 'invalid'), 'invalid-run-id');
    assert.equal(run('YES', '9ae30a38-2911-4555-b5a3-948a6ec879d9'), 'ready->writer-failed');
    const bytes = readFileSync(join(directory, 'trace.jsonl'), 'utf8');
    const records = bytes
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(records[3].stage, 'diagnostic-ready');
    assert.deepEqual(
      records.slice(0, 3).map((value) => value.operationSequence),
      [1, 1, 1],
    );
    assert.equal(bytes.includes('private-'), false);
    rmSync(join(directory, 'trace.jsonl'));
    assert.equal(run('YES', '9ae30a38-2911-4555-b5a3-948a6ec879d9', 'io'), 'ready->writer-failed');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
