import UIKit

/// Publishes only the docked keyboard overlapping this exact key window. Frame
/// notifications keep their normal timing; a local guide recovers missed opens.
@MainActor
final class NavigationDockedKeyboard: NSObject {
    private enum Evidence {
        case unknown, hidden, screen(CGRect)
    }

    private weak var window: UIWindow?
    private var evidence = Evidence.unknown
    private var probe: LayoutProbe?
    private var generation = 0
    private let guideFrame: @MainActor (UIView, UIWindow) -> CGRect
    var changed: (() -> Void)?

    init(guideFrame: @escaping @MainActor (UIView, UIWindow) -> CGRect = { root, window in
        root.convert(root.keyboardLayoutGuide.layoutFrame, to: window)
    }) {
        self.guideFrame = guideFrame
        super.init()
        let center = NotificationCenter.default
        for name in [UIResponder.keyboardWillChangeFrameNotification, UIResponder.keyboardDidChangeFrameNotification, UIResponder.keyboardWillHideNotification] {
            center.addObserver(self, selector: #selector(keyboardChanged), name: name, object: nil)
        }
        for name in [UIWindow.didBecomeKeyNotification, UIWindow.didResignKeyNotification] {
            center.addObserver(self, selector: #selector(keyStatusChanged), name: name, object: nil)
        }
    }

    deinit { NotificationCenter.default.removeObserver(self) }

    func attach(to next: UIWindow?) {
        guard window !== next else { return }
        generation += 1
        probe?.removeFromSuperview()
        probe = nil
        evidence = .unknown
        window = next
        installProbe()
        let lease = generation
        DispatchQueue.main.async { [weak self] in
            // A root can finish attaching after the sensor enters the window.
            guard let self, generation == lease else { return }
            installProbe()
            changed?()
        }
    }

    /// A zero-width, noninteractive child observes guide-only layout changes when
    /// the React viewport doesn't resize (for example, an already open sheet keyboard).
    private func installProbe() {
        guard probe == nil, let window, window.isKeyWindow, let root = fullRoot(in: window) else { return }
        let marker = LayoutProbe(frame: .zero)
        let lease = generation
        marker.changed = { [weak self, weak marker] in
            guard let self, let marker, probe === marker, generation == lease,
                  marker.window === self.window
            else { return }
            changed?()
        }
        marker.translatesAutoresizingMaskIntoConstraints = false
        marker.isUserInteractionEnabled = false
        marker.accessibilityElementsHidden = true
        root.addSubview(marker)
        NSLayoutConstraint.activate([
            marker.topAnchor.constraint(equalTo: root.keyboardLayoutGuide.topAnchor),
            marker.bottomAnchor.constraint(equalTo: root.bottomAnchor),
            marker.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            marker.widthAnchor.constraint(equalToConstant: 0),
        ])
        probe = marker
    }

    @objc private func keyStatusChanged(_ note: Notification) {
        guard let window, note.object as? UIWindow === window else { return }
        evidence = .unknown
        generation += 1
        probe?.removeFromSuperview()
        probe = nil
        installProbe()
        changed?()
    }

    @objc private func keyboardChanged(_ note: Notification) {
        guard let window, window.isKeyWindow, let screen = window.windowScene?.screen,
              (note.object as? UIScreen).map({ $0 === screen }) ?? true,
              (note.userInfo?[UIResponder.keyboardIsLocalUserInfoKey] as? Bool) != false
        else { return }
        if note.name == UIResponder.keyboardWillHideNotification {
            // UIKit's guide may still contain the old keyboard until dismissal lays out.
            evidence = .hidden
        } else {
            guard let value = note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue else { return }
            evidence = .screen(value.cgRectValue)
        }
        changed?()
    }

    func frame(in expected: UIWindow) -> CGRect? {
        guard expected === window, expected.isKeyWindow else { return nil }
        switch evidence {
        case .hidden:
            return nil
        case let .screen(screenFrame):
            guard let screen = expected.windowScene?.screen else { return nil }
            let frame = expected.convert(screenFrame, from: screen.coordinateSpace)
            return Self.overlap(frame, in: expected.bounds)
        case .unknown:
            guard let root = fullRoot(in: expected), !root.keyboardLayoutGuide.followsUndockedKeyboard else { return nil }
            // UIKit reports just the home-indicator safe area when undocked or hidden.
            let frame = guideFrame(root, expected)
            guard frame.height > root.safeAreaInsets.bottom + 1 else { return nil }
            return Self.overlap(frame, in: expected.bounds)
        }
    }

    private func fullRoot(in window: UIWindow) -> UIView? {
        guard let root = window.rootViewController?.viewIfLoaded, root.window === window,
              root.convert(root.bounds, to: window).equalTo(window.bounds)
        else { return nil }
        return root
    }

    static func overlap(_ frame: CGRect, in windowBounds: CGRect) -> CGRect? {
        guard [frame.minX, frame.minY, frame.width, frame.height].allSatisfy(\.isFinite),
              frame.maxY + 1 >= windowBounds.maxY, frame.minY > windowBounds.minY
        else { return nil }
        let result = frame.intersection(windowBounds)
        return result.isEmpty ? nil : result
    }

    private final class LayoutProbe: UIView {
        var changed: (() -> Void)?
        private var scheduled = false

        override func layoutSubviews() {
            super.layoutSubviews()
            guard !scheduled else { return }
            scheduled = true
            // Publish after the guide and viewport are laid out; never update React during UIKit layout.
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                scheduled = false
                changed?()
            }
        }
    }
}
