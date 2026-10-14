import CoreGraphics
import Foundation

/// Select a real backdrop touch from one current public UIKit snapshot. This does not dismiss the sheet itself.
enum ExportDismissalGeometry {
    struct Session {
        let observerID: String
        let atMs: Double
    }

    enum Failure: String, Error, LocalizedError {
        case malformed = "Export presentation snapshot is missing or malformed."
        case stale = "Export presentation snapshot is stale or from the future."
        case session = "Export presentation snapshot belongs to another launch or predates the export baseline."
        case unready = "Expected one stationary, presented activity controller."
        case geometry = "Public presentation, window and application geometry do not agree."
        case noBackdrop = "No safe 44-point backdrop touch region exists."

        var errorDescription: String? {
            rawValue
        }
    }

    private struct Rect: Decodable {
        let x, y, width, height: Double
        var value: CGRect {
            CGRect(x: x, y: y, width: width, height: height)
        }
    }

    private struct Presentation: Decodable {
        let controllerID: String
        let hasPresenter, beingPresented, beingDismissed: Bool
        let windowBounds, windowSafeArea, presentedViewInWindow, containerInWindow: Rect
    }

    private struct Snapshot: Decodable {
        let observerID: String
        let atMs: Double
        let presentations: [Presentation]
    }

    // The bridge samples every 200 ms. Reject samples older than five intervals without adding a wait or retry.
    static let maximumAgeMs: Double = 1000
    static let minimumTouchSide: CGFloat = 44
    private static let clearance: CGFloat = 2

    /// Bind before opening audio export, after the existing process restart, to reject another launch's marker.
    static func session(snapshot text: String, nowMs: Double) throws -> Session {
        let snapshot = try decode(text)
        try fresh(snapshot, nowMs: nowMs)
        return Session(observerID: snapshot.observerID, atMs: snapshot.atMs)
    }

    static func point(snapshot text: String, session: Session, applicationFrame: CGRect, nowMs: Double) throws -> CGVector {
        let snapshot = try decode(text)
        guard snapshot.observerID == session.observerID, snapshot.atMs >= session.atMs else { throw Failure.session }
        try fresh(snapshot, nowMs: nowMs)
        guard snapshot.presentations.count == 1, let presentation = snapshot.presentations.first,
              presentation.controllerID.hasPrefix("activity-"), presentation.hasPresenter,
              !presentation.beingPresented, !presentation.beingDismissed else { throw Failure.unready }
        let window = presentation.windowBounds.value
        let safeArea = presentation.windowSafeArea.value
        let sheet = presentation.presentedViewInWindow.value
        let container = presentation.containerInWindow.value
        // These observations are in window points. Fail instead of assuming a mapping for another window/orientation.
        guard [window, safeArea, sheet, container, applicationFrame].allSatisfy(valid),
              agrees(window, applicationFrame), agrees(window, container),
              window.contains(safeArea), window.contains(sheet) else { throw Failure.geometry }
        let safe = safeArea.insetBy(dx: clearance, dy: clearance)
        let blocked = sheet.insetBy(dx: -clearance, dy: -clearance)
        guard valid(safe) else { throw Failure.noBackdrop }
        // Whole-screen AX dismissal frames include the sheet. Use four disjoint public-geometry corridors instead.
        let corridors = [
            CGRect(x: safe.minX, y: safe.minY, width: safe.width, height: min(safe.maxY, blocked.minY) - safe.minY),
            CGRect(x: safe.minX, y: max(safe.minY, blocked.maxY), width: safe.width, height: safe.maxY - max(safe.minY, blocked.maxY)),
            CGRect(x: safe.minX, y: safe.minY, width: min(safe.maxX, blocked.minX) - safe.minX, height: safe.height),
            CGRect(x: max(safe.minX, blocked.maxX), y: safe.minY, width: safe.maxX - max(safe.minX, blocked.maxX), height: safe.height),
        ]
        guard let region = corridors.filter({ valid($0) && $0.width >= minimumTouchSide && $0.height >= minimumTouchSide })
            .max(by: { $0.width * $0.height < $1.width * $1.height }) else { throw Failure.noBackdrop }
        let hit = CGRect(x: region.midX - minimumTouchSide / 2, y: region.midY - minimumTouchSide / 2,
                         width: minimumTouchSide, height: minimumTouchSide)
        guard safe.contains(hit), !blocked.intersects(hit) else { throw Failure.noBackdrop }
        // UIKit/XCTest can advance after this sample. The original cancellation/cleanup assertions still prove the result.
        return CGVector(dx: region.midX - applicationFrame.minX, dy: region.midY - applicationFrame.minY)
    }

    private static func decode(_ text: String) throws -> Snapshot {
        guard let snapshot = try? JSONDecoder().decode(Snapshot.self, from: Data(text.utf8)),
              UUID(uuidString: snapshot.observerID) != nil else { throw Failure.malformed }
        return snapshot
    }

    private static func fresh(_ snapshot: Snapshot, nowMs: Double) throws {
        guard nowMs.isFinite, snapshot.atMs.isFinite, nowMs >= snapshot.atMs,
              nowMs - snapshot.atMs <= maximumAgeMs else { throw Failure.stale }
    }

    private static func valid(_ rect: CGRect) -> Bool {
        [rect.origin.x, rect.origin.y, rect.size.width, rect.size.height].allSatisfy(\.isFinite)
            && rect.size.width > 0 && rect.size.height > 0
    }

    private static func agrees(_ lhs: CGRect, _ rhs: CGRect) -> Bool {
        abs(lhs.minX - rhs.minX) < 0.5 && abs(lhs.minY - rhs.minY) < 0.5
            && abs(lhs.width - rhs.width) < 0.5 && abs(lhs.height - rhs.height) < 0.5
    }
}
