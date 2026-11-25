import Foundation
@testable import Orot
import UIKit
import XCTest

/// A synthetic queued permission response must not make an obsolete OS notification authoritative.
extension RealtimeVoiceLifecycleTests {
    func testStaleActiveNotificationCannotOpenOrRetirePendingLiveCall() async {
        let audio = Audio(), socket = Socket()
        var foreground = false
        let ownership = AudioSessionOwnership(configure: { _, _, _ in }, setActive: { _ in })
        let call = RealtimeVoiceCall(audio: audio, socket: socket, ownership: ownership,
                                     permission: { $0(true) }, foreground: { foreground }, emit: { _, _ in })
        defer { try? call.stop("call") }
        call.open("call", model: "gpt-live-1.1", key: "synthetic-key", language: "auto") { _ in }
        let queued = expectation(description: "permission callback stored a pending start")
        DispatchQueue.main.async { queued.fulfill() }
        await fulfillment(of: [queued], timeout: 1)
        XCTAssertNotNil(call.pending)
        XCTAssertEqual(socket.opens, 0)

        NotificationCenter.default.post(name: UIApplication.didBecomeActiveNotification, object: nil)
        XCTAssertEqual(socket.opens, 0)
        XCTAssertEqual(socket.closes, 0)
        XCTAssertTrue(socket.sent.isEmpty)
        XCTAssertEqual(call.id, "call")
        XCTAssertNotNil(call.pending)

        foreground = true
        NotificationCenter.default.post(name: UIApplication.didBecomeActiveNotification, object: nil)
        NotificationCenter.default.post(name: UIApplication.didBecomeActiveNotification, object: nil)
        XCTAssertEqual(socket.opens, 1)
        XCTAssertEqual(socket.sent.compactMap { $0["type"] as? String }, ["session.start"])
        XCTAssertNil(call.pending)
        XCTAssertEqual(audio.starts, 0, "Socket admission is not an audio activation.")
    }
}
