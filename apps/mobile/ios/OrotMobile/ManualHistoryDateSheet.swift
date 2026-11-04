import React
import UIKit

/// Presents a date-only draft from the window containing the React control.
final class ManualHistoryDateSheetAnchor: UIView {
    @objc var onResult: RCTDirectEventBlock?
    @objc var request: NSDictionary = [:] {
        didSet {
            guard let identifier = request["id"] as? Int, identifier > lastRequest else { return }
            lastRequest = identifier
            presentSheet(value: request["date"] as? String ?? "")
        }
    }

    private var lastRequest = 0
    private var sheet: ManualHistoryDateSheetController?

    private func presentSheet(value: String) {
        guard sheet == nil, let anchor = WindowPresentationAnchor.resolve(from: self) else {
            onResult?(["error": "unavailable"])
            return
        }
        guard let initial = ManualHistorySheetDate.initial(value) ?? ManualHistorySheetDate.initial("") else {
            onResult?(["error": "unavailable"])
            return
        }
        let preservesOriginal = !value.isEmpty && ManualHistorySheetDate.initial(value) == nil
        // Dismiss the keyboard before UIKit lays out the modal; no underlying input remains active.
        anchor.window.endEditing(true)
        let controller = ManualHistoryDateSheetController(
            initial: initial, hasOriginal: !value.isEmpty, showsOriginalNotice: preservesOriginal,
        ) { [weak self] date in
            self?.sheet = nil
            self?.onResult?(date.map { ["date": $0] } ?? [:])
        }
        sheet = controller
        anchor.present(controller) { [weak self, weak controller] presented in
            guard !presented else { return }
            controller?.dismiss(animated: false)
            self?.sheet = nil
            self?.onResult?(["error": "unavailable"])
        }
    }
}

@objc(ManualHistoryDateSheetAnchorManager)
final class ManualHistoryDateSheetAnchorManager: RCTViewManager {
    override static func requiresMainQueueSetup() -> Bool {
        true
    }

    override func view() -> UIView! {
        ManualHistoryDateSheetAnchor()
    }
}

/// The system owns calendar drawing, drag dismissal, adaptation and background dimming.
final class ManualHistoryDateSheetController: UIViewController, UIAdaptivePresentationControllerDelegate {
    private let picker = UIDatePicker()
    private let initial: Date
    private let hasOriginal: Bool
    private let showsOriginalNotice: Bool
    private var changed = false
    private var finish: ((String?) -> Void)?

    init(initial: Date, hasOriginal: Bool, showsOriginalNotice: Bool, finish: @escaping (String?) -> Void) {
        self.initial = initial
        self.hasOriginal = hasOriginal
        self.showsOriginalNotice = showsOriginalNotice
        self.finish = finish
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .pageSheet
        if let sheet = sheetPresentationController {
            sheet.detents = [.large()]
            sheet.prefersGrabberVisible = true
            sheet.delegate = self
        }
    }

    required init?(coder _: NSCoder) {
        nil
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        picker.datePickerMode = .date
        picker.preferredDatePickerStyle = .inline
        picker.calendar = ManualHistorySheetDate.calendar
        picker.timeZone = ManualHistorySheetDate.calendar.timeZone
        picker.minimumDate = ManualHistorySheetDate.minimum
        picker.maximumDate = ManualHistorySheetDate.maximum
        picker.date = initial
        picker.addTarget(self, action: #selector(dateChanged), for: .valueChanged)
        picker.accessibilityIdentifier = "manual-history-native-date-picker"

        let cancel = UIBarButtonItem(title: "취소", style: .plain, target: self, action: #selector(cancelled))
        cancel.accessibilityIdentifier = "manual-history-date-cancel"
        let done = UIBarButtonItem(title: "완료", style: .done, target: self, action: #selector(done))
        done.accessibilityIdentifier = "manual-history-date-done"
        let navigation = UINavigationBar()
        let item = UINavigationItem(title: "기준일")
        item.leftBarButtonItem = cancel
        item.rightBarButtonItem = done
        navigation.items = [item]
        let scroll = UIScrollView()
        scroll.alwaysBounceVertical = true
        let notice = UILabel()
        notice.text = "기존 날짜는 유지돼요. 변경하려면 달력에서 새 날짜를 선택해 주세요."
        notice.numberOfLines = 0
        notice.font = .preferredFont(forTextStyle: .footnote)
        notice.adjustsFontForContentSizeCategory = true
        notice.isHidden = !showsOriginalNotice
        let stack = UIStackView(arrangedSubviews: [navigation, notice, scroll])
        stack.axis = .vertical
        stack.translatesAutoresizingMaskIntoConstraints = false
        picker.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        scroll.addSubview(picker)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
            stack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            stack.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
            picker.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 12),
            picker.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -12),
            picker.centerXAnchor.constraint(equalTo: scroll.frameLayoutGuide.centerXAnchor),
            picker.leadingAnchor.constraint(greaterThanOrEqualTo: scroll.contentLayoutGuide.leadingAnchor),
            picker.trailingAnchor.constraint(lessThanOrEqualTo: scroll.contentLayoutGuide.trailingAnchor),
            scroll.contentLayoutGuide.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor),
        ])
    }

    @objc private func cancelled() {
        dismissAndFinish(nil)
    }

    @objc private func dateChanged() {
        changed = true
    }

    @objc private func done() {
        switch ManualHistorySheetDate.decision(hasOriginal: hasOriginal, changed: changed, selected: picker.date) {
        case .keep:
            dismissAndFinish(nil)
        case .invalid:
            let alert = UIAlertController(title: "선택할 수 없는 날짜예요", message: "다른 날짜를 선택해 주세요.", preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "확인", style: .default))
            present(alert, animated: true)
        case let .commit(value):
            dismissAndFinish(value)
        }
    }

    private func dismissAndFinish(_ value: String?) {
        dismiss(animated: true) { [weak self] in self?.complete(value) }
    }

    func presentationControllerDidDismiss(_: UIPresentationController) {
        complete(nil)
    }

    private func complete(_ value: String?) {
        let callback = finish
        finish = nil
        callback?(value)
    }
}
