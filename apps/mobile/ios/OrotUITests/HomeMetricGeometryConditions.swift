import XCTest

/// Measures production Home after native layout; screenshots retain chart text for visual inspection.
enum HomeMetricGeometryConditions {
    @MainActor
    static func verify(_ app: XCUIApplication, testCase: XCTestCase) {
        let identifiers = [
            "home-health-overview-section", "home-health-overview-heading", "home-metric-grid",
            "home-recent-changes-section", "home-recent-changes-heading", "home-recent-changes-content",
            "home-metric-sleep", "home-metric-heartRate",
        ]
        var frames: [String: CGRect] = [:]
        for identifier in identifiers {
            let element = UITestConditions.element(app, identifier)
            XCTAssertTrue(element.waitForAppearance(), identifier)
            let frame = element.frame
            XCTAssertFalse(frame.isEmpty, identifier)
            frames[identifier] = frame
        }
        guard let overview = frames[identifiers[0]], let overviewHeading = frames[identifiers[1]],
              let grid = frames[identifiers[2]], let recent = frames[identifiers[3]],
              let recentHeading = frames[identifiers[4]], let recentContent = frames[identifiers[5]],
              let first = frames[identifiers[6]], let second = frames[identifiers[7]] else { return }

        let overviewGap = grid.minY - overviewHeading.maxY
        let recentGap = recentContent.minY - recentHeading.maxY
        XCTAssertEqual(overviewGap, 12, accuracy: 1)
        XCTAssertEqual(recentGap, overviewGap, accuracy: 1)
        XCTAssertEqual(recent.minY - overview.maxY, 24, accuracy: 1)
        XCTAssertEqual(recentContent.width, grid.width, accuracy: 1)
        XCTAssertGreaterThanOrEqual(first.minX, grid.minX - 1)
        XCTAssertLessThanOrEqual(first.maxX, grid.maxX + 1)
        XCTAssertGreaterThanOrEqual(second.minX, grid.minX - 1)
        XCTAssertLessThanOrEqual(second.maxX, grid.maxX + 1)

        let largeText = app.launchArguments.contains("UICTContentSizeCategoryAccessibilityXXXL")
        let sameRow = abs(first.minY - second.minY) <= 1
        // These separated native observations test readable outcomes, not the exact JS breakpoint.
        if grid.width <= 500 || largeText {
            XCTAssertFalse(sameRow, "Narrow or accessibility text must keep full-width cards")
            XCTAssertEqual(first.width, grid.width, accuracy: 1)
            XCTAssertEqual(second.width, grid.width, accuracy: 1)
            XCTAssertGreaterThanOrEqual(second.minY - first.maxY, 7)
        } else if grid.width >= 800 {
            XCTAssertTrue(sameRow, "Wide usable content should show two metric columns")
            XCTAssertEqual(first.width, second.width, accuracy: 1)
            XCTAssertEqual(second.minX - first.maxX, 8, accuracy: 1)
        }
        let geometry = frames.mapValues { NSStringFromCGRect($0) }
        if let data = try? JSONSerialization.data(withJSONObject: geometry, options: [.sortedKeys]),
           let json = String(data: data, encoding: .utf8)
        {
            print("OROT_HOME_METRIC_GEOMETRY largeText=\(largeText) sameRow=\(sameRow) frames=\(json)")
            let attachment = XCTAttachment(string: json)
            attachment.name = "home-metric-native-geometry"
            attachment.lifetime = .keepAlways
            testCase.add(attachment)
        }
    }

    @MainActor
    static func captureCard(_ card: XCUIElement, in app: XCUIApplication, testCase: XCTestCase) {
        // Preserve the grouped card's accessibility contract; seven chart dates are inspected in the image.
        XCTAssertFalse(card.label.isEmpty)
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "\(card.identifier)-readability"
        attachment.lifetime = .keepAlways
        testCase.add(attachment)
    }

    /// Retains the existing scene/window rotation diagnostic independently of metric layout assertions.
    @MainActor
    static func logRotation(_ app: XCUIApplication, phase: String, testCase: XCTestCase) {
        let snapshot = NavigationUITestConditions.observationSnapshot(app, testCase: testCase, attachmentName: "home-rotation-\(phase)")
        let geometry = snapshot?["windowGeometry"] as? [String: Any] ?? [:]
        let fields = geometry.filter { ["sceneOrientation", "orientationPolicy", "windowBounds", "sampleStartedAtMs", "sampleEndedAtMs"].contains($0.key) }
        if let data = try? JSONSerialization.data(withJSONObject: fields, options: [.sortedKeys]), let json = String(data: data, encoding: .utf8) {
            print("OROT_HOME_ROTATION_GEOMETRY phase=\(phase) observedAtMs=\(Date().timeIntervalSince1970 * 1000) geometry=\(json)")
        }
    }
}
