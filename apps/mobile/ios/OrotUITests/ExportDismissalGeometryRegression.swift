import XCTest

/// Run pure geometry regressions inside the existing Export case, so focused and full selections retain these checks.
enum ExportDismissalGeometryRegression {
    private static let observer = "00000000-0000-4000-8000-000000000001"
    private static let window = CGRect(x: 0, y: 0, width: 375, height: 667)
    private static let safe = CGRect(x: 0, y: 20, width: 375, height: 647)

    static func verify() throws {
        // Expanded geometry is the hosted failure's public frame; the smaller detent represents the local path.
        let expanded = CGRect(x: 0, y: 98, width: 375, height: 560)
        let small = CGRect(x: 9, y: 304, width: 357, height: 354.5)
        let oldPoint = CGPoint(x: 187.5, y: 133.4)
        XCTAssertTrue(expanded.contains(oldPoint))
        XCTAssertFalse(small.contains(oldPoint))
        let baseline = try snapshot(sheet: small)
        let session = try ExportDismissalGeometry.session(snapshot: baseline, nowMs: 10000)
        for sheet in [small, expanded] {
            let text = try snapshot(sheet: sheet)
            let point = try ExportDismissalGeometry.point(snapshot: text, session: session, applicationFrame: window, nowMs: 10000)
            let hit = CGRect(x: point.dx - 22, y: point.dy - 22, width: 44, height: 44)
            XCTAssertTrue(safe.contains(hit))
            XCTAssertFalse(sheet.intersects(hit))
            XCTAssertEqual(point.dx, 187.5, accuracy: 0.01)
            XCTAssertEqual(point.dy, sheet == expanded ? 59 : 162, accuracy: 0.01)
        }
        // No fixed coordinate is substituted when the safe backdrop is missing or narrower than a touch target.
        for sheet in [window, CGRect(x: 0, y: 50, width: 375, height: 617)] {
            try rejects(snapshot(sheet: sheet), session: session, expected: .noBackdrop)
        }
        try rejects(baseline, session: session, nowMs: 10801, expected: .stale)
        try rejects(baseline, session: session, nowMs: 9799, expected: .stale)
        try rejects(snapshot(sheet: small, observerID: "00000000-0000-4000-8000-000000000002"), session: session, expected: .session)
        try rejects(snapshot(sheet: small, atMs: 9799), session: session, expected: .session)
        try rejects(snapshot(sheet: small, beingPresented: true), session: session, expected: .unready)
        try rejects(snapshot(sheet: small, count: 2), session: session, expected: .unready)
        try rejects(snapshot(sheet: small, safeArea: CGRect(x: 0, y: -10, width: 375, height: 677)), session: session, expected: .geometry)
        try rejects("{}", session: session, expected: .malformed)
        XCTAssertThrowsError(try ExportDismissalGeometry.point(snapshot: baseline, session: session,
                                                               applicationFrame: window.offsetBy(dx: 1, dy: 0), nowMs: 10000))
        { error in
            XCTAssertEqual(error as? ExportDismissalGeometry.Failure, .geometry)
        }
    }

    private static func rejects(_ text: String, session: ExportDismissalGeometry.Session, nowMs: Double = 10000,
                                expected: ExportDismissalGeometry.Failure) throws
    {
        XCTAssertThrowsError(try ExportDismissalGeometry.point(snapshot: text, session: session,
                                                               applicationFrame: window, nowMs: nowMs))
        { error in
            XCTAssertEqual(error as? ExportDismissalGeometry.Failure, expected)
        }
    }

    private static func snapshot(sheet: CGRect, atMs: Double = 9800, observerID: String = observer,
                                 safeArea: CGRect = safe, beingPresented: Bool = false, count: Int = 1) throws -> String
    {
        let presentation: [String: Any] = [
            "controllerID": "activity-1", "hasPresenter": true, "beingPresented": beingPresented, "beingDismissed": false,
            "windowBounds": rect(window), "windowSafeArea": rect(safeArea),
            "presentedViewInWindow": rect(sheet), "containerInWindow": rect(window),
        ]
        let data = try JSONSerialization.data(withJSONObject: [
            "observerID": observerID, "atMs": atMs, "presentations": Array(repeating: presentation, count: count),
        ])
        return String(decoding: data, as: UTF8.self)
    }

    private static func rect(_ frame: CGRect) -> [String: CGFloat] {
        ["x": frame.minX, "y": frame.minY, "width": frame.width, "height": frame.height]
    }
}
