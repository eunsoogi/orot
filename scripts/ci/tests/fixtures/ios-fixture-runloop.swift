import Foundation
import XCTest

/// A queued main-run-loop event models the lifecycle delivery that must remain possible during host preparation.
private final class LifecycleDelivery: @unchecked Sendable {
    static let shared = LifecycleDelivery()
    var delivered = false
}

@objc(FixtureRunLoopProbe)
final class FixtureRunLoopProbe: OrotFailFastTestCase {
    @objc func testLifecycleDeliveryBeforeBody() {
        XCTAssertTrue(LifecycleDelivery.shared.delivered, "Fixture preparation blocked the main run loop")
        if ProcessInfo.processInfo.environment["OROT_FIXTURE_PROBE_FAILURE"] == "YES" {
            XCTFail("Controlled original failure")
        }
    }

    @objc func testLaterBodyMustNotRunAfterFailure() {
        XCTFail("A failed fixture must withhold subsequent bodies")
    }
}

/// The peer deliberately keeps preparation pending longer than this queued event.
/// This is test stimulus, not a production wait allowance or evidence that an iOS app was stopped.
func exerciseFixtureRunLoop() -> Int32 {
    DispatchQueue.global().async {
        Thread.sleep(forTimeInterval: 0.1)
        DispatchQueue.main.async { LifecycleDelivery.shared.delivered = true }
    }
    let suite = XCTestSuite(name: "FixtureRunLoopProbe")
    suite.addTest(FixtureRunLoopProbe(selector: #selector(FixtureRunLoopProbe.testLifecycleDeliveryBeforeBody)))
    let failing = ProcessInfo.processInfo.environment["OROT_FIXTURE_PROBE_FAILURE"] == "YES"
    if failing {
        suite.addTest(FixtureRunLoopProbe(selector: #selector(FixtureRunLoopProbe.testLaterBodyMustNotRunAfterFailure)))
    }
    suite.run()
    if failing {
        let succeeded = suite.testRun!.totalFailureCount == 1 && suite.testRun!.skipCount == 1
        // The controlled failure has finished. Remove only this probe's fresh namespace after observing fail-fast.
        if let invocation = ProcessInfo.processInfo.environment["OROT_IOS_TEST_INVOCATION"],
           UUID(uuidString: invocation) != nil,
           let support = try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: false)
        {
            try? FileManager.default.removeItem(at: support.appendingPathComponent("OrotTestInvocation/\(invocation).txt"))
        }
        return succeeded ? 0 : 1
    }
    return suite.testRun!.totalFailureCount == 0 ? 0 : 1
}
