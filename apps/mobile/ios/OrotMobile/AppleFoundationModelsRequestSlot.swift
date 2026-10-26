import Foundation
import React

/// The emitter's NSLock protects every mutation of the task and lifecycle flags.
final class AppleFoundationModelsRequestSlot {
    let id: String
    let completion: ((NSDictionary?, NSError?) -> Void)?
    let event: ((NSDictionary) -> Void)?
    var task: Task<Void, Never>?
    var cancelled = false
    var finished = false
    init(_ id: String, _ completion: ((NSDictionary?, NSError?) -> Void)?, _ event: ((NSDictionary) -> Void)?) {
        self.id = id
        self.completion = completion
        self.event = event
    }
}
