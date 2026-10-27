import XCTest

extension RootNavigationUITests {
    /// Keeps the iCloud recovery panel inside measured Duo regions without starting backup or restore work.
    @MainActor
    func testBackupRecoveryReflowsWithinMeasuredDuoRegionsAndRemainsReachable() throws {
        let app = launch([
            "-OROT_TEST_UI_GEOMETRY", "YES",
            "-OROT_TEST_NAVIGATION_OBSERVATION", "YES",
        ] + AppearanceUITestConditions.observationArguments)
        var appearanceSnapshot: AppearanceUITestConditions.Snapshot?
        defer {
            if let appearanceSnapshot, app.state == .runningForeground {
                do {
                    try AppearanceUITestConditions.restore(
                        appearanceSnapshot,
                        returningTo: app,
                        testCase: self,
                    )
                } catch {
                    XCTFail("Could not restore the original system appearance: \(error)")
                }
            }
            app.terminate()
            XCUIDevice.shared.orientation = .portrait
        }

        try openBackupSettings(app)
        let regularTitleHeight = UITestConditions.element(app, "settings-backup-title").frame.height
        assertRecoveryState(app)
        try assertBackupLayout(app)
        capture(app, "settings-backup-duo-light")

        appearanceSnapshot = try AppearanceUITestConditions.select(
            true,
            returningTo: app,
            testCase: self,
        )
        try assertBackupLayout(app)
        capture(app, "settings-backup-duo-dark")

        let beforeRotation = try waitForMeasuredGeometry(app)
        XCUIDevice.shared.orientation = .landscapeLeft
        let landscapeGeometry = try waitForMeasuredGeometry(
            app,
            widthDifferentFrom: beforeRotation.windowWidth,
        )
        try assertBackupLayout(app)
        assertRecoveryState(app)
        capture(app, "settings-backup-duo-landscape")
        XCUIDevice.shared.orientation = .portrait
        _ = try waitForMeasuredGeometry(
            app,
            widthDifferentFrom: landscapeGeometry.windowWidth,
        )

        if let snapshot = appearanceSnapshot {
            try AppearanceUITestConditions.restore(
                snapshot,
                returningTo: app,
                testCase: self,
            )
            appearanceSnapshot = nil
        }
        try backToSettings(app)
        app.terminate()

        let largeTextApp = launch([
            "-OROT_TEST_UI_GEOMETRY", "YES",
            "-OROT_TEST_NAVIGATION_OBSERVATION", "YES",
            "-UIPreferredContentSizeCategoryName",
            "UICTContentSizeCategoryAccessibilityXXXL",
        ])
        defer { largeTextApp.terminate() }
        try openBackupSettings(largeTextApp)
        let largeTitle = UITestConditions.element(largeTextApp, "settings-backup-title")
        XCTAssertGreaterThan(largeTitle.frame.height, regularTitleHeight)
        assertRecoveryState(largeTextApp)
        try assertBackupLayout(largeTextApp, expectsStacked: true)
        capture(largeTextApp, "settings-backup-duo-xxxl")
        let recoveryAction = UITestConditions.element(largeTextApp, "backup-open-system-settings")
        XCTAssertTrue(recoveryAction.exists && recoveryAction.isHittable)
    }

    @MainActor
    private func openBackupSettings(_ app: XCUIApplication) throws {
        try NavigationUITestConditions.openTab(app, "settings", markers: ["settings-title"])
        tap(app, "settings-open-backup")
        NavigationUITestConditions.route(app, markers: ["settings-backup-title"])
    }

    @MainActor
    private func assertRecoveryState(_ app: XCUIApplication) {
        let preparation = UITestConditions.element(app, "backup-status-message")
        let recovery = UITestConditions.element(app, "settings-backup-recovery-state")
        let recoveryAction = UITestConditions.element(app, "backup-open-system-settings")
        XCTAssertTrue(preparation.exists && !UITestConditions.text(preparation).isEmpty)
        XCTAssertTrue(recovery.exists && !UITestConditions.text(recovery).isEmpty)
        // Inspect the iOS-owned settings handoff without opening it or invoking backup/restore.
        XCTAssertTrue(recoveryAction.exists)
    }

