import Foundation

/// Retains producers after their bridge reply, including the gap while JS validates and
/// executes a search. Cancellation addresses the original request even after its slot ends.
final class AppleNativeToolRegistry: @unchecked Sendable {
    static let shared = AppleNativeToolRegistry()
    private let lock = NSLock()
    private var generations: [String: AppleNativeToolGeneration] = [:]

    func run(_ request: [String: Any], requestId: String,
             operation: @escaping (AppleNativeToolGeneration) async throws -> [String: Any]) async throws -> [String: Any]
    {
        try await resumePrevious(request)
        try Task.checkCancellation()
        let generation = AppleNativeToolGeneration(requestId: requestId) { [weak self] in self?.remove(requestId) }
        try register(generation)
        return try await generation.start { try await operation(generation) }
    }

    private func resumePrevious(_ request: [String: Any]) async throws {
        guard let results = request["nativeToolResults"] as? [[String: Any]], let result = results.last else { return }
        guard let id = result["toolCallId"] as? String else { throw AppleNativeToolGeneration.failure("Tool result identity was missing.") }
        guard let generation = find(id) else { throw AppleNativeToolGeneration.failure("No pending native callback matches this result.") }
        let calls = (request["nativeToolCalls"] as? [[String: Any]] ?? []).filter { $0["id"] as? String == id }
        guard calls.count == 1, results.filter({ $0["toolCallId"] as? String == id }).count == 1,
              let value = result["result"]
        else {
            generation.cancel()
            throw AppleNativeToolGeneration.failure("Tool results must match one unique assistant call.")
        }
        do { try await generation.consume(call: calls[0], result: value) }
        catch { generation.cancel(error); throw error }
    }

    func cancel(_ requestId: String) {
        lock.lock(); let generation = generations[requestId]; lock.unlock()
        generation?.cancel()
    }

    func cancelAll() {
        lock.lock(); let active = Array(generations.values); lock.unlock()
        for generation in active {
            generation.cancel()
        }
    }

    private func register(_ generation: AppleNativeToolGeneration) throws {
        lock.lock(); defer { lock.unlock() }
        guard generations[generation.requestId] == nil, generations.count < 16 else {
            throw AppleNativeToolGeneration.failure("Native generation capacity was exceeded.")
        }
        generations[generation.requestId] = generation
    }

    private func find(_ callId: String) -> AppleNativeToolGeneration? {
        lock.lock(); defer { lock.unlock() }
        return generations.values.first { $0.callId == callId }
    }

    private func remove(_ id: String) {
        lock.lock(); defer { lock.unlock() }
        generations.removeValue(forKey: id)
    }
}
