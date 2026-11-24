import Foundation

/// Pure reduction of one enumeration of exact, unique HealthKit parent sample UUIDs.
struct WorkoutPeriodQuantityAccumulator {
    struct Window: Hashable {
        let start: Date
        let end: Date

        func contains(start candidateStart: Date, end candidateEnd: Date) -> Bool {
            candidateStart >= start && candidateStart < end &&
                candidateEnd >= candidateStart && candidateEnd <= end
        }
    }

    enum RetrievalRoute: Equatable {
        case singleton
        case series
    }

    static func retrievalRoute(quantityCount: Int) -> RetrievalRoute? {
        if quantityCount == 1 {
            return .singleton
        }
        return quantityCount > 1 ? .series : nil
    }

    struct Parent {
        let quantityCount: Int
        let eligibleWindows: Set<Window>
    }

    struct Statistics: Equatable {
        let sampleCount: Int
        let minimum: Double
        let mean: Double
        let maximum: Double
    }

    enum Outcome: Equatable {
        case unavailable
        case emptyVisible
        case available(Statistics)
    }

    private let parents: [UUID: Parent]
    private var seenByParent: [UUID: Int] = [:]
    private var invalid = false
    private var admittedCount = 0
    private var sum = 0.0
    private var compensation = 0.0
    private var minimum = Double.infinity
    private var maximum = -Double.infinity

    init(parents: [UUID: Parent]) {
        self.parents = parents
    }

    mutating func accept(parentID: UUID, start: Date, end: Date, bpm: Double) {
        guard !invalid, let parent = parents[parentID],
              parent.quantityCount > 0, !parent.eligibleWindows.isEmpty,
              bpm.isFinite, bpm > 0, end >= start
        else {
            invalid = true
            return
        }
        let seen = seenByParent[parentID, default: 0]
        guard seen < parent.quantityCount else {
            invalid = true
            return
        }
        seenByParent[parentID] = seen + 1
        // A series may straddle the requested range. Expand first, then apply any
        // interval from an actual association for this parent (not all workouts).
        guard parent.eligibleWindows.contains(where: { $0.contains(start: start, end: end) }) else {
            return
        }
        guard admittedCount < Int.max else {
            invalid = true
            return
        }
        admittedCount += 1
        let adjustment = bpm - compensation
        let next = sum + adjustment
        compensation = (next - sum) - adjustment
        sum = next
        minimum = min(minimum, bpm)
        maximum = max(maximum, bpm)
    }

    func finish(completed: Bool) -> Outcome {
        guard completed, !invalid, sum.isFinite,
              parents.allSatisfy({ id, parent in
                  parent.quantityCount > 0 &&
                      seenByParent[id] == parent.quantityCount &&
                      !parent.eligibleWindows.isEmpty
              })
        else {
            return .unavailable
        }
        guard admittedCount > 0 else {
            return .emptyVisible
        }
        return .available(Statistics(sampleCount: admittedCount,
                                     minimum: minimum,
                                     mean: sum / Double(admittedCount),
                                     maximum: maximum))
    }
}

/** Local-day bins over the same accepted measurements, without a second HealthKit query. */
struct WorkoutPeriodDailyRollup {
    typealias Window = WorkoutPeriodQuantityAccumulator.Window
    typealias Statistics = WorkoutPeriodQuantityAccumulator.Statistics
    struct Day {
        let date: String
        let statistics: Statistics
    }

    private struct Bucket {
        let date: String
        let start: Date
        let end: Date
        var count = 0
        var sum = 0.0
        var compensation = 0.0
        var minimum = Double.infinity
        var maximum = -Double.infinity

        mutating func add(_ bpm: Double) {
            count += 1
            let adjustment = bpm - compensation
            let updated = sum + adjustment
            compensation = (updated - sum) - adjustment
            sum = updated
            minimum = min(minimum, bpm)
            maximum = max(maximum, bpm)
        }

        var result: Day? {
            guard count > 0, sum.isFinite else { return nil }
            return .init(date: date, statistics: .init(sampleCount: count, minimum: minimum,
                                                       mean: sum / Double(count), maximum: maximum))
        }
    }

    private var buckets: [Bucket]

    init?(period: Window, timeZone: TimeZone) {
        guard period.start < period.end else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        var cursor = calendar.startOfDay(for: period.start)
        var buckets: [Bucket] = []
        // An exact UTC month can touch 33 local dates across partial edges and a DST jump.
        while cursor < period.end {
            guard buckets.count < 33, let interval = calendar.dateInterval(of: .day, for: cursor),
                  interval.end > cursor else { return nil }
            let next = interval.end
            let parts = calendar.dateComponents([.year, .month, .day], from: cursor)
            guard let year = parts.year, (1...9999).contains(year),
                  let month = parts.month, let day = parts.day else { return nil }
            let key = String(format: "%04d-%02d-%02d", year, month, day)
            buckets.append(.init(date: key, start: max(cursor, period.start), end: min(next, period.end)))
            cursor = next
        }
        self.buckets = buckets
    }

    mutating func accept(start: Date, bpm: Double) {
        guard bpm.isFinite, bpm > 0,
              let index = buckets.firstIndex(where: { start >= $0.start && start < $0.end })
        else { return }
        buckets[index].add(bpm)
    }

    func verifiedDays(expectedCount: Int) -> [Day]? {
        let days = buckets.compactMap(\.result)
        guard expectedCount > 0,
              days.reduce(0, { $0 + $1.statistics.sampleCount }) == expectedCount
        else { return nil }
        return days
    }
}
