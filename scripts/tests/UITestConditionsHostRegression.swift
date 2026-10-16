import Foundation

/// Exercise the unchanged public helper entry points with controlled read costs and state transitions.
/// Every scenario is independent and uses the same thirty-second contract as the original UI caller.
@main
enum UITestConditionsHostRegression {
    @MainActor
    static func main() throws {
        var failed = 0
        let cases: [(String, [UIObservationFrame], TimeInterval, Bool)] = [
            ("label matches", [.init(at: 0, label: "completed")], 0.25, true),
            ("value fallback matches", [.init(at: 0, label: "status", value: "completed")], 0.25, true),
            ("mismatch remains failure", [.init(at: 0, label: "recording", value: "recording")], 0.25, false),
            ("missing remains failure", [.init(at: 0, label: "completed", present: false)], 0.25, false),
            ("read error remains failure", [.init(at: 0, label: "completed", unavailable: true)], 0.25, false),
            ("match before deadline", [.init(at: 0, label: "recording"), .init(at: 29, label: "completed")], 0.25, true),
            ("match after deadline", [.init(at: 0, label: "recording"), .init(at: 30.5, label: "completed")], 0.25, false),
            ("single read exceeds deadline", [.init(at: 0, label: "completed")], 31, false),
            ("slow reads match in time", [.init(at: 0, label: "recording"), .init(at: 22, label: "completed")], 7, true),
            ("slow reads observe too late", [.init(at: 0, label: "recording"), .init(at: 30, label: "completed")], 7, false),
        ]
        for (name, frames, cost, expected) in cases {
            UIObservationHost.reset()
            let element = XCUIElement(frames, readCost: cost)
            UITestConditions.value(element, equals: "completed", timeout: 30)
            let actual = UIObservationHost.failures.isEmpty
            let separateReads = ["exists", "label", "value", "description"].reduce(0) { $0 + element.reads[$1, default: 0] }
            let passed = actual == expected && separateReads == 0 &&
                element.reads["snapshot", default: 0] > 0 && UIObservationHost.expectationObjects == 0
            if !passed {
                failed += 1
            }
            try report(name, passed: passed, expected: expected, actual: actual, element: element)
        }
        for cost in [0.25, 31.0] {
            UIObservationHost.reset()
            let element = XCUIElement([.init(at: 0, label: "present")], readCost: cost)
            let actual = UITestConditions.exists(element, timeout: 30)
            let expected = cost <= 30
            let passed = actual == expected && element.reads["exists", default: 0] == 0 &&
                element.reads["waitForExistence", default: 0] == 1
            if !passed {
                failed += 1
            }
            try report("existence read cost \(cost)", passed: passed, expected: expected, actual: actual, element: element)
        }
        if failed > 0 {
            FileHandle.standardError.write(Data("\(failed) controlled observation contracts failed\n".utf8))
            exit(1)
        }
    }

    @MainActor
    private static func report(_ name: String, passed: Bool, expected: Bool, actual: Bool, element: XCUIElement) throws {
        let payload: [String: Any] = [
            "case": name, "passed": passed, "expectedMatch": expected, "actualMatch": actual,
            "virtualElapsedSeconds": UIObservationHost.time, "reads": element.reads,
            "liveExpectationObjects": UIObservationHost.expectationObjects,
            "assertionFailures": UIObservationHost.failures.count,
        ]
        let data = try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
        print(String(decoding: data, as: UTF8.self))
    }
}
