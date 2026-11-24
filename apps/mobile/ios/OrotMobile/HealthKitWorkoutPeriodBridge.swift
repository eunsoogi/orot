import Foundation
import HealthKit
import React

extension HealthKitModule {
    @objc(queryWorkoutPeriodHeartRate:resolver:rejecter:)
    public func queryWorkoutPeriodHeartRate(_ request: NSDictionary,
                                           resolver resolve: @escaping RCTPromiseResolveBlock,
                                           rejecter _: @escaping RCTPromiseRejectBlock)
    {
        #if DEBUG && targetEnvironment(simulator)
            if hasSyntheticFixture {
                resolve(["status": "unavailable"])
                return
            }
        #endif
        guard let call = WorkoutPeriodReadCall(request, resolve: resolve) else {
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
    public func cancelWorkoutPeriodHeartRate(_ callID: String) {
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
    let workouts: [WorkoutPeriodHealthKitProducer.OwnedWorkout]
    let resolve: RCTPromiseResolveBlock

    init?(_ raw: NSDictionary, resolve: @escaping RCTPromiseResolveBlock) {
        guard raw.count == 4, let id = raw["callId"] as? String,
              id.count <= 64, id.hasPrefix("workout-period-"),
              let from = raw["fromInclusive"] as? String, let to = raw["toExclusive"] as? String,
              let input = raw["workouts"] as? [[String: String]], input.count <= 512
        else { return nil }
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let start = iso.date(from: from), let end = iso.date(from: to), start < end else { return nil }
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
        self.period = .init(start: start, end: end)
        self.workouts = workouts
        self.resolve = resolve
    }
}

@MainActor
private enum WorkoutPeriodBridgeOperations {
    private struct Active {
        let call: WorkoutPeriodReadCall
        let work: Task<Void, Never>
        let expiry: Task<Void, Never>
    }

    private static var active: [String: Active] = [:]

    static func start(_ call: WorkoutPeriodReadCall, store: HKHealthStore) {
        guard active[call.id] == nil, active.count < 2 else {
            call.resolve(["status": "unavailable"])
            return
        }
        let work = Task {
            let outcome = await WorkoutPeriodHealthKitProducer.capture(
                store: store, period: call.period, completeCohort: call.workouts,
                isCurrent: { active[call.id]?.call === call },
            )
            guard active[call.id]?.call === call else { return }
            active.removeValue(forKey: call.id)?.expiry.cancel()
            switch outcome {
            case .unavailable: call.resolve(["status": "unavailable"])
            case .emptyVisible: call.resolve(["status": "emptyVisible"])
            case let .available(witness):
                call.resolve([
                    "status": "available", "fromInclusive": call.from, "toExclusive": call.to,
                    "sampleCount": witness.stats.sampleCount, "minimum": witness.stats.minimum,
                    "mean": witness.stats.mean, "maximum": witness.stats.maximum,
                    "firstSampleAtMs": witness.firstSampleAtMs, "lastSampleAtMs": witness.lastSampleAtMs,
                    "membershipRevision": witness.membershipRevision,
                ])
            }
        }
        let expiry = Task {
            do { try await Task.sleep(for: .seconds(15)) } catch { return }
            if active[call.id]?.call === call { cancel(call.id) }
        }
        active[call.id] = Active(call: call, work: work, expiry: expiry)
    }

    static func cancel(_ id: String) {
        guard let retired = active.removeValue(forKey: id) else { return }
        retired.expiry.cancel()
        retired.work.cancel()
        retired.call.resolve(["status": "unavailable"])
    }
}
