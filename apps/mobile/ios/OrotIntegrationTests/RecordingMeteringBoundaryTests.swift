@testable import Orot
import XCTest

/// Retains interruption handling during capture while excluding a permission event queued before the recorder exists.
final class RecordingMeteringBoundaryTests: XCTestCase {
    func testNotificationOccurrencePrecedesQueueDeliveryWithoutChangingActiveCaptureProtection() {
        XCTAssertFalse(RecordingMeteringProbeModule.interruptionApplies(observedAt: 9, captureBeganAt: nil))
        XCTAssertFalse(RecordingMeteringProbeModule.interruptionApplies(observedAt: 9, captureBeganAt: 10))
        XCTAssertTrue(RecordingMeteringProbeModule.interruptionApplies(observedAt: 10, captureBeganAt: 10))
        XCTAssertTrue(RecordingMeteringProbeModule.interruptionApplies(observedAt: 11, captureBeganAt: 10))
    }
}
