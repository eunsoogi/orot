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
}
