import Foundation
import HealthKit
import UIKit

/// Serializes ordinary and per-medication requests without exposing whether HealthKit granted read access.
enum HealthKitReadAuthorization {
    typealias Completion = (Bool, Error?) -> Void
    typealias StandardRequest = (Set<HKObjectType>, @escaping Completion) -> Void
    typealias ObjectRequest = (HKObjectType, @escaping Completion) -> Void
    typealias PresentationGate = (@escaping Completion) -> Void
    typealias RequestCompletion = (Result<Void, Failure>) -> Void

    /// Keeps bridge diagnostics useful while excluding variable HealthKit error text.
    enum Failure: Error, Equatable {
        case standardRequestFailed
        case medicationRequestFailed
        case presentationUnavailable

        var stage: String {
            switch self {
            case .standardRequestFailed: "standardRequest"
            case .medicationRequestFailed: "medicationRequest"
            case .presentationUnavailable: "presentation"
            }
        }

        var code: String {
            switch self {
            case .standardRequestFailed, .medicationRequestFailed: "requestFailed"
            case .presentationUnavailable: "presentationUnavailable"
            }
        }

        var bridgeCode: String {
            switch self {
            case .standardRequestFailed: "HEALTHKIT_AUTHORIZATION_STANDARD_REQUEST_FAILED"
            case .medicationRequestFailed: "HEALTHKIT_AUTHORIZATION_MEDICATION_REQUEST_FAILED"
            case .presentationUnavailable: "HEALTHKIT_AUTHORIZATION_PRESENTATION_UNAVAILABLE"
            }
        }

        var bridgeMessage: String {
            switch self {
            case .standardRequestFailed: "HealthKit authorization request failed."
            case .medicationRequestFailed: "Medication authorization request failed."
            case .presentationUnavailable: "Medication authorization could not be presented."
            }
        }
    }

    static func request(store: HKHealthStore, readTypes: Set<HKObjectType>, perObjectReadTypes: [HKObjectType],
                        completion: @escaping RequestCompletion)
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
                }, presentationReady: waitForPresentation, completion: completion)
    }

    /// Injectable request boundaries keep sequencing/error tests on the production coordinator without showing consent UI.
    static func request(readTypes: Set<HKObjectType>, perObjectReadTypes: [HKObjectType],
                        standard: @escaping StandardRequest, perObject: @escaping ObjectRequest,
                        presentationReady: @escaping PresentationGate = { $0(true, nil) },
                        completion: @escaping RequestCompletion)
    {
        func requestObject(at index: Int) {
            guard index < perObjectReadTypes.count else {
                completion(.success(()))
                return
            }
            presentationReady { ready, presentationError in
                guard ready, presentationError == nil else {
                    completion(.failure(.presentationUnavailable))
                    return
                }
                perObject(perObjectReadTypes[index]) { success, error in
                    guard success, error == nil else {
                        completion(.failure(.medicationRequestFailed))
                        return
                    }
                    requestObject(at: index + 1)
                }
            }
        }
        // Avoid passing an empty or medication-only set to the ordinary sample authorization API.
        guard !readTypes.isEmpty else {
            requestObject(at: 0)
            return
        }
        standard(readTypes) { success, error in
            guard success, error == nil else {
                completion(.failure(.standardRequestFailed))
                return
            }
            requestObject(at: 0)
        }
    }

    /// HealthKit's completion precedes dismissal of its ordinary consent sheet.
    /// Wait for a live app presenter, not a guessed delay; fail retryably if another
    /// modal or inactive scene prevents presentation for five seconds.
    private static func waitForPresentation(_ completion: @escaping Completion) {
        func check(_ attempt: Int) {
            let root = UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .filter { $0.activationState == .foregroundActive }
                .flatMap(\.windows).first(where: \.isKeyWindow)?.rootViewController
            if let root, root.viewIfLoaded?.window != nil, root.presentedViewController == nil {
                completion(true, nil)
            } else if attempt < 100 {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { check(attempt + 1) }
            } else {
                completion(false, NSError(domain: "HealthKitReadAuthorization", code: 2,
                                          userInfo: [NSLocalizedDescriptionKey: "Health authorization could not be presented. Please retry from Settings."]))
            }
        }
        DispatchQueue.main.async { check(0) }
    }
}
