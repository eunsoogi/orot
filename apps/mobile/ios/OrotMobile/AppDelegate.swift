import React
import React_RCTAppDelegate
import ReactAppDependencyProvider
import UIKit
import UserNotifications

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    var reactNativeDelegate: ReactNativeDelegate?
    var reactNativeFactory: RCTReactNativeFactory?
    var launchOptions: [UIApplication.LaunchOptionsKey: Any]?

    func application(
        _: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil,
    ) -> Bool {
        self.launchOptions = launchOptions

        #if OROT_TESTS && !targetEnvironment(simulator)
            if UserDefaults.standard.string(forKey: "OROT_TEST_SCENARIO") == "active-tab-workload" {
                return true
            }
        #endif
        #if OROT_TESTS && targetEnvironment(simulator)
            if UserDefaults.standard.string(forKey: "OROT_TEST_SCENARIO") == "active-tab-workload" {
                guard let token = UserDefaults.standard.string(forKey: "OROT_WORKLOAD_SESSION") else { return true }
                do {
                    try TestFixtureState.requireEmptyWorkloadStore(token)
                } catch {
                    NSLog("OROT_WORKLOAD_FIXTURE_UNAVAILABLE")
                    return true
                }
            }
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

    #if OROT_TESTS
        /// The test probe observes current scene geometry without changing production orientation policy.
        @available(iOS 26.0, *)
        func windowScene(_ windowScene: UIWindowScene, didUpdateEffectiveGeometry _: UIWindowScene.Geometry) {
            guard UserDefaults.standard.string(forKey: "OROT_TEST_ROTATION_GEOMETRY_SESSION") != nil else { return }
            NavigationRotationProbe.shared.geometryChanged(windowScene)
        }
    #endif

    /// Foreground reconciliation observes revoked permissions without prompting.
    func sceneDidBecomeActive(_: UIScene) {
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
            #if targetEnvironment(simulator)
                if UserDefaults.standard.string(forKey: "OROT_TEST_SCENARIO") == "active-tab-workload",
                   let run = UserDefaults.standard.string(forKey: "OROT_WORKLOAD_SESSION").flatMap(UUID.init(uuidString:))
                {
                    window = ActiveTabObservationWindow(windowScene: windowScene, run: run)
                } else if let run = VisitQuestionInputGate.session() {
                    window = VisitQuestionInputObservationWindow(windowScene: windowScene, run: run)
                } else if let run = EncounterInputGate.session() {
                    window = EncounterInputObservationWindow(windowScene: windowScene, run: run)
                } else {
                    window = UIWindow(windowScene: windowScene)
                }
            #else
                if let run = VisitQuestionInputGate.session() {
                    window = VisitQuestionInputObservationWindow(windowScene: windowScene, run: run)
                } else if let run = EncounterInputGate.session() {
                    window = EncounterInputObservationWindow(windowScene: windowScene, run: run)
                } else {
                    window = UIWindow(windowScene: windowScene)
                }
            #endif
        #else
            window = UIWindow(windowScene: windowScene)
        #endif
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
