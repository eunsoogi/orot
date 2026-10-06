import Foundation
import React

final class LocalE5EmbeddingRequestSlot {
    let requestId: String
    let reject: RCTPromiseRejectBlock
    var task: Task<Void, Never>?
    var cancelled = false
    var finished = false

    init(requestId: String, reject: @escaping RCTPromiseRejectBlock) {
        self.requestId = requestId
        self.reject = reject
    }
}
