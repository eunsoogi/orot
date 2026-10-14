import Foundation
import XCTest

private final class OrotTestInvocationState: NSObject, XCTestObservation, @unchecked Sendable {
    static let shared = OrotTestInvocationState()
    private let lock = NSLock()

    override private init() {
        super.init()
        XCTestObservationCenter.shared.addTestObserver(self)
    }

    private func marker() throws -> URL {
        guard let raw = ProcessInfo.processInfo.environment["OROT_IOS_TEST_INVOCATION"], UUID(uuidString: raw) != nil else {
            throw NSError(domain: "OrotTestInvocation", code: 1, userInfo: [NSLocalizedDescriptionKey: "Run native tests through run-ios-tests.mjs with a fresh invocation UUID"])
        }
        let root = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appendingPathComponent("OrotTestInvocation", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return root.appendingPathComponent(raw + ".txt")
    }

    /// The marker survives a runner crash. Only identifiers are stored; failure details and health data stay out.
    func enter(_ name: String) throws {
        try lock.withLock {
            let file = try marker()
            if FileManager.default.fileExists(atPath: file.path) {
                let previous = try String(contentsOf: file, encoding: .utf8)
                throw XCTSkip("Not run after failed or interrupted case \(previous)")
            }
            try name.write(to: file, atomically: true, encoding: .utf8)
            print("OROT_TEST_CASE_ENTER \(name)")
        }
    }

    /// XCTest calls this after teardown. A warning is successful; a failure, skip or interrupted runner retains the marker.
    func testCaseDidFinish(_ testCase: XCTestCase) {
        lock.withLock {
            guard testCase.testRun?.hasSucceeded == true,
                  testCase.testRun?.hasBeenSkipped == false else { return }
            do {
                let file = try marker()
                guard try String(contentsOf: file, encoding: .utf8) == testCase.name else { return }
                try FileManager.default.removeItem(at: file)
                print("OROT_TEST_CASE_CLEARED \(testCase.name)")
            } catch {
                testCase.record(XCTIssue(type: .system, compactDescription: "Test invocation marker cleanup failed: \(error)"))
            }
        }
    }
}

/// Compiled into test targets only. Each xcodebuild invocation owns a fresh namespace in its runner sandbox.
/// This cannot intercept bootstrap failures before setup, or coordinate different test-target sandboxes.
class OrotFailFastTestCase: XCTestCase {
    /// XCTest still invokes nonthrowing setup after a skip; subclasses must keep it limited to local flags.
    override final func setUpWithError() throws {
        try super.setUpWithError()
        try OrotTestInvocationState.shared.enter(name)
    }
}
