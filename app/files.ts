interface TauriCore {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
}

interface TauriWindow {
  setTitle(title: string): Promise<void>;
}

interface TauriWindowModule {
  getCurrentWindow(): TauriWindow;
}

declare global {
  interface Window {
    __TAURI__?: {
      core?: TauriCore;
      window?: TauriWindowModule;
    };
  }
}

export interface OpenedFile {
  name: string;
  path: string | null;
  text: string;
}

export interface SavedFile {
  name: string;
  path: string | null;
}

export interface ExportDocument {
  name: string;
  contents: string;
}

function tauri(): TauriCore | null {
  return window.__TAURI__?.core ?? null;
}

export function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export function stripExtension(name: string): string {
  return name.replace(/\.[^.]+$/, "") || name;
}

/** Native open dialog in the desktop app; file input when opened in a browser. */
export async function openMarkdownFile(): Promise<OpenedFile | null> {
  const bridge = tauri();
  if (bridge) {
    const path = await bridge.invoke<string | null>("pick_open");
    if (!path) return null;
    const text = await bridge.invoke<string>("read_text_file", { path });
    return { name: basename(path), path, text };
  }

  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".md,.markdown,.mdown,.txt,text/markdown,text/plain";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      void file.text().then((text) => resolve({ name: file.name, path: null, text }));
    });
    input.click();
  });
}

/** Files passed on the command line by a file manager or shell. */
export async function startupMarkdownFiles(): Promise<OpenedFile[]> {
  const bridge = tauri();
  if (!bridge) return [];
  const paths = await bridge.invoke<string[]>("take_startup_files");
  const files: OpenedFile[] = [];
  for (const path of paths) {
    const text = await bridge.invoke<string>("read_text_file", { path });
    files.push({ name: basename(path), path, text });
  }
  return files;
}

/** Keep the native title bar and taskbar label in sync with the document. */
export function setWindowTitle(title: string): void {
  const appWindow = window.__TAURI__?.window?.getCurrentWindow();
  if (appWindow) void appWindow.setTitle(title).catch(() => undefined);
}

/**
 * Save as Markdown. In the desktop app Ctrl+S writes straight to the known
 * path; Save As (or a new document) asks for a location. Null means cancelled.
 */
export async function saveMarkdownFile(
  defaultName: string,
  contents: string,
  path: string | null,
  askForPath: boolean,
): Promise<SavedFile | null> {
  const bridge = tauri();
  if (bridge) {
    let target = path;
    if (askForPath || !target) {
      target = await bridge.invoke<string | null>("pick_save", { defaultName });
      if (!target) return null;
      if (!/\.[a-z0-9]+$/i.test(target)) target += ".md";
    }
    await bridge.invoke("write_text_file", { path: target, contents });
    return { name: basename(target), path: target };
  }

  const name = path ? basename(path) : defaultName;
  const blob = new Blob([contents], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { name, path: null };
}

export async function chooseExportDirectory(): Promise<string | null> {
  const bridge = tauri();
  return bridge ? bridge.invoke<string | null>("pick_export_directory") : null;
}

export async function exportMarkdownFiles(directory: string, files: ExportDocument[]): Promise<number> {
  const bridge = tauri();
  if (bridge) return bridge.invoke<number>("write_folder_files", { directory, files });

  for (const file of files) {
    const blob = new Blob([file.contents], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return files.length;
}
