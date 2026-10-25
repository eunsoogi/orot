#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
orot_report_root="$(mktemp -d "${TMPDIR:-/tmp}/orot-transcript-report.XXXXXX")"
trap 'rm -rf "$orot_report_root"' EXIT

# Compile the actual Foundation-only decoder declaration without launching XCTest or a Simulator.
sed -n '/^struct TranscriptPlaybackReport:/,$p' \
  "$repository_root/apps/mobile/ios/OrotUITests/TranscriptEvidenceUITests.swift" >"$orot_report_root/report.swift"
cat >"$orot_report_root/main.swift" <<'SWIFT'
import Foundation

let valid: [String: Any] = ["startMs": 250, "endMs": 1801, "actualStartMs": 251,
                          "actualEndMs": 1801, "completion": "completed"]
func decode(_ payload: [String: Any]) throws -> TranscriptPlaybackReport {
    try JSONDecoder().decode(TranscriptPlaybackReport.self, from: JSONSerialization.data(withJSONObject: payload))
}
let report = try decode(valid)
precondition(report.startMs == 250 && report.endMs == 1801 && abs(report.actualStartMs - 250) <= 50)
precondition(report.completion == "completed" && report.actualEndMs == 1801)
print("PASS mixed native metadata retains original numeric oracle and completion evidence")
for field in ["startMs", "endMs", "actualStartMs", "actualEndMs"] {
    for invalid in ["wrong", "missing", "null", "boolean"] {
        var payload = valid
        switch invalid {
        case "missing": payload.removeValue(forKey: field)
        case "null": payload[field] = NSNull()
        case "boolean": payload[field] = true
        default: payload[field] = "250"
        }
        do {
            _ = try decode(payload)
            fatalError("Invalid numeric field accepted: \(field) \(invalid)")
        } catch {
            print("PASS rejects \(field) \(invalid)")
        }
    }
}
SWIFT
xcrun swiftc "$orot_report_root/report.swift" "$orot_report_root/main.swift" -o "$orot_report_root/regression"
"$orot_report_root/regression"
