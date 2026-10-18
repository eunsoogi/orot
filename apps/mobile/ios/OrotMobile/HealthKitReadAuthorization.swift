import Foundation
import HealthKit

/// Serializes ordinary and per-medication consent sheets. Completion never asserts that read access was granted.
enum HealthKitReadAuthorization {
    typealias Completion = (Bool, Error?) -> Void
    typealias StandardRequest = (Set<HKObjectType>, @escaping Completion) -> Void
    typealias ObjectRequest = (HKObjectType, @escaping Completion) -> Void

    static func request(store: HKHealthStore, readTypes: Set<HKObjectType>, perObjectReadTypes: [HKObjectType],
                        completion: @escaping Completion)
    {
        request(readTypes: readTypes, perObjectReadTypes: perObjectReadTypes,
                standard: { types, finish in
                    store.requestAuthorization(toShare: [], read: types, completion: finish)
                }, perObject: { type, finish in
                    // This API always presents the medication picker. Only explicit Settings consent reaches it;
                    // launch/foreground synchronization uses query-only paths and does not call this helper.
                    if #available(iOS 16.0, *) {
                        store.requestPerObjectReadAuthorization(for: type, predicate: nil, completion: finish)
                    } else {
                        // Current medication plans require iOS 26; reject unsupported callers without claiming completion.
                        finish(false, NSError(domain: "HealthKitReadAuthorization", code: 1,
                                              userInfo: [NSLocalizedDescriptionKey: "Per-object health authorization is unavailable."]))
                    }
                }, completion: completion)
    }

    /// Injectable request boundaries keep sequencing/error tests on the production coordinator without showing consent UI.
    static func request(readTypes: Set<HKObjectType>, perObjectReadTypes: [HKObjectType],
                        standard: @escaping StandardRequest, perObject: @escaping ObjectRequest,
                        completion: @escaping Completion)
    {
        func requestObject(at index: Int) {
            guard index < perObjectReadTypes.count else {
                completion(true, nil)
                return
            }
            perObject(perObjectReadTypes[index]) { success, error in
                guard success, error == nil else {
                    completion(false, error)
                    return
                }
                requestObject(at: index + 1)
            }
        }
        // Avoid passing an empty or medication-only set to the ordinary sample authorization API.
        guard !readTypes.isEmpty else {
            requestObject(at: 0)
            return
        }
        standard(readTypes) { success, error in
            guard success, error == nil else {
                completion(false, error)
                return
            }
            requestObject(at: 0)
        }
    }
}
