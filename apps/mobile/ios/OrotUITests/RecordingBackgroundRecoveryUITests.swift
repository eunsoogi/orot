import XCTest

/// Covers an actual app background transition with disposable audio, separately from audio-session interruptions.
@MainActor
final class RecordingBackgroundRecoveryUITests: OrotFailFastTestCase {
    func testSavedAudioReopensAfterBackgroundAndRelaunch() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        RecordingFixtureUITestConditions.launch(app, playback: "seed")
        defer { app.terminate() }
        let row = try RecordingFixtureUITestConditions.select(app, testCase: self)
        let identifier = row.identifier
        row.tap()
        let play = RecordingFixtureUITestConditions.reveal(app, "recording-playback-button")
        XCTAssertTrue(play.isHittable)
        play.tap()
        try waitForPlayback(app, phase: "requested")

        // Home exercises UIKit lifecycle; it does not manufacture an audio interruption notification.
        XCUIDevice.shared.press(.home)
        let background = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            app.state == .runningBackground || app.state == .runningBackgroundSuspended
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [background]), .completed)
        app.terminate()
        RecordingFixtureUITestConditions.launch(app, playback: "resume")
        let restored = app.buttons.matching(identifier: identifier).firstMatch
        FormUITestConditions.reveal(restored, in: app, scrollID: "recording-controls-scroll")
        XCTAssertTrue(restored.exists && restored.isHittable)
        restored.tap()
        let restoredPlay = RecordingFixtureUITestConditions.reveal(app, "recording-playback-button")
        XCTAssertTrue(restoredPlay.isHittable)
        restoredPlay.tap()
        try waitForPlayback(app, phase: "completed")
    }

    private func waitForPlayback(_ app: XCUIApplication, phase: String) throws {
        let target = UITestConditions.element(app, "recording-playback-observation")
        var receipt: [String: Any] = [:]
        let observed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            guard let snapshot = try? target.snapshot(),
                  let data = snapshot.label.data(using: .utf8),
                  let value = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            else { return false }
            receipt = value
            if value["phase"] as? String == "failed" {
                return true
            }
            if phase == "requested" {
                return value["phase"] as? String == phase && (value["maximumPositionMs"] as? Double ?? 0) >= 1000
            }
            return value["phase"] as? String == phase
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [observed]), .completed)
        XCTAssertEqual(receipt["phase"] as? String, phase)
        XCTAssertEqual(receipt["nativePlaying"] as? Bool, true)
        if phase == "completed" {
            let range = try XCTUnwrap(receipt["range"] as? [String: Any])
            XCTAssertEqual(range["completion"] as? String, "completed")
            XCTAssertGreaterThan(range["actualEndMs"] as? Int ?? 0, 0)
            XCTAssertEqual(range["actualEndMs"] as? Int, range["endMs"] as? Int)
        }
    }
}
