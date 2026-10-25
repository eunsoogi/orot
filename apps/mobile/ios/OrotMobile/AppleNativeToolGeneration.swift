import Foundation

/// One SDK generation owns one accepted Tool callback; additional proposals are declined.
/// Bridge replies and SDK termination are separate: publishing the accepted call must
/// not release its suspended native producer.
final class AppleNativeToolGeneration: @unchecked Sendable {
    enum FailureCategory: String {
        case requiredToolMissing = "required_tool_missing"
        case callbackConflict = "callback_conflict"
        case toolArguments = "tool_arguments"
        case bridgeState = "bridge_state"
    }

    enum Phase { case generating, waiting, draining, terminated }
    typealias Response = [String: Any]
    typealias WatchdogScheduler = (DispatchWorkItem, TimeInterval) -> Void
    private let lock = NSLock()
    private var phase = Phase.generating
    private var reply: CheckedContinuation<Response, Error>?
    private var toolResult: CheckedContinuation<String, Error>?
    private var drained: CheckedContinuation<Void, Error>?
    private var producer: Task<Void, Never>?
    private var watchdog: DispatchWorkItem?
    private var call: Response?
    private var terminalError: Error?
    private let timeoutSeconds: TimeInterval?
    // Keeps production scheduling on Dispatch while letting lifecycle tests advance deadlines virtually.
    private let watchdogScheduler: WatchdogScheduler
    let requestId: String
    // This is application correlation identity, never an SDK-generated transcript ID.
    let callId: String
    let onTermination: () -> Void

    /// Interactive work ends through caller cancellation; finite watchdogs are explicit opt-ins.
    /// The scheduler seam lets tests exercise deadline behavior without a wall-clock wait.
    init(requestId: String, timeoutSeconds: TimeInterval? = nil,
         watchdogScheduler: @escaping WatchdogScheduler = { item, interval in
             DispatchQueue.global().asyncAfter(deadline: .now() + interval, execute: item)
         },
         onTermination: @escaping () -> Void)
    {
        self.requestId = requestId
        self.timeoutSeconds = timeoutSeconds
        self.watchdogScheduler = watchdogScheduler
        callId = requestId + "-bridge-tool-" + UUID().uuidString
        self.onTermination = onTermination
    }

    func start(_ operation: @escaping () async throws -> Response) async throws -> Response {
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                lock.lock()
                guard phase == .generating, producer == nil else {
                    lock.unlock(); continuation.resume(throwing: failure("Native generation already ended.")); return
                }
                reply = continuation
                let timeout = timeoutSeconds.map { _ in
                    DispatchWorkItem { [weak self] in
                        self?.cancel(Self.failure("Native tool generation exceeded its deadline."))
                    }
                }
                watchdog = timeout
                producer = Task {
                    do { try await self.finish(.success(operation())) }
                    catch { self.finish(.failure(error)) }
                }
                lock.unlock()
                if let timeout, let timeoutSeconds {
                    watchdogScheduler(timeout, timeoutSeconds)
                }
            }
        } onCancel: { self.cancel(CancellationError()) }
    }

    func invoke(name: String, arguments: [String: Any]) async throws -> String {
        try await withCheckedThrowingContinuation { continuation in
            lock.lock()
            if phase == .waiting || phase == .draining {
                lock.unlock()
                // The SDK may propose parallel calls despite the one-at-a-time instruction.
                // Decline extras explicitly without executing them or cancelling the accepted
                // callback. Its result must still drain before the next common-runtime request.
                if ProcessInfo.processInfo.arguments.contains("-OROT_PROVIDER_DIAGNOSTICS") {
                    NSLog("OROT_PROVIDER_DIAGNOSTIC provider=apple category=extra_callback_rejected")
                }
                continuation.resume(returning: #"{"status":"not_executed","reason":"Only one tool call is executed per generation. Request remaining searches in a fresh request."}"#)
                return
            }
            guard phase == .generating, let currentReply = reply else {
                lock.unlock()
                let error = Self.failure("Only one tool callback is permitted in a native generation.", category: .callbackConflict)
                continuation.resume(throwing: error)
                cancel(error)
                return
            }
            let value: Response = ["id": callId, "name": name, "arguments": arguments]
            call = value
            phase = .waiting
            toolResult = continuation
            reply = nil
            lock.unlock()
            currentReply.resume(returning: ["text": "", "toolCalls": [value], "finishReason": "tool_calls"])
        }
    }

    /// Transition before resuming Tool.call so an SDK follow-up callback cannot escape
    /// into another JS search while the obsolete response is being discarded.
    func consume(call expected: Response, result: Any) async throws {
        let data = try JSONSerialization.data(withJSONObject: result, options: [.fragmentsAllowed, .sortedKeys])
        guard let text = String(data: data, encoding: .utf8) else { throw Self.failure("Invalid tool result encoding.") }
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                lock.lock()
                guard phase == .waiting, let call, NSDictionary(dictionary: call).isEqual(to: expected),
                      let callback = toolResult
                else {
                    let error = terminalError ?? Self.failure("Tool result did not match its pending native callback.")
                    lock.unlock(); continuation.resume(throwing: error); return
                }
                phase = .draining
                drained = continuation
                toolResult = nil
                lock.unlock()
                callback.resume(returning: text)
            }
        } onCancel: { self.cancel(CancellationError()) }
    }

    func permitsSnapshot() -> Bool {
        lock.lock(); defer { lock.unlock() }
        return phase == .generating
    }

    func hasInvokedTool() -> Bool {
        lock.lock(); defer { lock.unlock() }
        return call != nil
    }

    func cancel(_ error: Error = CancellationError()) {
        finish(.failure(error), cancelProducer: true)
    }

    private func finish(_ result: Result<Response, Error>, cancelProducer: Bool = false) {
        lock.lock()
        guard phase != .terminated else { lock.unlock(); return }
        let previous = phase
        phase = .terminated
        if case let .failure(error) = result {
            terminalError = error
        }
        let pendingReply = reply
        let pendingTool = toolResult
        let pendingDrain = drained
        let task = producer
        reply = nil; toolResult = nil; drained = nil; producer = nil; call = nil
        watchdog?.cancel(); watchdog = nil
        lock.unlock()
        if case .failure = result {
            AppleNativeToolTrace.record(cancelProducer ? "generation_cancelled" : "sdk_generation_failed", generation: self)
        }
        if cancelProducer {
            task?.cancel()
        }
        pendingReply?.resume(with: result)
        pendingTool?.resume(throwing: terminalError ?? Self.failure("SDK ended before receiving its tool result."))
        if previous == .draining {
            pendingDrain?.resume(with: result.map { _ in () })
        }
        onTermination()
    }

    private func failure(_ message: String) -> NSError {
        Self.failure(message)
    }

    static func failure(_ message: String, category: FailureCategory = .bridgeState) -> NSError {
        NSError(domain: "AppleFoundationModels", code: 1,
                userInfo: [NSLocalizedDescriptionKey: message, "code": "GENERATION_FAILED", "diagnosticCategory": category.rawValue])
    }
}
