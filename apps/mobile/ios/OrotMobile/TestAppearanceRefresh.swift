#if OROT_TESTS
    import CoreFoundation
    import React
    import UIKit

    /// Reapply an observed XCTest device mode only in an opted-in test process; this does not prove automatic OS propagation.
    @MainActor
    final class TestAppearanceRefresh {
        static let shared = TestAppearanceRefresh()
        private weak var window: UIWindow?
        private var session = ""
        private var originalOverride = UIUserInterfaceStyle.unspecified
        private var appliedCount = 0
        private var lastCommand = "none"
        private var changed: (([String: Any]) -> Void)?

        func observe(window: UIWindow, session: String, changed: @escaping ([String: Any]) -> Void) -> [String: Any] {
            if self.session != session {
                CFNotificationCenterRemoveEveryObserver(CFNotificationCenterGetDarwinNotifyCenter(), Unmanaged.passUnretained(self).toOpaque())
                self.session = session
                originalOverride = window.overrideUserInterfaceStyle
                appliedCount = 0
                lastCommand = "none"
                // Darwin notifications carry names only. A per-run UUID prevents another test lane from selecting this window's style.
                for command in ["light", "dark", "restore"] {
                    let name = "com.orot.tests.appearance.\(session).\(command)" as CFString
                    CFNotificationCenterAddObserver(CFNotificationCenterGetDarwinNotifyCenter(), Unmanaged.passUnretained(self).toOpaque(),
                                                    { _, observer, name, _, _ in
                                                        guard let observer, let name else { return }
                                                        let refresh = Unmanaged<TestAppearanceRefresh>.fromOpaque(observer).takeUnretainedValue()
                                                        let command = (name.rawValue as String).components(separatedBy: ".").last ?? ""
                                                        DispatchQueue.main.async { refresh.apply(command) }
                                                    }, name, nil, .deliverImmediately)
                }
            }
            self.window = window
            self.changed = changed
            return snapshot()
        }

        private func apply(_ command: String) {
            guard let window else { return }
            let style: UIUserInterfaceStyle
            switch command {
            case "light": style = .light
            case "dark": style = .dark
            case "restore": style = originalOverride
            default: return
            }
            window.overrideUserInterfaceStyle = style
            if #available(iOS 17.0, *) {
                window.updateTraitsIfNeeded()
            }
            appliedCount += 1
            lastCommand = command
            // Notify RN with UIKit's actual resulting traits, never a fabricated JavaScript color scheme.
            NotificationCenter.default.post(name: .RCTUserInterfaceStyleDidChange, object: window,
                                            userInfo: [RCTUserInterfaceStyleDidChangeNotificationTraitCollectionKey: window.traitCollection])
            changed?(snapshot())
        }

        private func snapshot() -> [String: Any] {
            guard let window else { return ["session": session, "error": "Test window was released"] }
            return ["session": session, "strategy": "test-window-override", "appliedCount": appliedCount, "command": lastCommand,
                    "windowStyle": window.traitCollection.userInterfaceStyle.rawValue,
                    "sceneStyle": window.windowScene?.traitCollection.userInterfaceStyle.rawValue as Any? ?? NSNull(),
                    "screenStyle": window.screen.traitCollection.userInterfaceStyle.rawValue,
                    "overrideStyle": window.overrideUserInterfaceStyle.rawValue, "originalOverrideStyle": originalOverride.rawValue]
        }
    }
#endif
