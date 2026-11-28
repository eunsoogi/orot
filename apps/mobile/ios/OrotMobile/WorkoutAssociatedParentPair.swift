import CryptoKit
import Foundation

/// Concurrent only within one positively owned pair; the caller processes replies
/// in input order, then decides whether to admit another pair.
@MainActor
enum WorkoutAssociatedParentPair {
    enum Stopped: Error { case retired }

    static func forEach<Input, Scope: Sendable, Output: Sendable>(
        _ inputs: [Input],
        active: @escaping @MainActor () -> Bool,
        prepare: @MainActor (Input) throws -> Scope,
        read: @escaping @MainActor (Scope) async throws -> Output,
        consume: @MainActor (Scope, Output) throws -> Void,
    ) async throws {
        for start in stride(from: 0, to: inputs.count, by: 2) {
            guard !Task.isCancelled, active() else { throw Stopped.retired }
            let scopes = try inputs[start ..< min(start + 2, inputs.count)].map(prepare)
            let outputs = try await readPair(scopes, active: active, operation: read)
            for (scope, output) in zip(scopes, outputs) {
                guard !Task.isCancelled, active() else { throw Stopped.retired }
                try consume(scope, output)
            }
        }
    }

    private static func readPair<Input: Sendable, Output: Sendable>(
        _ inputs: [Input],
        active: @escaping @MainActor () -> Bool,
        operation: @escaping @MainActor (Input) async throws -> Output,
    ) async throws -> [Output] {
        guard (1 ... 2).contains(inputs.count) else { throw Stopped.retired }
        @MainActor @Sendable func checkedRead(_ input: Input) async throws -> Output {
            guard !Task.isCancelled, active() else { throw Stopped.retired }
            let result = try await operation(input)
            guard !Task.isCancelled, active() else { throw Stopped.retired }
            return result
        }
        if inputs.count == 1 {
            return try await [checkedRead(inputs[0])]
        }

        // Consume errors in finish order so a fast failure cancels a held sibling.
        return try await withThrowingTaskGroup(of: (Int, Output).self) { group in
            group.addTask { try await (0, checkedRead(inputs[0])) }
            group.addTask { try await (1, checkedRead(inputs[1])) }
            var results: [Int: Output] = [:]
            for try await (index, output) in group {
                results[index] = output
            }
            guard active(), let first = results[0], let second = results[1]
            else { throw Stopped.retired }
            return [first, second]
        }
    }
}

#if os(iOS)
    import HealthKit

    extension WorkoutAssociatedParentPair {
        @available(iOS 15.4, *)
        static func healthKitParents(
            of workout: HKWorkout, start: Date, end: Date, type: HKQuantityType,
            limit: Int, store: HKHealthStore,
        ) async throws -> [HKQuantitySample] {
            // Period overlap narrows an already-associated parent only.
            let predicate = NSCompoundPredicate(andPredicateWithSubpredicates: [
                HKQuery.predicateForObjects(from: workout),
                HKQuery.predicateForSamples(withStart: start, end: end, options: []),
            ])
            return try await HKSampleQueryDescriptor(
                predicates: [.quantitySample(type: type, predicate: predicate)],
                sortDescriptors: [], limit: limit,
            ).result(for: store)
        }
    }
#endif

/// Stable witness encoding shared by the parent traversal and final aggregate.
enum WorkoutPeriodMembershipDigest {
    nonisolated static func stableFields(_ fields: [String]) -> String {
        fields.map { "\($0.utf8.count):\($0)" }.joined()
    }

    /// Stable, length-prefixed membership witness; its encoding must not change.
    nonisolated static func digest(_ fields: [String]) -> String {
        let hash = SHA256.hash(data: Data(stableFields(fields).utf8))
        // Workouts can have thousands of associated parents. Encode the same
        // lowercase hex without creating one Foundation formatting call per digest byte.
        let digits = Array("0123456789abcdef".utf8)
        var output: [UInt8] = []
        output.reserveCapacity(SHA256.Digest.byteCount * 2)
        for byte in hash {
            output.append(digits[Int(byte >> 4)])
            output.append(digits[Int(byte & 0x0f)])
        }
        return String(decoding: output, as: UTF8.self)
    }
}
