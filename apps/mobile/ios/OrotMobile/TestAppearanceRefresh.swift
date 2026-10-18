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
        private var animationSamples: [[String: Any]] = []
        private var animationDiagnostics: Bool {
            UserDefaults.standard.string(forKey: "OROT_TEST_ANIMATION_DIAGNOSTICS") == "YES"
        }

        func observe(window: UIWindow, session: String, changed: @escaping ([String: Any]) -> Void) -> [String: Any] {
            if self.session != session {
                CFNotificationCenterRemoveEveryObserver(CFNotificationCenterGetDarwinNotifyCenter(), Unmanaged.passUnretained(self).toOpaque())
                self.session = session
                originalOverride = window.overrideUserInterfaceStyle
                appliedCount = 0
                lastCommand = "none"
                animationSamples = []
                diagnoseAnimations(stage: "observe")
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
            diagnoseAnimations(stage: command)
        }

        /// Opt-in diagnostics retain only bounded class/key/timing summaries, never views, labels or user content.
        /// Observe existing animations without cancelling them or changing XCTest synchronization.
        /// The next appearance command publishes completed samples; sampling itself emits no RN update.
        /// Consequently the final restore's samples are not collected, and an earlier failure can leave samples unpublished.
        private func diagnoseAnimations(stage: String) {
            guard animationDiagnostics else { return }
            let commandIndex = appliedCount
            let scheduledAt = Date().timeIntervalSince1970
            for delay in [0.0, 5.0, 65.0] {
                DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                    guard let self else { return }
                    var groups: [String: Int] = [:]
                    var visited = 0
                    var truncated = false
                    func visit(_ layer: CALayer, depth: Int) {
                        guard visited < 4096, depth < 64 else { truncated = true; return }
                        visited += 1
                        for key in layer.animationKeys() ?? [] {
                            guard let animation = layer.animation(forKey: key) else { continue }
                            // UIKit can use infinite duration for Glass geometry tracking. Strings keep JSON finite.
                            let description = "\(type(of: layer));key=\(key.prefix(80));duration=\(animation.duration);repeat=\(animation.repeatCount);speed=\(animation.speed);removed=\(animation.isRemovedOnCompletion)"
                            if groups[description] != nil || groups.count < 16 {
                                groups[description, default: 0] += 1
                            } else {
                                truncated = true
                            }
                        }
                        for child in layer.sublayers ?? [] {
                            visit(child, depth: depth + 1)
                        }
                    }
                    for scene in UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }) {
                        for window in scene.windows {
                            visit(window.layer, depth: 0)
                        }
                    }
                    animationSamples.append(["stage": stage, "commandIndex": commandIndex, "scheduledAtUnixSeconds": scheduledAt,
                                             "scheduledDelaySeconds": delay, "sampledAtUnixSeconds": Date().timeIntervalSince1970, "visitedLayers": visited,
                                             "truncated": truncated, "groups": groups])
                    animationSamples = Array(animationSamples.suffix(8))
                }
            }
        }

        private func snapshot() -> [String: Any] {
            guard let window else { return ["session": session, "error": "Test window was released"] }
            var result: [String: Any] = ["session": session, "strategy": "test-window-override", "appliedCount": appliedCount, "command": lastCommand,
                                         "windowStyle": window.traitCollection.userInterfaceStyle.rawValue,
                                         "sceneStyle": window.windowScene?.traitCollection.userInterfaceStyle.rawValue as Any? ?? NSNull(),
                                         "screenStyle": window.screen.traitCollection.userInterfaceStyle.rawValue,
                                         "overrideStyle": window.overrideUserInterfaceStyle.rawValue, "originalOverrideStyle": originalOverride.rawValue]
            if animationDiagnostics {
                result["animationDiagnostics"] = animationSamples
            }
            return result
        }
    }
#endif
