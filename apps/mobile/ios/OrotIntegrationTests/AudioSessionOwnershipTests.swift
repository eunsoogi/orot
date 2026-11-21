import AVFoundation
import Foundation
@testable import Orot
import XCTest

/// Fake mutations exercise ownership without activating the real system audio session.
final class AudioSessionOwnershipTests: OrotFailFastTestCase {
    func testBusyAndStaleOwnersCannotMutateNewOwner() throws {
        var mutations: [Bool] = []
        let owner = AudioSessionOwnership(configure: { _, _, _ in }, setActive: { mutations.append($0) })
        let first = try owner.reserve()
        try owner.activate(first, category: .record, mode: .default)
        XCTAssertThrowsError(try owner.reserve())
        try owner.suspend(first)
        XCTAssertThrowsError(try owner.reserve())
        try owner.activate(first, category: .record, mode: .default)
        try owner.release(first)
        let second = try owner.reserve()
        try owner.activate(second, category: .playback, mode: .spokenAudio)
        XCTAssertThrowsError(try owner.release(first))
        XCTAssertEqual(mutations, [true, false, true, false, true])
        try owner.release(second)
    }

    func testFailedDeactivationRetainsReservationUntilRetry() throws {
        enum Failure: Error { case failed }
        var fail = true
        let owner = AudioSessionOwnership(configure: { _, _, _ in }, setActive: { active in
            if !active, fail {
                throw Failure.failed
            }
        })
        let token = try owner.reserve()
        try owner.activate(token, category: .record, mode: .default)
        XCTAssertThrowsError(try owner.release(token))
        XCTAssertThrowsError(try owner.reserve())
        fail = false
        try owner.release(token)
        XCTAssertNoThrow(try owner.reserve())
    }

    func testFailedActivationRequiresSuccessfulCleanupBeforeNextOwner() throws {
        enum Failure: Error { case failed }
        var deactivateFails = true
        let owner = AudioSessionOwnership(configure: { _, _, _ in }, setActive: { active in
            if active || deactivateFails {
                throw Failure.failed
            }
        })
        let token = try owner.reserve()
        XCTAssertThrowsError(try owner.activate(token, category: .record, mode: .default))
        XCTAssertThrowsError(try owner.release(token))
        XCTAssertThrowsError(try owner.reserve())
        deactivateFails = false
        try owner.release(token)
        XCTAssertNoThrow(try owner.reserve())
    }

    func testSystemCallPreparationDoesNotActivateBeforeTheSystemCallback() throws {
        var configured = 0
        var mutations: [Bool] = []
        let owner = AudioSessionOwnership(configure: { category, mode, _ in
            XCTAssertEqual(category, .playAndRecord)
            XCTAssertEqual(mode, .voiceChat)
            configured += 1
        }, setActive: { mutations.append($0) })
        let token = try owner.reserve()
        try owner.prepareSystemCall(token)
        XCTAssertEqual(configured, 1)
        XCTAssertEqual(mutations, [])
        XCTAssertThrowsError(try owner.reserve())
        try owner.systemCallActivated(token)
        XCTAssertEqual(mutations, [])
        try owner.release(token)
        XCTAssertEqual(mutations, [false])
        XCTAssertThrowsError(try owner.systemCallActivated(token))
    }

    func testSystemCallLeaseRejectsDelayedCleanupFromPriorCall() {
        var lease = VoiceSystemCallLease()
        let previous = UUID(), next = UUID()
        XCTAssertTrue(lease.acquire(previous))
        XCTAssertFalse(lease.acquire(next))
        XCTAssertTrue(lease.release(previous))
        XCTAssertTrue(lease.acquire(next))
        XCTAssertFalse(lease.release(previous))
        XCTAssertEqual(lease.owner, next)
        XCTAssertTrue(lease.release(next))
    }

    func testConcurrentReservationsHaveExactlyOneWinner() {
        let owner = AudioSessionOwnership(configure: { _, _, _ in }, setActive: { _ in })
        let resultLock = NSLock()
        var winners = 0
        DispatchQueue.concurrentPerform(iterations: 32) { _ in
            if (try? owner.reserve()) != nil {
                resultLock.lock()
                winners += 1
                resultLock.unlock()
            }
        }
        XCTAssertEqual(winners, 1)
    }

    func testConnectedVoiceDurationExcludesDialingAndWaitingForReceipt() {
        var clock: UInt64 = 0
        let duration = VoiceConnectedDuration(nowNanoseconds: { clock })
        duration.begin()
        clock += 8_000_000_000
        duration.markStopped("failed")
        XCTAssertNil(duration.take("failed"))

        duration.markReady("connected")
        clock += 60_000_000_000
        duration.markReady("connected")
        clock += 5_599_000_000
        duration.markStopped("wrong")
        duration.markStopped("connected")
        clock += 20_000_000_000

        XCTAssertNil(duration.take("wrong"))
        let end = duration.take("connected")
        XCTAssertEqual(end?["callId"] as? String, "connected")
        XCTAssertEqual(end?["durationSeconds"] as? Int, 65)
        XCTAssertNil(duration.take("connected"))

        // A backwards sample cannot underflow; exactly one second is not rounded down.
        clock = 10
        duration.markReady("backwards")
        clock = 9
        duration.markStopped("backwards")
        XCTAssertNil(duration.take("backwards"))
        duration.markReady("boundary")
        clock += 1_000_000_000
        duration.markStopped("boundary")
        XCTAssertEqual(duration.take("boundary")?["durationSeconds"] as? Int, 1)
    }

    func testNewVoiceOwnerNeverReceivesPreviousReceipt() {
        let duration = VoiceConnectedDuration()
        duration.begin()
        duration.markReady("old")
        duration.markStopped("old")
        duration.begin()
        XCTAssertNil(duration.take("old"))
        duration.markReady("next")
        duration.markStopped("next")
        XCTAssertNil(duration.take("old"))
        XCTAssertEqual(duration.take("next")?["callId"] as? String, "next")
    }
}
