#if OROT_TESTS && targetEnvironment(simulator)
    import Foundation
    import React

    /// A finite queue of raw model outputs. Unexpected calls fail; no application result or assertion is fabricated here.
    final class AppleFoundationModelsMock {
        static let shared = AppleFoundationModelsMock()
        private let lock = NSLock()
        private var status = "unsupportedDevice"
        private var replies: [[String: Any]] = []
        private var requests: [[String: Any]] = []

        func configure(_ value: [String: Any]) {
            lock.lock(); defer { lock.unlock() }
            status = value["status"] as? String ?? "unsupportedDevice"
            replies = []
            requests = []
        }

        func enqueue(_ value: [String: Any]) {
            lock.lock(); defer { lock.unlock() }
            replies.append(value)
        }

        func availability() -> [String: Any] {
            lock.lock(); defer { lock.unlock() }
            return ["status": status]
        }

        func observation() -> [String: Any] {
            lock.lock(); defer { lock.unlock() }
            return ["modelExecution": "mock", "requests": requests, "remainingReplies": replies.count]
        }

        private func take(_ request: [String: Any], streaming: Bool) throws -> [String: Any] {
            lock.lock(); defer { lock.unlock() }
            requests.append(["request": request, "streaming": streaming])
            guard !replies.isEmpty else { throw failure("Unexpected model call without a queued mock response.") }
            let reply = replies.removeFirst()
            guard reply["prompt"] as? String == request["prompt"] as? String,
                  reply["mode"] as? String == request["mode"] as? String,
                  reply["streaming"] as? Bool == streaming
            else { throw failure("The mock response belongs to a different native request.") }
            return reply
        }

        private func wait(_ reply: [String: Any]) async throws {
            let milliseconds = reply["delayMs"] as? UInt64 ?? 0
            guard milliseconds <= 5000 else { throw failure("Mock delay exceeds its test-only bound.") }
            if milliseconds > 0 {
                try await Task.sleep(nanoseconds: milliseconds * 1_000_000)
            }
            try Task.checkCancellation()
            if let message = reply["error"] as? String {
                throw failure(message)
            }
        }

        func respond(_ request: [String: Any]) async throws -> String {
            let reply = try take(request, streaming: false)
            try await wait(reply)
            guard let text = reply["text"] as? String else { throw failure("Mock generation requires raw text or JSON.") }
            return text
        }

        func stream(_ request: [String: Any], snapshot: (String) -> Bool) async throws {
            let reply = try take(request, streaming: true)
            guard let snapshots = reply["snapshots"] as? [String], !snapshots.isEmpty else { throw failure("Mock streaming requires snapshots.") }
            for text in snapshots {
                try await wait(reply)
                if !snapshot(text) {
                    return
                }
            }
        }

        private func failure(_ message: String) -> NSError {
            appleFoundationModelsFailure("GENERATION_FAILED", message, nil)
        }
    }

    /// The whole endpoint is absent from production and physical-device builds; only synthetic test requests may be enqueued.
    @objc(OrotAppleModelMock)
    final class OrotAppleModelMock: NSObject {
        @objc static func requiresMainQueueSetup() -> Bool {
            false
        }

        @objc(configure:resolver:rejecter:)
        func configure(_ value: [String: Any], resolver resolve: RCTPromiseResolveBlock, rejecter _: RCTPromiseRejectBlock) {
            AppleFoundationModelsMock.shared.configure(value)
            resolve(nil)
        }

        @objc(enqueue:resolver:rejecter:)
        func enqueue(_ value: [String: Any], resolver resolve: RCTPromiseResolveBlock, rejecter _: RCTPromiseRejectBlock) {
            AppleFoundationModelsMock.shared.enqueue(value)
            resolve(nil)
        }

        @objc(observation:rejecter:)
        func observation(_ resolve: RCTPromiseResolveBlock, rejecter _: RCTPromiseRejectBlock) {
            resolve(AppleFoundationModelsMock.shared.observation())
        }
    }
#endif
