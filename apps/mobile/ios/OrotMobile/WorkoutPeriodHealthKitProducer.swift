import CryptoKit
import Foundation
import HealthKit
import UIKit

/// Private local producer; not the React bridge. The caller must first obtain a complete,
/// stable imported cohort from protected storage. It must re-check that scope before use.
@MainActor
enum WorkoutPeriodHealthKitProducer {
    typealias Accumulator = WorkoutPeriodQuantityAccumulator

    struct OwnedWorkout {
        let id: UUID
        let start: Date
        let end: Date
        let sourceBundle: String
    }

    struct Witness {
        let stats: Accumulator.Statistics
        let firstSampleAtMs: Int64
        let lastSampleAtMs: Int64
        let membershipRevision: String
        let days: [WorkoutPeriodDailyRollup.Day]?
    }

    enum Outcome {
        case unavailable
        case emptyVisible
        case available(Witness)
    }

    private static let maxWorkouts = 512
    private static let maxParents = 8192
    private static let maxQuantities = 200_000
    private static let maxMemberships = 32768

    @available(iOS 15.4, *)
    static func capture(
        store: HKHealthStore,
        period: Accumulator.Window,
        completeCohort: [OwnedWorkout],
        timeZone: TimeZone? = nil,
        requireVisiblePeriodMatch: Bool = false,
        isCurrent: @MainActor () -> Bool,
    ) async -> Outcome {
        let started = DispatchTime.now()
        let deadline = started + .seconds(15)
        func active() -> Bool {
            DispatchTime.now() < deadline && !Task.isCancelled && isCurrent() && UIApplication.shared.isProtectedDataAvailable &&
                UIApplication.shared.applicationState != .background
        }
        guard UIApplication.shared.applicationState == .active, active(), HKHealthStore.isHealthDataAvailable(),
              period.start < period.end, completeCohort.count <= maxWorkouts,
              Set(completeCohort.map(\.id)).count == completeCohort.count
        else {
            WorkoutPeriodDiagnostics.report(.nativeGateRejected, since: started)
            return .unavailable
        }
        if completeCohort.isEmpty && !requireVisiblePeriodMatch {
            return .emptyVisible
        }
        do {
            let heartRate = HKQuantityType(.heartRate)
            let allIDs = Set(completeCohort.map(\.id))
            let predicate = requireVisiblePeriodMatch
                ? HKQuery.predicateForSamples(withStart: period.start, end: period.end, options: [])
                : HKQuery.predicateForObjects(with: allIDs)
            let rows = try await HKSampleQueryDescriptor(
                predicates: [.workout(predicate)], sortDescriptors: [], limit: maxWorkouts + 1,
            ).result(for: store)
            WorkoutPeriodDiagnostics.report(.workoutObjectsRead, since: started)
            guard active(), rows.count <= maxWorkouts else { return .unavailable }
            let workouts = requireVisiblePeriodMatch
                ? rows.filter { period.overlaps(start: $0.startDate, end: $0.endDate) } : rows
            guard Accumulator.exactCohort(imported: allIDs, observed: workouts.map(\.uuid))
            else { return .unavailable }
            if workouts.isEmpty {
                return .emptyVisible
            }
            let byID = Dictionary(uniqueKeysWithValues: workouts.map { ($0.uuid, $0) })
            var parentCounts: [UUID: Int] = [:]
            var parentWindows: [UUID: Set<Accumulator.Window>] = [:]
            var parentSource: [UUID: String] = [:]
            var singletons: [UUID: HKQuantitySample] = [:]
            var digestParts: [String] = []
            var memberships = 0
            for imported in completeCohort {
                guard active(), let workout = byID[imported.id],
                      sameSavedInstant(workout.startDate, imported.start),
                      sameSavedInstant(workout.endDate, imported.end),
                      workout.sourceRevision.source.bundleIdentifier == imported.sourceBundle
                else { return .unavailable }
                let start = max(period.start, workout.startDate)
                let end = min(period.end, workout.endDate)
                guard start < end else { return .unavailable }
                let clipped = Accumulator.Window(start: start, end: end)
                digestParts.append(digest([workout.uuid.uuidString, imported.sourceBundle,
                                           dateKey(workout.startDate), dateKey(workout.endDate)]))
                // Overlap narrows an already-associated parent only; it never establishes membership.
                let scope = NSCompoundPredicate(andPredicateWithSubpredicates: [
                    HKQuery.predicateForObjects(from: workout),
                    HKQuery.predicateForSamples(withStart: start, end: end, options: []),
                ])
                let parents = try await HKSampleQueryDescriptor(
                    predicates: [.quantitySample(type: heartRate, predicate: scope)],
                    sortDescriptors: [], limit: maxParents + 1,
                ).result(for: store)
                guard active(), parents.count <= maxParents,
                      parents.count <= maxMemberships - memberships
                else { return .unavailable }
                memberships += parents.count
                for sample in parents {
                    let identity = sourceDigest(sample)
                    guard let route = Accumulator.retrievalRoute(quantityCount: sample.count),
                          parentCounts[sample.uuid].map({ $0 == sample.count }) ?? true,
                          parentSource[sample.uuid].map({ $0 == identity }) ?? true
                    else { return .unavailable }
                    if route == .singleton {
                        singletons[sample.uuid] = sample
                    }
                    parentCounts[sample.uuid] = sample.count
                    parentSource[sample.uuid] = identity
                    parentWindows[sample.uuid, default: []].insert(clipped)
                    digestParts.append(digest([workout.uuid.uuidString, sample.uuid.uuidString, identity,
                                               dateKey(clipped.start), dateKey(clipped.end), String(sample.count)]))
                }
                guard parentCounts.count <= maxParents else { return .unavailable }
            }
            WorkoutPeriodDiagnostics.report(.associatedParentsRead, since: started)
            guard active() else { return .unavailable }
            guard !parentCounts.isEmpty else { return .emptyVisible }
            var expected = 0
            for count in parentCounts.values {
                guard count <= maxQuantities - expected else { return .unavailable }
                expected += count
            }
            var accumulator = Accumulator(parents: parentCounts.mapValuesWithKeys { key, count in
                .init(quantityCount: count, eligibleWindows: parentWindows[key] ?? [])
            })
            let unit = HKUnit.count().unitDivided(by: .minute())
            var first: Date?
            var last: Date?
            var seen = 0
            var verifiedSources = Set<UUID>()
            var dayRollup = timeZone.flatMap { WorkoutPeriodDailyRollup(period: period, timeZone: $0) }
            func accept(_ parent: HKQuantitySample, start: Date, end: Date, bpm: Double, route: Accumulator.RetrievalRoute) -> Bool {
                guard active(), seen < expected, parent.quantityType == heartRate,
                      Accumulator.retrievalRoute(quantityCount: parent.count) == route,
                      let windows = parentWindows[parent.uuid], parentCountMatches(parent, parentCounts),
                      let source = parentSource[parent.uuid]
                else { return false }
                if verifiedSources.insert(parent.uuid).inserted, source != sourceDigest(parent) {
                    return false
                }
                seen += 1
                accumulator.accept(parentID: parent.uuid, start: start, end: end, bpm: bpm)
                if windows.contains(where: { $0.contains(start: start, end: end) }) {
                    dayRollup?.accept(start: start, bpm: bpm)
                    first = first.map { min($0, start) } ?? start
                    last = last.map { max($0, start) } ?? start
                    // Keep multiplicity, including multiple identical values from one series.
                    digestParts.append(stableFields([parent.uuid.uuidString, source,
                                                     dateKey(start), dateKey(end), String(bpm.bitPattern)]))
                }
                return true
            }
            // Apple's first-party workout path reads count-one samples directly; only
            // condensed series are expanded. Both routes feed the same membership fence.
            for singleton in singletons.values {
                guard accept(singleton, start: singleton.startDate, end: singleton.endDate,
                             bpm: singleton.quantity.doubleValue(for: unit), route: .singleton)
                else { return .unavailable }
            }
            let seriesIDs = Set(parentCounts.keys).subtracting(singletons.keys)
            if !seriesIDs.isEmpty {
                let query = HKQuantitySeriesSampleQueryDescriptor(
                    predicate: .quantitySample(type: heartRate, predicate: HKQuery.predicateForObjects(with: seriesIDs)),
                    options: .includeSample,
                )
                for try await entry in query.results(for: store) {
                    guard let parent = entry.sample,
                          accept(parent, start: entry.dateInterval.start, end: entry.dateInterval.end,
                                 bpm: entry.quantity.doubleValue(for: unit), route: .series)
                    else { return .unavailable }
                }
            }
            WorkoutPeriodDiagnostics.report(.quantitiesRead, since: started)
            guard active(), seen == expected else { return .unavailable }
            switch accumulator.finish(completed: true) {
            case .emptyVisible: return .emptyVisible
            case .unavailable: return .unavailable
            case let .available(stats):
                guard let first, let last else { return .unavailable }
                digestParts.append(digest([dateKey(period.start), dateKey(period.end)]))
                let material = digestParts
                let revision = await Task.detached(priority: .utility) { digest(material.sorted()) }.value
                guard active() else { return .unavailable }
                return .available(Witness(
                    stats: stats, firstSampleAtMs: Int64(first.timeIntervalSince1970 * 1000),
                    lastSampleAtMs: Int64(last.timeIntervalSince1970 * 1000),
                    membershipRevision: "v1:" + revision,
                    days: dayRollup?.verifiedDays(expectedCount: stats.sampleCount),
                ))
            }
        } catch {
            return .unavailable
        }
    }

    private static func parentCountMatches(_ sample: HKQuantitySample, _ counts: [UUID: Int]) -> Bool {
        counts[sample.uuid] == sample.count
    }

    private static func dateKey(_ date: Date) -> String {
        String(date.timeIntervalSince1970.bitPattern)
    }

    private static func sameSavedInstant(_ native: Date, _ saved: Date) -> Bool {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: native) == formatter.string(from: saved)
    }

    private static func sourceDigest(_ sample: HKQuantitySample) -> String {
        let revision = sample.sourceRevision
        return digest([revision.source.bundleIdentifier, revision.version ?? "",
                       revision.productType ?? "", sample.device?.localIdentifier ?? ""])
    }

    private nonisolated static func stableFields(_ fields: [String]) -> String {
        fields.map { "\($0.utf8.count):\($0)" }.joined()
    }

    private nonisolated static func digest(_ fields: [String]) -> String {
        SHA256.hash(data: Data(stableFields(fields).utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

private extension Dictionary {
    func mapValuesWithKeys<T>(_ transform: (Key, Value) -> T) -> [Key: T] {
        [Key: T](uniqueKeysWithValues: map { ($0.key, transform($0.key, $0.value)) })
    }
}
