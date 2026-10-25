#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
orot_deadline_root="$(mktemp -d "${TMPDIR:-/tmp}/orot-residual-deadlines.XXXXXX")"
trap 'rm -rf "$orot_deadline_root"' EXIT

# Compile the real acceptance expressions and teardown envelopes with a virtual host clock.
# Native UI bodies are not replaced or claimed as executed by this controlled boundary regression.
python3 - "$repository_root" "$orot_deadline_root" <<'PY'
import pathlib,re,sys
root=pathlib.Path(sys.argv[1]);out=pathlib.Path(sys.argv[2]);ui=root/'apps/mobile/ios/OrotUITests'
appointments=(ui/'AppointmentsUITests.swift').read_text()
navigation=(ui/'AiFeatureNavigationUITests.swift').read_text()
appearance=(ui/'AppearanceUITestConditions.swift').read_text()
envelope=appointments.split('let app = XCUIApplication()',1)[1].split('        try launch(app)',1)[0]
clock=re.findall(r'        let started = ContinuousClock.now\n',navigation)
gate=re.findall(r'        XCTAssertLessThan\(started.duration\(to: .now\).*\n',navigation)
assert len(clock)<=1 and len(gate)<=1
observation=appearance.split('    struct Observation: Codable {',1)[1].split('    static func decodeObservation',1)[0]
observation='struct Observation: Codable {'+observation
predicate=appearance.split('            return observationElapsed',1)
if len(predicate)==2:
    expression='return observationElapsed'+predicate[1].split('\n        }, object: nil)',1)[0]
else:
    expression='return lastObservation?.matches('+appearance.split('            return lastObservation?.matches(',1)[1].split('\n        }, object: nil)',1)[0]
template=r'''
import Foundation
@MainActor enum Host { static var time: Double = 0; static var failures = 0; static var terminations = 0 }
@MainActor struct ProcessInfo {
    static let processInfo = ProcessInfo()
    var systemUptime: Double { Host.time }
}
@MainActor enum ContinuousClock {
    struct Instant {
        let time: Double
        @MainActor static var now: Instant { .init(time: Host.time) }
        func duration(to end: Instant) -> Duration { .seconds(end.time - time) }
    }
    static var now: Instant { .init(time: Host.time) }
}
@MainActor final class App { func terminate() { Host.terminations += 1 } }
@MainActor func XCTAssertLessThanOrEqual<T: Comparable>(_ value: T, _ limit: T) { if value > limit { Host.failures += 1 } }
@MainActor func XCTAssertLessThan<T: Comparable>(_ value: T, _ limit: T, _ message: String) { if value >= limit { Host.failures += 1 } }
__OBSERVATION__
@MainActor func appointment(elapsed: Double) {
    let app = App()
__APPOINTMENT__
    Host.time = elapsed
}
@MainActor func navigation(elapsed: Double) {
__CLOCK__
    let app = App()
    defer { app.terminate() }
    Host.time = elapsed
__NAVIGATION_GATE__
}
func appearance(elapsed: Double, receipt: Observation) -> Bool {
    let observationElapsed = elapsed
    let lastObservation: Observation? = receipt
    let session = "owned", command = "dark", applicationScheme = "dark", expectedOverride = 2
    let previousObservation = Observation(session: session, status: "refreshed", command: "light", appliedCount: 1,
        applicationScheme: "light", windowStyle: 1, overrideStyle: 1, originalOverrideStyle: 0)
    __PREDICATE__
}
@main enum Regression {
    @MainActor static func main() {
        var failed = 0
        for (name, scenario) in [("appointments", appointment), ("navigation", navigation)] {
            for elapsed in [5.0, 181.0] {
                Host.time = 0; Host.failures = 0; Host.terminations = 0
                scenario(elapsed)
                let passed = Host.failures == 0 && Host.terminations == 1
                print("\(passed ? "PASS" : "FAIL") \(name) completed after \(elapsed)s; failures=\(Host.failures) ownedAppTerminations=\(Host.terminations)")
                if !passed { failed += 1 }
            }
        }
        for invalid in ["none", "session", "status", "command", "count", "scheme", "window", "override", "original"] {
            let receipt = Observation(session: invalid == "session" ? "foreign" : "owned",
                status: invalid == "status" ? "pending" : "refreshed", command: invalid == "command" ? "light" : "dark",
                appliedCount: invalid == "count" ? 1 : 2, applicationScheme: invalid == "scheme" ? "light" : "dark",
                windowStyle: invalid == "window" ? 1 : 2, overrideStyle: invalid == "override" ? 1 : 2,
                originalOverrideStyle: invalid == "original" ? 1 : 0)
            for elapsed in [0.5, 11.0] {
                let actual = appearance(elapsed: elapsed, receipt: receipt)
                let passed = actual == (invalid == "none")
                print("\(passed ? "PASS" : "FAIL") appearance \(invalid) after \(elapsed)s; accepted=\(actual)")
                if !passed { failed += 1 }
            }
        }
        if failed > 0 { exit(1) }
    }
}
'''
for key,value in {'__OBSERVATION__':observation,'__APPOINTMENT__':envelope,'__CLOCK__':''.join(clock),
                  '__NAVIGATION_GATE__':''.join(gate),'__PREDICATE__':expression}.items():
    template=template.replace(key,value)
(out/'regression.swift').write_text(template)
PY
xcrun swiftc -parse-as-library "$orot_deadline_root/regression.swift" -o "$orot_deadline_root/regression"
"$orot_deadline_root/regression"
