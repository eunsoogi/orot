import CoreFoundation
import Foundation
import React
import UIKit

/// Maps an expiring UIKit grant onto a retained request without trusting React AppState.
final class ConversationNativeSceneOwnership {
    private weak var window: UIWindow?
    private weak var scene: UIWindowScene?
    private var leases = ConversationShortLeaseBook<UIBackgroundTaskIdentifier>()

    func bindWindow() {
        window = (UIApplication.shared.delegate as? AppDelegate)?.window
        scene = window?.windowScene
    }

    func clearWindow() {
        window = nil
        scene = nil
    }

    var hasVisibleForegroundOwner: Bool {
        guard UIApplication.shared.isProtectedDataAvailable,
              let window,
              window === (UIApplication.shared.delegate as? AppDelegate)?.window,
              !window.isHidden, window.alpha > 0,
              window.rootViewController?.viewIfLoaded?.window === window,
              let scene, window.windowScene === scene
        else { return false }
        return scene.activationState == .foregroundActive || scene.activationState == .foregroundInactive
    }

    func observeBackground(_ center: NotificationCenter, handler: @escaping () -> Void) -> NSObjectProtocol {
        center.addObserver(forName: UIScene.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] notification in
            guard let scene = notification.object as? UIWindowScene, scene === self?.scene,
                  scene.activationState == .background
            else { return }
            handler()
        }
    }

    func hasShortLease(_ requestId: String) -> Bool {
        leases.contains(requestId)
    }

    func beginShortLease(_ requestId: String, expired: @escaping () -> Void) -> Bool {
        guard !leases.contains(requestId) else { return false }
        let epoch = UUID()
        let task = UIApplication.shared.beginBackgroundTask(withName: "Conversation request") { [weak self] in
            guard let self, let task = leases.retire(requestId, matching: epoch) else { return }
            UIApplication.shared.endBackgroundTask(task)
            expired()
        }
        guard task != .invalid else { return false }
        leases.register(task, requestId: requestId, epoch: epoch)
        return true
    }

    func finishShortLease(_ requestId: String) {
        if let task = leases.retire(requestId) {
            UIApplication.shared.endBackgroundTask(task)
        }
    }
}

/// Private generation registry for short native resources; old callback IDs cannot adopt a new grant.
struct ConversationShortLeaseBook<Resource> {
    private struct Entry {
        let epoch: UUID
        let resource: Resource
    }

    private var entries: [String: Entry] = [:]

    func contains(_ requestId: String) -> Bool {
        entries[requestId] != nil
    }

    mutating func register(_ resource: Resource, requestId: String, epoch: UUID) {
        precondition(entries[requestId] == nil)
        entries[requestId] = Entry(epoch: epoch, resource: resource)
    }

    mutating func retire(_ requestId: String, matching epoch: UUID? = nil) -> Resource? {
        guard let entry = entries[requestId], epoch == nil || entry.epoch == epoch else { return nil }
        entries.removeValue(forKey: requestId)
        return entry.resource
    }
}

enum ConversationLeaseOwnership {
    static func retainAfterShortExpiry(hasContinued: Bool, hasVisibleOwner: Bool) -> Bool {
        hasContinued || hasVisibleOwner
    }

    static func rearmForBackground(hasShortLease: Bool, hasContinued: Bool) -> Bool {
        !hasShortLease && !hasContinued
    }
}

func observeConversationBackgroundFixtureFailure(_ module: ConversationExecutionModule) {
    #if OROT_TESTS && targetEnvironment(simulator)
        if let token = UserDefaults.standard.string(forKey: "OROT_TEST_BACKGROUND_TOKEN") {
            module.signalBackgroundFailure(token)
        }
    #endif
}

#if OROT_TESTS && targetEnvironment(simulator)
    extension ConversationExecutionModule {
        /// Signal the test host only after the saved answer and an actual background lease coexist.
        @objc(signalBackgroundCommit:token:resolver:rejecter:)
        func signalBackgroundCommit(_ requestId: String, token: String, resolve: RCTPromiseResolveBlock, reject _: RCTPromiseRejectBlock) {
            guard UserDefaults.standard.string(forKey: "OROT_TEST_SCENARIO") == "conversation-background-retention",
                  UUID(uuidString: token) != nil,
                  UIApplication.shared.applicationState == .background,
                  ownsShortLease(requestId) else { resolve(false); return }
            let name = CFNotificationName("com.orot.tests.conversation-background.\(token)" as CFString)
            CFNotificationCenterPostNotification(CFNotificationCenterGetDarwinNotifyCenter(), name, nil, nil, true)
            resolve(true)
        }
    }
#endif

/// Process-scoped, not bridge-scoped: a JS reload must never look like owner death.
private let conversationProcessInstance = UUID().uuidString

extension ConversationExecutionModule {
    @objc(processIdentity:rejecter:)
    func processIdentity(_ resolve: RCTPromiseResolveBlock, reject _: RCTPromiseRejectBlock) {
        // Recovery assumes the single iOS application process, not an extension or
        // desktop multi-instance host. Unsupported hosts never attest owner death.
        guard Bundle.main.bundleURL.pathExtension == "app",
              !ProcessInfo.processInfo.isMacCatalystApp,
              !ProcessInfo.processInfo.isiOSAppOnMac,
              UIApplication.shared.isProtectedDataAvailable
        else { resolve(NSNull()); return }
        resolve(conversationProcessInstance)
    }
}