    @MainActor
    private func assertBackupLayout(
        _ app: XCUIApplication,
        expectsStacked: Bool = false,
    ) throws {
        let primary = UITestConditions.element(app, "settings-backup-layout-primary")
        let secondary = UITestConditions.element(app, "settings-backup-layout-secondary")
        XCTAssertTrue(primary.exists && secondary.exists)
        let primaryFrame = primary.frame
        let secondaryFrame = secondary.frame
        let sideBySide = abs(primaryFrame.minY - secondaryFrame.minY) <= 1 &&
            primaryFrame.maxX <= secondaryFrame.minX + 1
        let stacked = abs(primaryFrame.minX - secondaryFrame.minX) <= 1 &&
            primaryFrame.maxY <= secondaryFrame.minY + 1
        XCTAssertTrue(sideBySide || stacked, "Backup panels must reflow without overlap")
        if expectsStacked {
            XCTAssertTrue(stacked, "Accessibility XXXL text needs one readable backup column")
        }

        let geometry = try waitForMeasuredGeometry(app)
        for panelFrame in [primaryFrame, secondaryFrame] {
            let fitsAUsableRegion = geometry.usableRegions.contains { region in
                panelFrame.minX >= region.minX - 1 &&
                    panelFrame.maxX <= region.maxX + 1 &&
                    panelFrame.minY < region.maxY && panelFrame.maxY > region.minY
            }
            XCTAssertTrue(fitsAUsableRegion, "Backup panel must stay inside a measured usable region: \(panelFrame)")
        }

        let back = try NavigationUITestConditions.navigationAction(app, "navigation-back")
        let recoveryAction = UITestConditions.element(app, "backup-open-system-settings")
        _ = FormUITestConditions.reveal(recoveryAction, in: app, scrollID: "settings-backup-scroll")
        XCTAssertTrue(recoveryAction.exists && recoveryAction.isHittable)
        XCTAssertGreaterThanOrEqual(recoveryAction.frame.height, 44)
        let actionFrame = recoveryAction.frame
        let actionFitsAUsableRegion = geometry.usableRegions.contains { region in
            actionFrame.minX >= region.minX - 1 &&
                actionFrame.maxX <= region.maxX + 1 &&
                actionFrame.minY < region.maxY && actionFrame.maxY > region.minY
        }
        XCTAssertTrue(actionFitsAUsableRegion, "System Settings action must stay in a measured usable region")
        if back.toolbar.frame.height > back.toolbar.frame.width {
            XCTAssertLessThanOrEqual(
                max(primary.frame.maxX, secondary.frame.maxX),
                back.toolbar.frame.minX + 1,
                "Backup content must not enter the contextual navigation lane",
            )
            XCTAssertLessThanOrEqual(
                actionFrame.maxX,
                back.toolbar.frame.minX + 1,
                "System Settings action must not enter the contextual navigation lane",
            )
        }
    }

    @MainActor
    private func waitForMeasuredGeometry(
        _ app: XCUIApplication,
        widthDifferentFrom previousWidth: Double? = nil,
    ) throws -> BackupDuoGeometry {
        var observed: BackupDuoGeometry?
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            observed = Self.readMeasuredGeometry(app)
            guard let observed else { return false }
            return previousWidth.map { abs(observed.windowWidth - $0) > 0.5 } ?? true
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [ready]), .completed, app.debugDescription)
        return try XCTUnwrap(observed)
    }

    @MainActor
    private static func readMeasuredGeometry(_ app: XCUIApplication) -> BackupDuoGeometry? {
        let marker = UITestConditions.element(app, "navigation-test-observation")
        guard marker.exists,
              let observation = try? JSONSerialization.jsonObject(
                    with: Data(UITestConditions.text(marker).utf8),
              ) as? [String: Any],
              let lifecycle = observation["lifecycle"] as? [[String: Any]],
              let context = lifecycle.last(where: { $0["event"] as? String == "window-geometry-context" }),
              let snapshotJSON = context["normalizedSnapshot"] as? String,
              let data = snapshotJSON.data(using: .utf8),
              let snapshot = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let bounds = snapshot["windowBounds"] as? [String: Double],
              let width = bounds["width"],
              let values = snapshot["usableRegions"] as? [[String: Double]]
        else {
            return nil
        }
        let regions = values.compactMap { value -> CGRect? in
            guard let x = value["x"], let y = value["y"],
                  let width = value["width"], let height = value["height"],
                  width > 0, height > 0
            else { return nil }
            return CGRect(x: x, y: y, width: width, height: height)
        }
        guard !regions.isEmpty else { return nil }
        return BackupDuoGeometry(windowWidth: width, usableRegions: regions)
    }
}

private struct BackupDuoGeometry {
    let windowWidth: Double
    let usableRegions: [CGRect]
}
