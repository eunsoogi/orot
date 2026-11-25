import Foundation
import HealthKit
import React

public extension HealthKitModule {
    @objc(queryWorkoutPeriodHeartRate:resolver:rejecter:)
    func queryWorkoutPeriodHeartRate(
        _ request: NSDictionary,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter _: @escaping RCTPromiseRejectBlock,
    ) {
        WorkoutPeriodDiagnostics.report(.bridgeReceived)
        #if DEBUG && targetEnvironment(simulator)
            if hasSyntheticFixture {
                resolve(["status": "unavailable"])
                return
            }
        #endif
        guard let call = WorkoutPeriodReadCall(request, resolve: resolve) else {
            WorkoutPeriodDiagnostics.report(.requestRejected)
            resolve(["status": "unavailable"])
            return
        }
        let healthStore = store
        // RN calls arrive on its serial method queue; main dispatch preserves query/cancel order.
        DispatchQueue.main.async {
            WorkoutPeriodBridgeOperations.start(call, store: healthStore)
        }
    }

    @objc(cancelWorkoutPeriodHeartRate:)
    func cancelWorkoutPeriodHeartRate(_ callID: String) {
        DispatchQueue.main.async {
            WorkoutPeriodBridgeOperations.cancel(callID)
        }
    }
}

/// Only the fixed app-owned cohort is decoded; no native IDs are present in replies.
private final class WorkoutPeriodReadCall: @unchecked Sendable {
    let id: String
    let from: String
    let to: String
    let period: WorkoutPeriodQuantityAccumulator.Window
    let requestedTimeZone: String?
    let timeZone: TimeZone?
    let workouts: [WorkoutPeriodHealthKitProducer.OwnedWorkout]
    let requireVisiblePeriodMatch: Bool
    let resolve: RCTPromiseResolveBlock

    init?(_ raw: NSDictionary, resolve: @escaping RCTPromiseResolveBlock) {
        guard raw.count == 4 || raw.count == 5, let id = raw["callId"] as? String,
              id.count <= 64, id.hasPrefix("workout-period-"),
              let from = raw["fromInclusive"] as? String, let to = raw["toExclusive"] as? String,
              let input = raw["workouts"] as? [[String: String]], input.count <= 512
        else { return nil }
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let start = iso.date(from: from), let end = iso.date(from: to), start < end else { return nil }
        let strict = raw["workoutCohortPolicy"] as? String == "exact-visible-native-cohort"
        guard !strict || (raw.count == 5 && end.timeIntervalSince(start) <= 31 * 86400) else { return nil }
        let requestedTimeZone: String?
        if raw.count == 5, !strict {
            guard let chart = raw["recordsMonthChart"] as? [String: String], chart.count == 1,
                  let identifier = chart["timeZone"], identifier.count <= 64,
                  identifier.range(of: "^[A-Za-z0-9_+/-]+$", options: .regularExpression) != nil,
                  Self.isRecordsMonth(from: start, throughExclusive: end)
            else { return nil }
            requestedTimeZone = identifier
        } else {
            requestedTimeZone = nil
        }
        let timeZone = requestedTimeZone.flatMap(TimeZone.init(identifier:))
        var workouts: [WorkoutPeriodHealthKitProducer.OwnedWorkout] = []
        for row in input {
            guard row.count == 4, let rawID = row["id"], let workoutID = UUID(uuidString: rawID),
                  let rawStart = row["start"], let rawEnd = row["end"],
                  let workoutStart = iso.date(from: rawStart), let workoutEnd = iso.date(from: rawEnd),
                  workoutStart < end, start < workoutEnd, workoutStart < workoutEnd,
                  let source = row["sourceBundle"], !source.isEmpty, source.count <= 256
            else { return nil }
            workouts.append(.init(id: workoutID, start: workoutStart, end: workoutEnd, sourceBundle: source))
        }
        self.id = id
        self.from = from
        self.to = to
        self.requestedTimeZone = requestedTimeZone
        self.timeZone = timeZone
        period = .init(start: start, end: end)
        self.workouts = workouts
        requireVisiblePeriodMatch = strict
        self.resolve = resolve
    }

    /// Match Records' existing rolling UTC Gregorian month, with no caller-selected wide windows.
    private static func isRecordsMonth(from start: Date, throughExclusive end: Date) -> Bool {
        let inclusiveEnd = end.addingTimeInterval(-0.001)
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        guard end.timeIntervalSince(start) <= 31 * 86400 + 0.002,
              let expectedStart = calendar.date(byAdding: .month, value: -1, to: inclusiveEnd)
        else { return false }
        return abs(expectedStart.timeIntervalSince(start)) < 0.0001
    }
}

@MainActor
private enum WorkoutPeriodBridgeOperations {
    private struct Active {
        let call: WorkoutPeriodReadCall
        let work: Task<Void, Never>
        let expiry: Task<Void, Never>
        let started: DispatchTime
    }

