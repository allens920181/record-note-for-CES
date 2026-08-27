// The File System Access API is Chromium-only, so lib.dom.d.ts does not carry
// all of it. Declared here rather than pulled in as a dependency.
export {}

declare global {
  type FsPermissionState = 'granted' | 'denied' | 'prompt'
  interface FileSystemHandlePermissionDescriptor {
    mode?: 'read' | 'readwrite'
  }
  interface FileSystemHandle {
    queryPermission?(d?: FileSystemHandlePermissionDescriptor): Promise<FsPermissionState>
    requestPermission?(d?: FileSystemHandlePermissionDescriptor): Promise<FsPermissionState>
  }
  interface DirectoryPickerOptions {
    id?: string
    mode?: 'read' | 'readwrite'
    startIn?: string
  }
  interface Window {
    showDirectoryPicker?(o?: DirectoryPickerOptions): Promise<FileSystemDirectoryHandle>
  }
  interface FileSystemDirectoryHandle {
    entries(): AsyncIterableIterator<[string, FileSystemHandle]>
    keys(): AsyncIterableIterator<string>
    values(): AsyncIterableIterator<FileSystemHandle>
  }
}
