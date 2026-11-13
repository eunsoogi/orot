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
            if !active && fail { throw Failure.failed }
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
            if active || deactivateFails { throw Failure.failed }
        })
        let token = try owner.reserve()
        XCTAssertThrowsError(try owner.activate(token, category: .record, mode: .default))
        XCTAssertThrowsError(try owner.release(token))
        XCTAssertThrowsError(try owner.reserve())
        deactivateFails = false
        try owner.release(token)
        XCTAssertNoThrow(try owner.reserve())
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
}
