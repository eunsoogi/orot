# Opt-in CocoaPods 1.17.0 context capture for the observed Detox file-reference failure.
module OrotCocoapodsNullByteDiagnostic
  COCOAPODS_VERSION = '1.17.0'
  NULL_BYTE_PATH_ERROR = 'path name contains null byte'
  TARGET_SOURCE_SUFFIX = '/cocoapods/installer/xcode/pods_project_generator/file_references_installer.rb'
  REALDIRPATH_INPUT_IVAR = :@orot_cocoapods_realdirpath_input
  MAX_CAPTURE_DUMP_BYTES = 2048
  MAX_CAPTURE_SCAN_BYTES = 4096
  MAX_CAPTURED_NUL_OFFSETS = 16

  # Attach the failing input to Ruby's exception so CocoaPods can report it without replacing the error.
  module PathnameRealdirpathDiagnostic
    def realdirpath(...)
      # Pathname and File share this String, so retain the call-entry bytes before delegation can mutate it.
      path_snapshot, snapshot_error = begin
        [path.dup.freeze, nil]
      rescue StandardError => error
        [nil, error]
      end
      super
    rescue ArgumentError => error
      if error.message == NULL_BYTE_PATH_ERROR
        begin
          path_capture = if path_snapshot
                           OrotCocoapodsNullByteDiagnostic.capture_realdirpath_input(path_snapshot)
                         else
                           OrotCocoapodsNullByteDiagnostic.unavailable_path_capture(snapshot_error)
                         end
          error.instance_variable_set(
            REALDIRPATH_INPUT_IVAR,
            path_capture,
          )
        rescue StandardError => capture_error
          begin
            error.instance_variable_set(
              REALDIRPATH_INPUT_IVAR,
              OrotCocoapodsNullByteDiagnostic.unavailable_path_capture(capture_error),
            )
          rescue StandardError
            # Evidence collection must not replace Ruby's original CocoaPods error.
          end
        end
      end
      raise
    end
  end

  # CocoaPods keeps the accessor and path context in this private loop; mirror its pinned body only in diagnostic mode.
  module FileReferencesInstallerPatch
    private

    def add_file_accessors_paths_to_pods_group(file_accessor_key, group_key = nil,
                                               reflect_file_system_structure = false)
      file_accessors.flat_map do |file_accessor|
        paths = file_accessor.send(file_accessor_key)
        paths = allowable_project_paths(paths)
        next [] if paths.empty?

        pod_name = file_accessor.spec.name
        preserve_pod_file_structure_flag =
          (sandbox.local?(pod_name) || preserve_pod_file_structure) && reflect_file_system_structure
        base_path = preserve_pod_file_structure_flag ? common_path(paths) : nil
        actual_group_key = preserve_pod_file_structure_flag ? nil : group_key
        group = pods_project.group_for_spec(pod_name, actual_group_key)

        paths.map do |path|
          begin
            pods_project.add_file_reference(path, group, preserve_pod_file_structure_flag, base_path)
          rescue ArgumentError => error
            if error.message == NULL_BYTE_PATH_ERROR
              OrotCocoapodsNullByteDiagnostic.report_failure(
                error,
                pod_name,
                file_accessor_key,
                path,
                base_path,
                group,
                error.instance_variable_get(REALDIRPATH_INPUT_IVAR),
              )
            end
            raise
          end
        end
      end
    end
  end

  def self.safe_dump(value)
    return 'nil' if value.nil?
    return value.inspect if value.is_a?(Symbol)

    value.to_s.dump
  rescue StandardError => error
    "<unavailable:#{error.class}>".dump
  end

  def self.safe_group_real_path(group)
    group.real_path
  rescue StandardError => error
    "<unavailable:#{error.class}>"
  end

  # Keep logs printable and bounded while reporting byte offsets from the original string.
  def self.capture_realdirpath_input(path)
    return unavailable_path_capture unless path.is_a?(String)

    scanned_path = path.byteslice(0, MAX_CAPTURE_SCAN_BYTES)
    nul_offsets = []
    nul_count = 0
    scanned_path.each_byte.with_index do |byte, index|
      next unless byte.zero?

      nul_count += 1
      nul_offsets << index if nul_offsets.length < MAX_CAPTURED_NUL_OFFSETS
    end

    {
      dump: bounded_dump(path),
      bytes: path.bytesize,
      nul_offsets: nul_count.zero? ? 'none' : nul_offsets.join(','),
      nul_count: nul_count,
      scanned_bytes: scanned_path.bytesize,
      scan_truncated: scanned_path.bytesize < path.bytesize,
      offsets_truncated: nul_count > nul_offsets.length,
    }
  rescue StandardError => error
    unavailable_path_capture(error)
  end

  def self.bounded_dump(value)
    dumped = safe_dump(value)
    return dumped if dumped.bytesize <= MAX_CAPTURE_DUMP_BYTES

    "#{dumped.byteslice(0, MAX_CAPTURE_DUMP_BYTES)}...<truncated>"
  end

  def self.unavailable_path_capture(error = nil)
    marker = error ? "<unavailable:#{error.class}>".dump : 'not_observed'
    {
      dump: marker,
      bytes: 'unavailable',
      nul_offsets: 'unavailable',
      nul_count: 'unavailable',
      scanned_bytes: 'unavailable',
      scan_truncated: 'unavailable',
      offsets_truncated: 'unavailable',
    }
  end

  # Logging is best-effort so a diagnostic failure cannot replace CocoaPods' original exception.
  def self.report_failure(error, pod_name, accessor_key, absolute_pathname, base_path, group, path_capture)
    path_capture ||= unavailable_path_capture
    fields = [
      'OROT_COCOAPODS_NULL_BYTE_DIAGNOSTIC',
      "version=#{COCOAPODS_VERSION}",
      "pod=#{safe_dump(pod_name)}",
      "accessor_key=#{safe_dump(accessor_key)}",
      "absolute_pathname=#{safe_dump(absolute_pathname)}",
      "base_path=#{safe_dump(base_path)}",
      "group_real_path=#{safe_dump(safe_group_real_path(group))}",
      "realdirpath_input=#{path_capture[:dump]}",
      "realdirpath_input_bytes=#{path_capture[:bytes]}",
      "realdirpath_input_nul_offsets=#{path_capture[:nul_offsets]}",
      "realdirpath_input_nul_count=#{path_capture[:nul_count]}",
      "realdirpath_input_scanned_bytes=#{path_capture[:scanned_bytes]}",
      "realdirpath_input_scan_truncated=#{path_capture[:scan_truncated]}",
      "realdirpath_input_offsets_truncated=#{path_capture[:offsets_truncated]}",
      "error=#{safe_dump(error.message)}",
    ]
    warn(fields.join(' '))
  rescue StandardError
    # The caller's bare raise remains authoritative if stderr or formatting fails.
  end

  def self.install_when_cocoapods_loads
    # RUBYOPT runs before CocoaPods, so wait for its pinned internal class to define the target method.
    loader_trace = nil
    loader_trace = TracePoint.new(:end) do |event|
      next unless event.path&.end_with?(TARGET_SOURCE_SUFFIX)

      klass = begin
        Pod::Installer::Xcode::PodsProjectGenerator::FileReferencesInstaller
      rescue NameError
        nil
      end
      next unless klass

      method = begin
        klass.instance_method(:add_file_accessors_paths_to_pods_group)
      rescue NameError
        nil
      end
      next unless method&.source_location&.first&.end_with?(TARGET_SOURCE_SUFFIX)

      if Pod.const_defined?(:VERSION, false) && Pod::VERSION.to_s == COCOAPODS_VERSION
        if defined?(Pathname) && Pathname.method_defined?(:realdirpath)
          Pathname.prepend(PathnameRealdirpathDiagnostic) unless
            Pathname.ancestors.include?(PathnameRealdirpathDiagnostic)
        end
        klass.prepend(FileReferencesInstallerPatch) unless klass.ancestors.include?(FileReferencesInstallerPatch)
      end
      loader_trace.disable
    end
    loader_trace.enable
  end
end

if ENV['OROT_COCOAPODS_NULL_BYTE_DIAGNOSTIC'] == '1'
  OrotCocoapodsNullByteDiagnostic.install_when_cocoapods_loads
end
