#if OROT_TESTS
    import Foundation
    import React

    /// App-hosted XCTest calls real Hermes/domain/native operations without navigating a probe UI.
    /// This broker is absent from ordinary app builds; only synthetic test commands are accepted by JS.
    final class TestOperationBroker: @unchecked Sendable {
        static let shared = TestOperationBroker()
        enum Failure: Error {
            case timedOut(String)
            case javascript(String)
        }

        private let lock = NSLock()
        private var queued: [[String: Any]] = []
        private var waiting: RCTPromiseResolveBlock?
        private var pending: [String: CheckedContinuation<[String: Any], Error>] = [:]
        private var cancelled: Set<String> = []

        func request(_ operation: String, parameters: [String: Any] = [:], timeout: TimeInterval = 60) async throws -> [String: Any] {
            let identifier = UUID().uuidString
            return try await withTaskCancellationHandler {
                try await withCheckedThrowingContinuation { continuation in
                    enqueue(identifier, operation: operation, parameters: parameters, continuation: continuation)
                    DispatchQueue.global().asyncAfter(deadline: .now() + timeout) {
                        self.finish(identifier, result: .failure(Failure.timedOut(operation)))
                    }
                }
            } onCancel: {
                self.cancel(identifier)
            }
        }

        private func enqueue(
            _ identifier: String,
            operation: String,
            parameters: [String: Any],
            continuation: CheckedContinuation<[String: Any], Error>,
        ) {
            lock.lock()
            if cancelled.remove(identifier) != nil {
                lock.unlock()
                continuation.resume(throwing: CancellationError())
                return
            }
            pending[identifier] = continuation
            let command: [String: Any] = ["id": identifier, "operation": operation, "parameters": parameters]
            let resolve = waiting
            waiting = nil
            if resolve == nil {
                queued.append(command)
            }
            lock.unlock()
            resolve?(command)
        }

        func next(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
            lock.lock()
            if waiting != nil {
                lock.unlock()
                reject("TEST_CONCURRENT_POLL", "Only one native test command consumer is allowed.", nil)
                return
            }
            let command = queued.isEmpty ? nil : queued.removeFirst()
            if command == nil {
                waiting = resolve
            }
            lock.unlock()
            if let command {
                resolve(command)
            }
        }

        func finish(_ identifier: String, result: Result<[String: Any], Error>) {
            lock.lock()
            let continuation = pending.removeValue(forKey: identifier)
            queued.removeAll { $0["id"] as? String == identifier }
            lock.unlock()
            // A late JS completion cannot revive a cancelled or timed-out test operation.
            continuation?.resume(with: result)
        }

        private func cancel(_ identifier: String) {
            lock.lock()
            let continuation = pending.removeValue(forKey: identifier)
            queued.removeAll { $0["id"] as? String == identifier }
            if continuation == nil {
                cancelled.insert(identifier)
            }
            lock.unlock()
            continuation?.resume(throwing: CancellationError())
        }
    }
#endif
