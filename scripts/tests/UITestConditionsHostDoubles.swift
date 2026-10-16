import Foundation

/// Replaces only XCTest's external observation and scheduling boundary while compiling the actual helper.
/// Virtual time makes delayed reads deterministic; these doubles do not reproduce Apple's accessibility service.
@MainActor
enum UIObservationHost {
    static var time: TimeInterval = 0
    static var failures: [String] = []
    static var expectationObjects = 0

    static func reset() {
        time = 0
        failures = []
        expectationObjects = 0
    }
}

/// The helper's monotonic clock resolves to this module-local type only in the host regression executable.
@MainActor
struct ProcessInfo {
    static let processInfo = ProcessInfo()
    var systemUptime: TimeInterval {
        UIObservationHost.time
    }
}

struct UIObservationFrame {
    let at: TimeInterval
    let label: String
    var value: String?
    var present = true
    var unavailable = false
}

struct XCUIElementSnapshot {
    let label: String
    let value: Any?
}

@MainActor
class XCUIElement {
    enum ElementType { case any }
    let frames: [UIObservationFrame]
    let readCost: TimeInterval
    var reads: [String: Int] = [:]

    init(_ frames: [UIObservationFrame], readCost: TimeInterval = 0.25) {
        self.frames = frames
        self.readCost = readCost
    }

    private var frame: UIObservationFrame {
        frames.last(where: { $0.at <= UIObservationHost.time }) ??
            UIObservationFrame(at: 0, label: "", present: false)
    }

    private func read(_ name: String) -> UIObservationFrame {
        reads[name, default: 0] += 1
        UIObservationHost.time += readCost
        return frame
    }

    var exists: Bool {
        let observed = read("exists")
        return observed.present && !observed.unavailable
    }

    var label: String {
        read("label").label
    }

    var value: Any? {
        read("value").value
    }

    var isHittable: Bool {
        true
    }

    var debugDescription: String {
        _ = read("description")
        return "host element"
    }

    func snapshot() throws -> XCUIElementSnapshot {
        let observed = read("snapshot")
        guard observed.present, !observed.unavailable else {
            throw NSError(domain: "ControlledObservation", code: 1)
        }
        return XCUIElementSnapshot(label: observed.label, value: observed.value)
    }

    /// Model the public wait contract, including a read that returns after its deadline.
    func waitForExistence(timeout: TimeInterval) -> Bool {
        reads["waitForExistence", default: 0] += 1
        let deadline = UIObservationHost.time + timeout
        while UIObservationHost.time <= deadline {
            let observed = read("waitObservation")
            if UIObservationHost.time <= deadline, observed.present {
                return true
            }
            UIObservationHost.time += 1
        }
        return false
    }
}

@MainActor
final class XCUIElementQuery {
    let firstMatch = XCUIElement([])
    func matching(identifier _: String) -> XCUIElementQuery {
        self
    }
}

@MainActor
final class XCUIApplication: XCUIElement {
    func descendants(matching _: ElementType) -> XCUIElementQuery {
        XCUIElementQuery()
    }

    func swipeUp() {}
}

@MainActor
final class XCTNSPredicateExpectation {
    let predicate: NSPredicate
    let object: Any?
    var isInverted = false
    var handler: (() -> Bool)?

    init(predicate: NSPredicate, object: Any?) {
        self.predicate = predicate
        self.object = object
        if object != nil {
            UIObservationHost.expectationObjects += 1
        }
    }
}

@MainActor
enum XCTWaiter {
    enum Result: Equatable { case completed, timedOut, interrupted }

    static func wait(for conditions: [XCTNSPredicateExpectation], timeout: TimeInterval) -> Result {
        let deadline = UIObservationHost.time + timeout
        while UIObservationHost.time <= deadline {
            // Like a synchronous predicate, evaluation may return after the waiter's nominal budget.
            // The helper must reject late matching observations itself instead of relying on cancellation.
            if conditions.allSatisfy({ $0.predicate.evaluate(with: $0.object) }) {
                return .completed
            }
            UIObservationHost.time += 1
        }
        return .timedOut
    }
}

@MainActor
func XCTAssertEqual<T: Equatable>(_ actual: T, _ expected: T, _ message: @autoclosure () -> String = "") {
    if actual != expected {
        UIObservationHost.failures.append(message())
    }
}

@MainActor
func XCTAssertTrue(_ actual: Bool, _ message: @autoclosure () -> String = "") {
    if !actual {
        UIObservationHost.failures.append(message())
    }
}

/// Advances only the host regression clock; this is scheduling, never a successful condition.
@MainActor
enum RunLoop {
    static let current = Loop()
    @MainActor
    struct Loop {
        func run(until _: Date) {
            UIObservationHost.time += 1
        }
    }
}
