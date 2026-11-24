import Foundation
@testable import NativeSwiftRegressions
import XCTest

final class WorkoutPeriodQuantityRoutingTests: XCTestCase {
    typealias Accumulator = WorkoutPeriodQuantityAccumulator

    func testRouteSeparatesSingletonsFromRealSeries() {
        XCTAssertEqual(Accumulator.retrievalRoute(quantityCount: 1), .singleton)
        XCTAssertEqual(Accumulator.retrievalRoute(quantityCount: 2), .series)
        XCTAssertNil(Accumulator.retrievalRoute(quantityCount: 0))
        XCTAssertNil(Accumulator.retrievalRoute(quantityCount: -1))
    }

    func testMixedExactAssociatedInputsKeepTheSampleWeightedPeriod() {
        let singleton = UUID()
        let series = UUID()
        let start = Date(timeIntervalSince1970: 100)
        let end = Date(timeIntervalSince1970: 400)
        let window = Accumulator.Window(start: start, end: end)
        let secondary = Accumulator.Window(start: start.addingTimeInterval(20), end: end)
        var aggregate = Accumulator(parents: [
            singleton: .init(quantityCount: 1, eligibleWindows: [window, secondary]),
            series: .init(quantityCount: 3, eligibleWindows: [window]),
        ])
        aggregate.accept(parentID: singleton, start: start, end: start, bpm: 120)
        aggregate.accept(parentID: series, start: start, end: start, bpm: 90)
        aggregate.accept(parentID: series, start: start, end: start, bpm: 90)
        aggregate.accept(parentID: series, start: end, end: end, bpm: 200)
        XCTAssertEqual(aggregate.finish(completed: true), .available(.init(sampleCount: 3, minimum: 90, mean: 100, maximum: 120)))
    }

    func testWrongOrIncompleteMembershipAndCancellationNeverBecomeAnAverage() {
        let parent = UUID()
        let start = Date(timeIntervalSince1970: 100)
        let window = Accumulator.Window(start: start, end: start.addingTimeInterval(60))
        var aggregate = Accumulator(parents: [parent: .init(quantityCount: 2, eligibleWindows: [window])])
        aggregate.accept(parentID: parent, start: start, end: start, bpm: 90)
        XCTAssertEqual(aggregate.finish(completed: true), .unavailable)
        XCTAssertEqual(aggregate.finish(completed: false), .unavailable)
        aggregate.accept(parentID: UUID(), start: start, end: start, bpm: 110)
        aggregate.accept(parentID: parent, start: start, end: start, bpm: 110)
        XCTAssertEqual(aggregate.finish(completed: true), .unavailable)
    }
    func testRecordsRollingMonthUsesObservedLocalDatesAcrossDST() throws {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        func date(_ timestamp: String) throws -> Date {
            try XCTUnwrap(formatter.date(from: timestamp))
        }
        let zone = try XCTUnwrap(TimeZone(identifier: "America/Los_Angeles"))
        let start = try date("2026-03-02T07:30:00.000Z")
        let end = try date("2026-04-02T07:30:00.001Z")
        let window = Accumulator.Window(start: start, end: end)
        var rollup = try XCTUnwrap(WorkoutPeriodDailyRollup(period: window, timeZone: zone))
        rollup.accept(start: start, bpm: 100)
        rollup.accept(start: try date("2026-03-08T08:00:00.000Z"), bpm: 90)
        rollup.accept(start: try date("2026-03-08T08:00:00.000Z"), bpm: 90)
        rollup.accept(start: try date("2026-03-08T21:00:00.000Z"), bpm: 120)
        rollup.accept(start: try date("2026-04-02T07:30:00.000Z"), bpm: 140)
        rollup.accept(start: end, bpm: 200)
        let days = try XCTUnwrap(rollup.verifiedDays(expectedCount: 5))
        XCTAssertEqual(days.map(\.date), ["2026-03-01", "2026-03-08", "2026-04-02"])
        XCTAssertEqual(days[0].statistics, .init(sampleCount: 1, minimum: 100, mean: 100, maximum: 100))
        XCTAssertEqual(days[1].statistics, .init(sampleCount: 3, minimum: 90, mean: 100, maximum: 120))
        XCTAssertNil(rollup.verifiedDays(expectedCount: 6))
    }
}
