import OSLog
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider
import UIKit
import UserNotifications

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow? {
        didSet {
            guard let oldValue, oldValue !== window else { return }
            NotificationCenter.default.post(name: ConversationNativeSceneOwnership.windowReplaced, object: oldValue)
        }
    }

    private var encounterProtectionGeneration = UUID()
    private var encounterProtectionDenied = false

    /// Local transcript review needs continuity, not a fresh Boolean after unlock.
    func currentEncounterProtectionGeneration(in application: UIApplication) -> String? {
        guard !encounterProtectionDenied, application.isProtectedDataAvailable,
              application.applicationState == .active
        else { return nil }
        return encounterProtectionGeneration.uuidString.lowercased()
    }

    func applicationProtectedDataWillBecomeUnavailable(_: UIApplication) {
        // Retire before consulting any window or depending on a React listener.
        encounterProtectionDenied = true
        encounterProtectionGeneration = UUID()
        guard let window, let scene = window.windowScene,
              let delegate = scene.delegate as? SceneDelegate
        else { return }
        delegate.recordsSnapshotShield.protectionWillLock(in: window, scene: scene)
    }

    func applicationProtectedDataDidBecomeAvailable(_: UIApplication) {
        encounterProtectionDenied = false
        guard let window, let scene = window.windowScene,
              let delegate = scene.delegate as? SceneDelegate
        else { return }
        delegate.recordsSnapshotShield.protectionDidUnlock(in: window, scene: scene)
    }

    var reactNativeDelegate: ReactNativeDelegate?
    var reactNativeFactory: RCTReactNativeFactory?
    var launchOptions: [UIApplication.LaunchOptionsKey: Any]?

    func application(
        _: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil,
    ) -> Bool {
        self.launchOptions = launchOptions

        // Confirm that launch opt-in reached this process before the JS bridge starts.
        if let witness = ProcessDiagnosticWitness.current {
            witness.markLaunch()
            let diagnostics = Logger(subsystem: "com.orot.mobile", category: "provider-diagnostics")
            diagnostics.notice(
                "OROT_PROVIDER_DIAGNOSTIC layer=native feature=pipeline stage=launch_opt_in outcome=completed",
            )
        }

        #if OROT_TESTS && targetEnvironment(simulator)
            if TestFixtureCommand.runIfRequested() {
                return true
            }
            if !TestFixtureCommand.prepareIsolationIfRequested() {
                return true
            }
        #endif

        // Capture local reminder taps before React starts, including cold launches.
        // Registration alone never requests notification permission or starts AI work.
        UNUserNotificationCenter.current().delegate = AppointmentReminderDelivery.shared

        let delegate = ReactNativeDelegate()
        let factory = RCTReactNativeFactory(delegate: delegate)
        delegate.dependencyProvider = RCTAppDependencyProvider()

        reactNativeDelegate = delegate
        reactNativeFactory = factory

        return true
    }
}

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    let recordsSnapshotShield = RecordsSnapshotShield()

    #if OROT_TESTS
        /// The test probe observes current scene geometry without changing production orientation policy.
        @available(iOS 26.0, *)
        func windowScene(_ windowScene: UIWindowScene, didUpdateEffectiveGeometry _: UIWindowScene.Geometry) {
            guard UserDefaults.standard.string(forKey: "OROT_TEST_ROTATION_GEOMETRY_SESSION") != nil else { return }
            NavigationRotationProbe.shared.geometryChanged(windowScene)
        }
    #endif

    func sceneWillResignActive(_ scene: UIScene) {
        concealRecords(in: scene)
    }

    func sceneDidEnterBackground(_ scene: UIScene) {
        concealRecords(in: scene)
    }

    func sceneDidDisconnect(_ scene: UIScene) {
        if let windowScene = scene as? UIWindowScene {
            recordsSnapshotShield.disconnect(windowScene)
        }
    }

    private func concealRecords(in scene: UIScene) {
        guard let window, let windowScene = scene as? UIWindowScene else { return }
        recordsSnapshotShield.sceneSuspended(in: window, scene: windowScene)
    }

    /// Foreground reconciliation observes revoked permissions without prompting.
    func sceneDidBecomeActive(_ scene: UIScene) {
        if let window, let windowScene = scene as? UIWindowScene {
            recordsSnapshotShield.sceneResumed(in: window, scene: windowScene)
        }
        Task { _ = await DailyReminderNotifications.shared.reconcile() }
    }

    func scene(
        _ scene: UIScene,
        willConnectTo _: UISceneSession,
        options: UIScene.ConnectionOptions,
    ) {
        guard
            let windowScene = scene as? UIWindowScene,
            let appDelegate = UIApplication.shared.delegate as? AppDelegate,
            let factory = appDelegate.reactNativeFactory
        else {
            return
        }

        // Capture cold URLs before React starts; the inbox stores validated root descriptors only.
        options.urlContexts.forEach { RootURLInbox.shared.receive($0.url) }
        let window: UIWindow
        #if OROT_TESTS
            if let run = VisitQuestionInputGate.session() {
                window = VisitQuestionInputObservationWindow(windowScene: windowScene, run: run)
            } else if let run = EncounterInputGate.session() {
                window = EncounterInputObservationWindow(windowScene: windowScene, run: run)
            } else {
                window = UIWindow(windowScene: windowScene)
            }
        #else
            window = UIWindow(windowScene: windowScene)
        #endif
        // Resolve the app-only preference before the first React or UIKit surface is visible.
        window.overrideUserInterfaceStyle = switch UserDefaults.standard.string(forKey: "orot.app.display-mode.v1") {
        case "light":
            .light
        case "dark":
            .dark
        default:
            .unspecified
        }
        self.window = window
        appDelegate.window = window

        factory.startReactNative(
            withModuleName: "Orot",
            in: window,
            launchOptions: appDelegate.launchOptions,
        )
    }

    func scene(_: UIScene, openURLContexts contexts: Set<UIOpenURLContext>) {
        contexts.forEach { RootURLInbox.shared.receive($0.url) }
    }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
    override func sourceURL(for _: RCTBridge) -> URL? {
        bundleURL()
    }

    override func bundleURL() -> URL? {
        #if OROT_TESTS
            // Native test products embed their own entry, including Debug provider fixtures;
            // a consumer must not depend on a producer's Metro process or rebuild the app.
            Bundle.main.url(forResource: "main", withExtension: "jsbundle")
        #elseif DEBUG
            RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
        #else
            Bundle.main.url(forResource: "main", withExtension: "jsbundle")
        #endif
    }
}
