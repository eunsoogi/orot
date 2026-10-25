import CryptoKit
import Foundation
import React

/// The bridge returns a collision-resistant receipt key without retaining or logging the request.
@objc(OrotConsentFingerprint)
final class ConsentFingerprintModule: NSObject {
    @objc static func requiresMainQueueSetup() -> Bool {
        false
    }

    @objc(sha256:resolver:rejecter:)
    func sha256(
        _ text: String,
        resolver resolve: RCTPromiseResolveBlock,
        rejecter reject: RCTPromiseRejectBlock,
    ) {
        // Outbound requests are already bounded by the workflow; retain a bridge-level upper bound too.
        guard text.utf8.count <= 2_000_000 else {
            reject("CONSENT_SNAPSHOT_TOO_LARGE", "The consent snapshot exceeds its size bound.", nil)
            return
        }
        resolve(SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined())
    }
}
