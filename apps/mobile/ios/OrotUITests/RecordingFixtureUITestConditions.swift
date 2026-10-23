import XCTest

@MainActor
enum RecordingFixtureUITestConditions {
    /// Select only the disposable synthetic source; the verified host removes this independent case's app container after success or failure.
    static func select(_ app: XCUIApplication, testCase: XCTestCase) throws -> XCUIElement {
        let row = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Synthetic transcription test recording")).firstMatch
        FormUITestConditions.reveal(row, in: app, scrollID: "recording-controls-scroll")
        let prefix = "recording-details-"
        XCTAssertTrue(row.identifier.hasPrefix(prefix), row.debugDescription)
        let source = String(row.identifier.dropFirst(prefix.count))
        XCTAssertNotNil(UUID(uuidString: source))
        testCase.addTeardownBlock { @MainActor in
            app.terminate()
        }
        return row
    }

    static func launch(_ app: XCUIApplication, playback: String? = nil, extra: [String] = []) {
        app.launchArguments = ["-OROT_TEST_PROFILE", "speech", "-OROT_TRANSCRIPTION_PROBE_MODE", "recording-library-visual", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"] + extra
        if let playback {
            app.launchArguments += ["-OROT_RECORDING_PLAYBACK_PROBE", playback]
        }
        app.launch()
    }

    static func reveal(_ app: XCUIApplication, _ identifier: String, towardTop: Bool = false, maximumScrollFraction: CGFloat = 0.45) -> XCUIElement {
        let target = UITestConditions.element(app, identifier)
        FormUITestConditions.reveal(target, in: app, scrollID: "recording-controls-scroll", towardTop: towardTop, maximumScrollFraction: maximumScrollFraction)
        return target
    }

    static func capture(_ app: XCUIApplication, _ name: String, testCase: XCTestCase) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        testCase.add(attachment)
    }
}
