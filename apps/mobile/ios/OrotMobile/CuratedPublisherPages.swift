import Foundation
import React

/// Non-browser bridge for explicit publisher-index refresh. A caller can pass only
/// a fixed publisher URL and a local cancellation ID. No query or headers are accepted.
@objc(CuratedPublisherPages)
final class CuratedPublisherPages: NSObject {
    private let lock = NSLock()
    private var active: [String: Task<Void, Never>] = [:]
    private var closed = false

    @objc static func requiresMainQueueSetup() -> Bool { false }

    @objc(load:requestId:resolver:rejecter:)
    func load(_ url: String, requestId: String,
              resolver resolve: @escaping RCTPromiseResolveBlock,
              rejecter reject: @escaping RCTPromiseRejectBlock)
    {
        lock.lock()
        guard !closed, !requestId.isEmpty, requestId.count <= 64,
              active[requestId] == nil, active.count < 6
        else {
            lock.unlock()
            reject("PUBLISHER_UNAVAILABLE", "Publisher page is unavailable.", nil)
            return
        }
        // Registration is synchronous before the bridge handles the next call.
        active[requestId] = Task { [weak self] in
            defer { self?.finish(requestId) }
            do {
                let html = try await CuratedPublisherPageLoader().load(exactURL: url)
                try Task.checkCancellation()
                resolve(html)
            } catch {
                reject("PUBLISHER_UNAVAILABLE", "Publisher page is unavailable.", nil)
            }
        }
        lock.unlock()
    }

    @objc(cancel:)
    func cancel(_ requestId: String) {
        lock.lock()
        let task = active[requestId]
        lock.unlock()
        task?.cancel()
    }

    private func finish(_ requestId: String) {
        lock.lock()
        active.removeValue(forKey: requestId)
        lock.unlock()
    }

    @objc func invalidate() {
        lock.lock()
        closed = true
        let tasks = Array(active.values)
        lock.unlock()
        tasks.forEach { $0.cancel() }
    }
}