    private static var active: [String: Active] = [:]

    static func start(_ call: WorkoutPeriodReadCall, store: HKHealthStore) {
        guard #available(iOS 15.4, *), active[call.id] == nil, active.count < 2 else {
            WorkoutPeriodDiagnostics.report(.bridgeBusy)
            call.resolve(["status": "unavailable"])
            return
        }
        let started = DispatchTime.now()
        WorkoutPeriodDiagnostics.report(.started)
        let work = Task {
            let outcome = await WorkoutPeriodHealthKitProducer.capture(
                store: store, period: call.period, completeCohort: call.workouts,
                timeZone: call.timeZone, requireVisiblePeriodMatch: call.requireVisiblePeriodMatch,
                isCurrent: { active[call.id]?.call === call },
            )
            guard active[call.id]?.call === call else { return }
            active.removeValue(forKey: call.id)?.expiry.cancel()
            switch outcome {
            case .unavailable:
                WorkoutPeriodDiagnostics.report(.unavailable, since: started)
                call.resolve(["status": "unavailable"])
            case .emptyVisible:
                WorkoutPeriodDiagnostics.report(.empty, since: started)
                call.resolve(["status": "emptyVisible"])
            case let .available(witness):
                WorkoutPeriodDiagnostics.report(.available, since: started)
                var result: [String: Any] = [
                    "status": "available", "fromInclusive": call.from, "toExclusive": call.to,
                    "sampleCount": witness.stats.sampleCount, "minimum": witness.stats.minimum,
                    "mean": witness.stats.mean, "maximum": witness.stats.maximum,
                    "firstSampleAtMs": witness.firstSampleAtMs, "lastSampleAtMs": witness.lastSampleAtMs,
                    "membershipRevision": witness.membershipRevision,
                ]
                if call.requireVisiblePeriodMatch {
                    result["workoutCohortPolicy"] = "exact-visible-native-cohort"
                }
                if let timeZone = call.requestedTimeZone, let days = witness.days {
                    result["timeZone"] = timeZone
                    result["days"] = days.map { day in
                        [
                            "date": day.date, "sampleCount": day.statistics.sampleCount,
                            "minimum": day.statistics.minimum, "mean": day.statistics.mean,
                            "maximum": day.statistics.maximum,
                        ] as [String: Any]
                    }
                }
                call.resolve(result)
            }
        }
        let expiry = Task {
            do { try await Task.sleep(nanoseconds: 15_000_000_000) } catch { return }
            if active[call.id]?.call === call {
                cancel(call.id, reason: .timeout)
            }
        }
        active[call.id] = Active(call: call, work: work, expiry: expiry, started: started)
    }

    static func cancel(_ id: String, reason: WorkoutPeriodDiagnostics.Mark = .cancelled) {
        guard let retired = active.removeValue(forKey: id) else { return }
        WorkoutPeriodDiagnostics.report(reason, since: retired.started)
        retired.expiry.cancel()
        retired.work.cancel()
        retired.call.resolve(["status": "unavailable"])
    }
}

/// The opt-in trace accepts only fixed code-owned marks and a monotonic duration.
enum WorkoutPeriodDiagnostics {
    typealias Mark = ProcessDiagnosticWitness.WorkoutNative

    private static let enabled = ProcessInfo.processInfo.arguments.contains("-OROT_PROVIDER_DIAGNOSTICS")

    static func report(_ mark: Mark, since start: DispatchTime? = nil) {
        guard let witness = ProcessDiagnosticWitness.current else { return }
        witness.recordWorkout(mark)
        let elapsed = start.map { (DispatchTime.now().uptimeNanoseconds - $0.uptimeNanoseconds) / 1_000_000 } ?? 0
        NSLog("OROT_PROVIDER_DIAGNOSTIC layer=app feature=workout_period stage=%@ elapsed_ms=%ld",
              mark.rawValue, Int(min(elapsed, 300_000)))
    }

    /// Route and stage are fixed separately, never arbitrary Console strings.
    static func handleJS(_ feature: String, stage: String, outcome: String) -> Bool {
        guard feature == "workout_period" else { return false }
        let parts = stage.split(separator: "_", omittingEmptySubsequences: false)
        guard enabled, parts.count == 2,
              ["records", "overview", "shared"].contains(String(parts[0])),
              ["route", "protection", "database", "epoch", "cohort", "reproof", "bridge"].contains(String(parts[1])),
              ["started", "completed", "failed", "cancelled", "skipped", "missing", "empty"].contains(outcome)
        else { return true }
        NSLog("OROT_PROVIDER_DIAGNOSTIC layer=js feature=workout_period stage=%@ outcome=%@", stage, outcome)
        return true
    }
}
