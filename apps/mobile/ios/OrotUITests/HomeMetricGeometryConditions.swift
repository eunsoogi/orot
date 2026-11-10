import XCTest

/// Measures production Home after native layout; screenshots retain chart text for visual inspection.
enum HomeMetricGeometryConditions {
    @MainActor
    static func verify(_ app: XCUIApplication, testCase: XCTestCase) {
        let identifiers = [
            "home-health-overview-section", "home-health-overview-heading", "home-metric-grid",
            "home-recent-changes-section", "home-recent-changes-heading", "home-recent-changes-content",
            "home-metric-sleep", "home-metric-heartRate",
            "home-metric-chart-sleep", "home-metric-chart-heartRate",
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
              let first = frames[identifiers[6]], let second = frames[identifiers[7]],
              let firstChart = frames[identifiers[8]], let secondChart = frames[identifiers[9]] else { return }

        // The merged chart facade must keep its measured plots inside the visible metric cards.
        for (chart, card, identifier) in [
            (firstChart, first, "sleep"), (secondChart, second, "heartRate"),
        ] {
            XCTAssertGreaterThan(chart.width, 0, "\(identifier) chart width")
            XCTAssertGreaterThan(chart.height, 0, "\(identifier) chart height")
            XCTAssertGreaterThanOrEqual(chart.minX, card.minX - 1, "\(identifier) chart left edge")
            XCTAssertLessThanOrEqual(chart.maxX, card.maxX + 1, "\(identifier) chart right edge")
            XCTAssertGreaterThanOrEqual(chart.minY, card.minY - 1, "\(identifier) chart top edge")
            XCTAssertLessThanOrEqual(chart.maxY, card.maxY + 1, "\(identifier) chart bottom edge")
        }

        let largeText = app.launchArguments.contains("UICTContentSizeCategoryAccessibilityXXXL")
        // UIKit frame conversion can report nominal layout targets a few floating-point ULPs below their boundary.
        let geometryTolerance: CGFloat = 0.001
        XCTAssertGreaterThanOrEqual(overviewHeading.height, 44 - geometryTolerance, "Health overview heading target")
        XCTAssertGreaterThanOrEqual(recentHeading.height, 44 - geometryTolerance, "Recent changes heading target")
        // At the default text size, matching section headings should occupy the same 44pt target.
        if !largeText {
            XCTAssertEqual(overviewHeading.height, recentHeading.height, accuracy: 1)
        }
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

        let sameRow = abs(first.minY - second.minY) <= 1
        // Two 320pt cards plus their 8pt gap need 648pt at default text size.
        let shouldUseTwoColumns = !largeText && grid.width >= 648 - geometryTolerance
        if shouldUseTwoColumns {
            XCTAssertTrue(sameRow, "Wide usable content should show two metric columns")
            XCTAssertEqual(first.width, second.width, accuracy: 1)
            XCTAssertGreaterThanOrEqual(first.width, 320 - geometryTolerance)
            XCTAssertGreaterThanOrEqual(second.width, 320 - geometryTolerance)
            XCTAssertEqual(second.minX - first.maxX, 8, accuracy: 1)
        } else {
            XCTAssertFalse(sameRow, "Narrow or accessibility text must keep full-width cards")
            XCTAssertEqual(first.width, grid.width, accuracy: 1)
            XCTAssertEqual(second.width, grid.width, accuracy: 1)
            XCTAssertGreaterThanOrEqual(second.minY - first.maxY, 7)
        }
        // Keep measured frames readable in the result attachment when a native threshold fails.
        let geometry = frames.mapValues { NSCoder.string(for: $0) }
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
        // The summary stays grouped while each dated chart row remains individually discoverable.
        let metric = String(card.identifier.dropFirst("home-metric-".count))
        let summary = UITestConditions.element(app, "home-metric-summary-\(metric)")
        XCTAssertFalse(summary.label.isEmpty)
        let chart = UITestConditions.element(app, "home-metric-chart-\(metric)")
        let labels = Set(chart.staticTexts.allElementsBoundByIndex.map(\.label))
        let entries = labels.filter { $0.range(of: #"^\d{4}-\d{2}-\d{2}: "#, options: .regularExpression) != nil }
        XCTAssertEqual(entries.count, 7, chart.debugDescription)
        let values = entries.compactMap { $0.components(separatedBy: ": ").dropFirst().first }
        XCTAssertEqual(values.count, 7, chart.debugDescription)
        XCTAssertTrue(
            values.contains { $0.range(of: #"^\d+"#, options: .regularExpression) != nil },
            "At least one daily row must expose its recorded value through native accessibility.",
        )
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
