# Opt-in CocoaPods 1.17.0 context capture for the observed Detox file-reference failure.
module OrotCocoapodsNullByteDiagnostic
  COCOAPODS_VERSION = '1.17.0'
  NULL_BYTE_PATH_ERROR = 'path name contains null byte'
  TARGET_SOURCE_SUFFIX = '/cocoapods/installer/xcode/pods_project_generator/file_references_installer.rb'
  PROJECT_SOURCE_SUFFIX = '/cocoapods/project.rb'

  # Keep CocoaPods' path grouping lexical when both file and base share a package symlink.
  class LexicalSymlinkBasePath < Pathname
    def realdirpath
      cleanpath
    end
  end

  # CocoaPods 1.17.0 canonicalizes a local pod's common path before computing relative groups.
  module ProjectGroupPathPatch
    def group_for_path_in_group(absolute_pathname, group, reflect_file_system_structure, base_path = nil)
      if OrotCocoapodsNullByteDiagnostic.shared_symlink_prefix?(absolute_pathname, base_path)
        # Pathname#realdirpath can fail at this boundary and would detach a lexical file path from its symlinked base.
        base_path = LexicalSymlinkBasePath.new(base_path.to_s)
      end

      super(absolute_pathname, group, reflect_file_system_structure, base_path)
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

  # Apply the workaround only when both clean inputs pass through the same real symlink.
  def self.shared_symlink_prefix?(absolute_pathname, base_path)
    return false unless absolute_pathname.is_a?(Pathname) && base_path.is_a?(Pathname)

    absolute_path = absolute_pathname.to_s
    base_string = base_path.to_s
    return false if absolute_path.include?("\0") || base_string.include?("\0")

    lexical_file = absolute_pathname.cleanpath.to_s
    base_path.cleanpath.ascend.any? do |candidate|
      prefix = candidate.to_s
      shared_prefix = lexical_file == prefix || lexical_file.start_with?("#{prefix}#{File::SEPARATOR}")
      shared_prefix && File.symlink?(prefix)
    end
  rescue StandardError
    false
  end

  # Logging is best-effort so a diagnostic failure cannot replace CocoaPods' original exception.
  def self.report_failure(error, pod_name, accessor_key, absolute_pathname, base_path, group)
    fields = [
      'OROT_COCOAPODS_NULL_BYTE_DIAGNOSTIC',
      "version=#{COCOAPODS_VERSION}",
      "pod=#{safe_dump(pod_name)}",
      "accessor_key=#{safe_dump(accessor_key)}",
      "absolute_pathname=#{safe_dump(absolute_pathname)}",
      "base_path=#{safe_dump(base_path)}",
      "group_real_path=#{safe_dump(safe_group_real_path(group))}",
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
        install_project_group_path_workaround
        klass.prepend(FileReferencesInstallerPatch) unless klass.ancestors.include?(FileReferencesInstallerPatch)
      end
      loader_trace.disable
    end
    loader_trace.enable
  end

  def self.install_project_group_path_workaround
    return unless Pod.const_defined?(:Project, false)

    project_class = Pod.const_get(:Project, false)
    method = project_class.instance_method(:group_for_path_in_group)
    return unless method.source_location&.first&.end_with?(PROJECT_SOURCE_SUFFIX)

    project_class.prepend(ProjectGroupPathPatch) unless project_class.ancestors.include?(ProjectGroupPathPatch)
  rescue NameError
    # Preserve CocoaPods behavior if its pinned project method is unavailable.
  end
end

if ENV['OROT_COCOAPODS_NULL_BYTE_DIAGNOSTIC'] == '1'
  OrotCocoapodsNullByteDiagnostic.install_when_cocoapods_loads
end
