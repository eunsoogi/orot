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

    func scene(
        _ scene: UIScene,
        willConnectTo _: UISceneSession,
        options _: UIScene.ConnectionOptions,
    ) {
        guard
            let windowScene = scene as? UIWindowScene,
            let appDelegate = UIApplication.shared.delegate as? AppDelegate,
            let factory = appDelegate.reactNativeFactory
        else {
            return
        }

        let window: UIWindow
        #if OROT_TESTS
            if let launch = HealthReviewObservationWindow.session() {
                window = HealthReviewObservationWindow(windowScene: windowScene, launch: launch)
            } else if let run = VisitQuestionInputGate.session() {
                window = VisitQuestionInputObservationWindow(windowScene: windowScene, run: run)
            } else if let run = EncounterInputGate.session() {
                window = EncounterInputObservationWindow(windowScene: windowScene, run: run)
            } else {
                window = UIWindow(windowScene: windowScene)
            }
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
