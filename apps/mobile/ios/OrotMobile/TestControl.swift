#if OROT_TESTS
    import Foundation
    import React

    /// The test entry consumes commands and returns observations through the normal RN native bridge.
    @objc(OrotTestControl)
    final class OrotTestControl: NSObject {
        @objc static func requiresMainQueueSetup() -> Bool {
            false
        }

        @objc(nextRequest:rejecter:)
        func nextRequest(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
            TestOperationBroker.shared.next(resolve, reject: reject)
        }

        @objc(complete:result:)
        func complete(_ identifier: String, result: [String: Any]) {
            TestOperationBroker.shared.finish(identifier, result: .success(result))
        }

        @objc(fail:message:)
        func fail(_ identifier: String, message: String) {
            TestOperationBroker.shared.finish(identifier, result: .failure(TestOperationBroker.Failure.javascript(message)))
        }
    }
#endif
