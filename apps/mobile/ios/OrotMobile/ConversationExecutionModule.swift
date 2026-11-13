import CoreFoundation
import Foundation
import React
import UIKit

/// Extends an active request only for the time iOS grants; expiration is terminal for the lease.
@objc(ConversationExecutionModule)
final class ConversationExecutionModule: RCTEventEmitter {
    private var leases: [String: UIBackgroundTaskIdentifier] = [:]
    private var observers: [NSObjectProtocol] = []
    private var listening = false

    override static func requiresMainQueueSetup() -> Bool {
        true
    }

    override var methodQueue: DispatchQueue! {
        DispatchQueue.main
    }

    override func supportedEvents() -> [String]! {
        ["ConversationExecutionChanged"]
    }

    override func startObserving() {
        listening = true
        let center = NotificationCenter.default
        for name in [UIApplication.protectedDataWillBecomeUnavailableNotification,
                     UIApplication.protectedDataDidBecomeAvailableNotification]
        {
            observers.append(center.addObserver(forName: name, object: nil, queue: .main) { [weak self] notification in
                // The will-unavailable notification precedes the getter changing to false.
                let available = notification.name == UIApplication.protectedDataDidBecomeAvailableNotification
                #if OROT_TESTS && targetEnvironment(simulator)
                    if !available, let token = UserDefaults.standard.string(forKey: "OROT_TEST_BACKGROUND_TOKEN") {
                        self?.signalBackgroundFailure(token)
                    }
                #endif
                self?.publish(["kind": "protectedData", "available": available])
            })
        }
    }

    override func stopObserving() {
        listening = false
        observers.forEach { NotificationCenter.default.removeObserver($0) }
        observers.removeAll()
    }

    private func publish(_ body: [String: Any]) {
        if listening {
            sendEvent(withName: "ConversationExecutionChanged", body: body)
        }
    }

    @objc(begin:resolver:rejecter:)
    func begin(_ requestId: String, resolve: RCTPromiseResolveBlock, reject _: RCTPromiseRejectBlock) {
        guard !requestId.isEmpty, leases[requestId] == nil else { resolve(false); return }
        let task = UIApplication.shared.beginBackgroundTask(withName: "Conversation request") { [weak self] in
            guard let self else { return }
            #if OROT_TESTS && targetEnvironment(simulator)
                if let token = UserDefaults.standard.string(forKey: "OROT_TEST_BACKGROUND_TOKEN") {
                    signalBackgroundFailure(token)
                }
            #endif
            endLease(requestId)
            publish(["kind": "expired", "requestId": requestId])
        }
        guard task != .invalid else { resolve(false); return }
        leases[requestId] = task
        resolve(true)
    }

    @objc(end:)
    func end(_ requestId: String) {
        endLease(requestId)
    }

    @objc(isActive:resolver:rejecter:)
    func isActive(_ requestId: String, resolve: RCTPromiseResolveBlock, reject _: RCTPromiseRejectBlock) {
        resolve(leases[requestId] != nil)
    }

    #if OROT_TESTS && targetEnvironment(simulator)
        /// Signal the test host only after the saved answer and an actual background lease coexist.
        @objc(signalBackgroundCommit:token:resolver:rejecter:)
        func signalBackgroundCommit(_ requestId: String, token: String, resolve: RCTPromiseResolveBlock, reject _: RCTPromiseRejectBlock) {
            guard UserDefaults.standard.string(forKey: "OROT_TEST_SCENARIO") == "conversation-background-retention",
                  UUID(uuidString: token) != nil,
                  UIApplication.shared.applicationState == .background,
                  leases[requestId] != nil else { resolve(false); return }
            let name = CFNotificationName("com.orot.tests.conversation-background.\(token)" as CFString)
            CFNotificationCenterPostNotification(CFNotificationCenterGetDarwinNotifyCenter(), name, nil, nil, true)
            resolve(true)
        }

        /// A test failure wakes the host without exposing request text or changing production behavior.
        @objc(signalBackgroundFailure:)
        func signalBackgroundFailure(_ token: String) {
            guard UserDefaults.standard.string(forKey: "OROT_TEST_SCENARIO") == "conversation-background-retention",
                  UUID(uuidString: token) != nil else { return }
            let name = CFNotificationName("com.orot.tests.conversation-background-failure.\(token)" as CFString)
            CFNotificationCenterPostNotification(CFNotificationCenterGetDarwinNotifyCenter(), name, nil, nil, true)
        }
    #endif

    private func endLease(_ requestId: String) {
        guard let task = leases.removeValue(forKey: requestId) else { return }
        UIApplication.shared.endBackgroundTask(task)
    }

    @objc(protectedDataAvailable:rejecter:)
    func protectedDataAvailable(_ resolve: RCTPromiseResolveBlock, reject _: RCTPromiseRejectBlock) {
        resolve(UIApplication.shared.isProtectedDataAvailable)
    }

    override func invalidate() {
        stopObserving()
        for requestId in Array(leases.keys) {
            endLease(requestId)
        }
        super.invalidate()
    }
}
