import Foundation
@testable import Orot
import XCTest

@MainActor
final class WorkoutAssociatedParentPairTests: XCTestCase {
    private typealias Pair = WorkoutAssociatedParentPair

    @MainActor
    private final class Reader {
        var current = true
        var starts: [Int] = []
        var consumed: [Int] = []
        var held: [Int: CheckedContinuation<Int, any Error>] = [:]

        func read(_ input: Int) async throws -> Int {
            starts.append(input)
            return try await withCheckedThrowingContinuation { held[input] = $0 }
        }

        func finish(_ input: Int) {
            held.removeValue(forKey: input)?.resume(returning: input * 2)
        }

        func fail(_ input: Int) {
            held.removeValue(forKey: input)?.resume(throwing: Pair.Stopped.retired)
        }

        func finishAll() {
            held.keys.sorted().forEach(finish)
        }

        func start() -> Task<Void, any Error> {
            Task { @MainActor in
                try await Pair.forEach([10, 20, 30, 40, 50], active: { self.current }, prepare: { $0 }, read: { try await self.read($0) }) {
                    _, result in self.consumed.append(result)
                }
            }
        }
    }

    private func eventually(_ condition: @MainActor () -> Bool) async throws {
        for _ in 0 ..< 500 {
            if condition() {
                return
            }
            try await Task.sleep(for: .milliseconds(1))
        }
        throw Pair.Stopped.retired
    }

    private func assertStopped(_ task: Task<Void, any Error>) async {
        do {
            try await task.value
            XCTFail("Retired work unexpectedly completed")
        } catch Pair.Stopped.retired {
            return
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testExactlyTwoPendingAndOrderedEquivalenceToSerial() async throws {
        let reader = Reader()
        let task = reader.start()
        defer { task.cancel(); reader.finishAll() }
        await Task.yield()
        try await eventually { reader.held.count == 2 }
        XCTAssertEqual(Set(reader.starts), [10, 20])
        reader.finish(20)
        await Task.yield()
        XCTAssertEqual(reader.consumed, [])
        reader.finish(10)
        try await eventually { reader.held.count == 2 }
        XCTAssertEqual(reader.consumed, [20, 40])
        XCTAssertEqual(Set(reader.starts), [10, 20, 30, 40])
        reader.finish(40)
        reader.finish(30)
        try await eventually { reader.held[50] != nil }
        reader.finish(50)
        try await task.value
        let serial = [10, 20, 30, 40, 50].map { $0 * 2 }
        XCTAssertEqual(reader.consumed, serial)
        XCTAssertEqual(reader.starts.count, serial.count)
        // The ordered traversal must retain the same lowercase membership
        // witness, including byte-length prefixes and leading zero nibbles.
        let observed = ["운동", "", "source:0"] + reader.consumed.map(String.init)
        XCTAssertEqual(
            WorkoutPeriodMembershipDigest.digest(observed),
            "fa4fd6359bca4a73ab91bbc40968262c3e3096540c22360c2648a97546fe763a",
        )
    }

    func testLostOwnerAndCancelledCallerCannotConsumeOrStartNextPair() async throws {
        for cancel in [false, true] {
            let reader = Reader()
            let task = reader.start()
            defer { task.cancel(); reader.finishAll() }
            try await eventually { reader.held.count == 2 }
            if cancel {
                task.cancel()
            } else {
                reader.current = false
            }
            reader.finishAll()
            await assertStopped(task)
            XCTAssertEqual(Set(reader.starts), [10, 20])
            XCTAssertTrue(reader.consumed.isEmpty)
        }
    }

    func testInvalidPreparationOrConsumptionDoesNotReadLaterWorkouts() async throws {
        let reader = Reader()
        do {
            try await Pair.forEach([10, 20, 30], active: { true }, prepare: { input in
                if input == 20 {
                    throw Pair.Stopped.retired
                }
                return input
            }, read: { input in reader.starts.append(input); return input }, consume: { _, _ in XCTFail() })
            XCTFail("Invalid preparation was accepted")
        } catch Pair.Stopped.retired {}
        XCTAssertTrue(reader.starts.isEmpty)
        do {
            try await Pair.forEach([10, 20, 30], active: { true }, prepare: { $0 },
                                   read: { input in reader.starts.append(input); return input }, consume: { _, _ in
                                       throw Pair.Stopped.retired
                                   })
            XCTFail("Invalid consumption was accepted")
        } catch Pair.Stopped.retired {}
        XCTAssertEqual(Set(reader.starts), [10, 20])
    }

    func testFirstQueryErrorCancelsIndependentlyHeldSibling() async throws {
        let reader = Reader()
        var siblingStarted = false
        var siblingCancelled = false
        let task = Task { @MainActor in
            try await Pair.forEach([10, 20, 30], active: { true }, prepare: { $0 }, read: { input in
                if input == 10 {
                    return try await reader.read(input)
                }
                siblingStarted = true
                do {
                    try await Task.sleep(for: .seconds(2))
                } catch is CancellationError {
                    siblingCancelled = true
                }
                return input
            }, consume: { _, _ in XCTFail("A failing pair cannot contribute") })
        }
        defer { task.cancel(); reader.finishAll() }
        try await eventually { reader.held[10] != nil && siblingStarted }
        reader.fail(10)
        await assertStopped(task)
        XCTAssertTrue(siblingCancelled)
    }
}
