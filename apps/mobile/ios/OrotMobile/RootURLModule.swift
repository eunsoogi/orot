import Foundation
import React

/// Events wake JavaScript; the inbox remains authoritative until acknowledgement.
@objc(RootURLModule)
final class RootURLModule: RCTEventEmitter {
    private var observer: NSObjectProtocol?

    @objc override static func requiresMainQueueSetup() -> Bool { false }
    override func supportedEvents() -> [String]! { ["rootURLOpened"] }

    override func startObserving() {
        DispatchQueue.main.async { [weak self] in
            guard let self, observer == nil else { return }
            observer = NotificationCenter.default.addObserver(forName: RootURLInbox.changed, object: nil, queue: .main) { [weak self] _ in
                self?.sendEvent(withName: "rootURLOpened", body: nil)
            }
            if RootURLInbox.shared.peek() != nil { sendEvent(withName: "rootURLOpened", body: nil) }
        }
    }

    override func stopObserving() {
        DispatchQueue.main.async { [weak self] in
            guard let self, let observer else { return }
            NotificationCenter.default.removeObserver(observer)
            self.observer = nil
        }
    }

    deinit {
        if let observer { NotificationCenter.default.removeObserver(observer) }
    }

    @objc(peek:rejecter:)
    func peek(_ resolve: RCTPromiseResolveBlock, rejecter _: RCTPromiseRejectBlock) {
        resolve(RootURLInbox.shared.peek() as Any? ?? NSNull())
    }

    @objc(acknowledge:resolver:rejecter:)
    func acknowledge(_ id: String, resolver resolve: RCTPromiseResolveBlock, rejecter _: RCTPromiseRejectBlock) {
        RootURLInbox.shared.acknowledge(id)
        resolve(nil)
    }
}
