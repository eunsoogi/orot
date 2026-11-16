import Foundation
import React

/// JS owns request-scoped consent and account revision checks; this bridge limits the wire destination.
/// Neither server bodies nor Foundation errors are included in rejection messages or logs.
@objc(CalendarDecisionsTransport)
final class CalendarDecisionsTransport: NSObject {
    private let lock = NSLock()
    private var requests: [String: CalendarDecisionsRequest] = [:]
    private var cancelled: Set<String> = []
    private var closed = false

    @objc static func requiresMainQueueSetup() -> Bool { false }

    @objc(post:apiKey:requestId:resolver:rejecter:)
    func post(_ body: String, apiKey: String, requestId: String,
              resolver resolve: @escaping RCTPromiseResolveBlock,
              rejecter reject: @escaping RCTPromiseRejectBlock)
    {
        lock.lock()
        guard !closed, UUID(uuidString: requestId) != nil, requests[requestId] == nil,
              requests.count < 4, !cancelled.contains(requestId)
        else {
            lock.unlock()
            reject("CALENDAR_REQUEST_UNAVAILABLE", "Calendar classification request is unavailable.", nil)
            return
        }
        let request = CalendarDecisionsRequest { [weak self] result in
            if let self {
                lock.lock()
                requests.removeValue(forKey: requestId)
                lock.unlock()
            }
            switch result {
            case let .success(value): resolve(value)
            case .failure:
                reject("CALENDAR_REQUEST_FAILED", "Calendar classification request failed.", nil)
            }
        }
        requests[requestId] = request
        lock.unlock()
        request.start(body: body, apiKey: apiKey)
    }

    @objc(cancel:)
    func cancel(_ requestId: String) {
        guard UUID(uuidString: requestId) != nil else { return }
        lock.lock()
        let request = requests[requestId]
        // Never evict pre-registration cancellations and accidentally permit a delayed sensitive POST.
        // Fail closed at a bounded tombstone limit until this bridge is recreated.
        if cancelled.count >= 1024 { closed = true } else { cancelled.insert(requestId) }
        lock.unlock()
        request?.cancel()
    }

    @objc func invalidate() {
        lock.lock()
        closed = true
        let active = Array(requests.values)
        requests.removeAll()
        lock.unlock()
        active.forEach { $0.cancel() }
    }
}
