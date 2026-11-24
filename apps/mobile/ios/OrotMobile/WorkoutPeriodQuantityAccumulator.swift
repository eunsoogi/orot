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
        if quantityCount == 1 { return .singleton }
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
