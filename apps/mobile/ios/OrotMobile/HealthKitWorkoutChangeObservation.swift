import Foundation
import HealthKit
import UIKit

/// Foreground-only, payload-free wake. The already-authorized anchored importer
/// separately reads, validates and commits records; no background delivery is enabled.
final class HealthKitWorkoutChangeObservation {
    private let store: HKHealthStore
    private let wake: () -> Void
    private var query: HKObserverQuery?
    private var stops: [NSObjectProtocol] = []

    init(store: HKHealthStore, wake: @escaping () -> Void) {
        self.store = store
        self.wake = wake
    }

    private var foregroundProtected: Bool {
        UIApplication.shared.applicationState == .active && UIApplication.shared.isProtectedDataAvailable
    }

    func start() {
        dispatchPrecondition(condition: .onQueue(.main))
        guard query == nil, HKHealthStore.isHealthDataAvailable(), foregroundProtected else { return }
        let observer = HKObserverQuery(sampleType: HKObjectType.workoutType(), predicate: nil) { [weak self] source, completion, error in
            // This is a notification-only observer; no records need finishing in the callback.
            defer { completion() }
            guard error == nil else { return }
            DispatchQueue.main.async { [weak self] in
                guard let self, query === source, foregroundProtected else { return }
                wake()
            }
        }
        let center = NotificationCenter.default
        for name in [UIApplication.willResignActiveNotification, UIApplication.protectedDataWillBecomeUnavailableNotification] {
            stops.append(center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                self?.stop()
            })
        }
        query = observer
        store.execute(observer)
    }

    func stop() {
        dispatchPrecondition(condition: .onQueue(.main))
        if let query {
            store.stop(query)
        }
        query = nil
        stops.forEach(NotificationCenter.default.removeObserver)
        stops.removeAll()
    }

    deinit {
        if let query {
            store.stop(query)
        }
        stops.forEach(NotificationCenter.default.removeObserver)
    }
}
