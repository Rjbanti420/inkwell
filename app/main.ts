import { FindController } from "./find.js";
import { TypewriterAudio } from "./audio.js";
import { TimerController, type TimerSummary } from "./timer.js";
import { markdownToHtml, sanitizeHtml, htmlToMarkdown } from "./markdown.js";
import { countChars, countWords, formatDuration, formatNumber, selectionCounts } from "./words.js";
import {
  chooseExportDirectory,
  exportMarkdownFiles,
  openMarkdownFile,
  saveMarkdownFile,
  setWindowTitle,
  startupMarkdownFiles,
  stripExtension,
} from "./files.js";
import { $, makeEl, toast, openDialog, dialogOpen } from "./dom.js";
import {
  createFolder as addFolder,
  deleteFolder as removeFolder,
  moveDocument as assignDocument,
  renameFolder as updateFolderName,
  restoreFolderId,
  restoreFolders,
  uniqueDocumentTitle,
} from "./folders.js";
import {
  BLOCK_TAGS,
  type Folder,
  type PendingFormat,
  type SessionFile,
  type Settings,
  type Tab,
  type ThemeMode,
} from "./types.js";
import {
  carrierHasText,
  carrierStyle,
  clampFontSize,
  hasPendingFormat,
  insertCarrier,
  nextFontSize,
  stripCarrierMarker,
  type InlineContext,
} from "./format.js";

const SESSION_KEY = "inkwell.session.v1";
const SETTINGS_KEY = "inkwell.settings.v1";

const workspace = $<HTMLElement>("#workspace");
const sidebar = $<HTMLElement>("#sidebar");
const sidebarToggle = $<HTMLButtonElement>("#sidebar-toggle");
const tabsEl = $<HTMLElement>("#tabs");
const toolbar = $<HTMLElement>("#toolbar");
const statusbar = $<HTMLElement>("#statusbar");
const fileInfo = $<HTMLElement>("#file-info");
const counts = $<HTMLElement>("#counts");
const focusButton = $<HTMLButtonElement>("#focus-btn");
const typewriterButton = $<HTMLButtonElement>("#typewriter-btn");
const blockStyle = $<HTMLSelectElement>("#block-style");
const fontFamily = $<HTMLSelectElement>("#font-family");
const fontSizeInput = $<HTMLInputElement>("#font-size");
const colorButton = $<HTMLButtonElement>("#color-button");
const colorPopover = $<HTMLElement>("#color-popover");
const colorBar = document.querySelector<SVGElement>("#color-bar")!;
const colorCustom = $<HTMLInputElement>("#color-custom");
const colorSwatches = $<HTMLElement>("#color-swatches");
const colorDefault = $<HTMLButtonElement>("#color-default");
const highlightButton = $<HTMLButtonElement>("#highlight-btn");
const highlightPicker = $<HTMLButtonElement>("#highlight-picker");
const highlightPopover = $<HTMLElement>("#highlight-popover");
const highlightSwatches = $<HTMLElement>("#highlight-swatches");
const highlightNone = $<HTMLButtonElement>("#highlight-none");
const themeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-theme-mode]"));
const volumeInput = $<HTMLInputElement>("#volume");
const muteButton = $<HTMLButtonElement>("#mute-btn");
const pageWidthSelect = $<HTMLSelectElement>("#page-width");
const newFolderButton = $<HTMLButtonElement>("#new-folder");
const sidebarFilter = $<HTMLInputElement>("#sidebar-filter");

const FONT_STACKS: Record<string, string> = {
  "Iowan Old Style": "'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif",
  Arial: "Arial, Helvetica, sans-serif",
  Helvetica: "Helvetica, Arial, sans-serif",
  "Times New Roman": "'Times New Roman', Times, serif",
  Georgia: "Georgia, 'Times New Roman', serif",
  Verdana: "Verdana, Geneva, sans-serif",
  "Courier New": "'Courier New', Courier, monospace",
  "Trebuchet MS": "'Trebuchet MS', 'Lucida Sans Unicode', sans-serif",
  Garamond: "Garamond, 'Times New Roman', serif",
  Palatino: "'Palatino Linotype', Palatino, 'Book Antiqua', serif",
  "Comic Sans MS": "'Comic Sans MS', 'Comic Sans', cursive",
};

const PRESET_COLORS = [
  "#dc2626", "#e11d48", "#ea580c", "#b45309", "#16a34a",
  "#0d9488", "#3b82f6", "#a855f7", "#db2777", "#64748b",
];

const HIGHLIGHT_COLORS = ["#fde68a", "#bbf7d0", "#bfdbfe", "#fbcfe8", "#fed7aa", "#e9d5ff"];
const DEFAULT_HIGHLIGHT = "#fde68a";

const BLOCK_SELECTOR = "p,div,h1,h2,h3,h4,h5,h6,li,blockquote,pre";

const audio = new TypewriterAudio();
let finder: FindController;
let timer: TimerController;
let centerFrame = 0;
let sessionSaveTimer: number | undefined;
let quotaWarned = false;
let draggingTabId: string | null = null;
let sidebarMenu: HTMLElement | null = null;
let sidebarFilterText = "";

const state: {
  tabs: Tab[];
  folders: Folder[];
  activeId: string;
  focus: boolean;
  typewriter: boolean;
  chromeTimer: number | undefined;
} = {
  tabs: [],
  folders: [],
  activeId: "",
  focus: false,
  typewriter: false,
  chromeTimer: undefined,
};

const settings: Settings = loadSettings();

function activeTab(): Tab | null {
  return state.tabs.find((tab) => tab.id === state.activeId) ?? null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------- session ---

function loadSettings(): Settings {
  const fallback: Settings = {
    volume: 0.6,
    muted: false,
    theme: "system",
    sidebar: true,
    highlightColor: DEFAULT_HIGHLIGHT,
    pageWidth: "normal",
  };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      volume: typeof parsed.volume === "number" ? Math.min(1, Math.max(0, parsed.volume)) : fallback.volume,
      muted: Boolean(parsed.muted),
      theme: parsed.theme === "light" || parsed.theme === "dark" ? parsed.theme : "system",
      sidebar: parsed.sidebar !== false,
      pageWidth: parsed.pageWidth === "narrow" || parsed.pageWidth === "wide" ? parsed.pageWidth : "normal",
      highlightColor:
        typeof parsed.highlightColor === "string" && /^#[0-9a-f]{6}$/i.test(parsed.highlightColor)
          ? parsed.highlightColor
          : fallback.highlightColor,
    };
  } catch {
    return fallback;
  }
}

function applyTheme(): void {
  const root = document.documentElement;
  if (settings.theme === "system") delete root.dataset.theme;
  else root.dataset.theme = settings.theme;
  for (const button of themeButtons) {
    const active = button.dataset.themeMode === settings.theme;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  updateToolbarState();
}

function setTheme(mode: ThemeMode): void {
  settings.theme = mode;
  saveSettings();
  applyTheme();
}

function applyPageWidth(): void {
  document.body.classList.remove("page-width-narrow", "page-width-normal", "page-width-wide");
  document.body.classList.add(`page-width-${settings.pageWidth}`);
  pageWidthSelect.value = settings.pageWidth;
}

function setPageWidth(value: string): void {
  if (value !== "narrow" && value !== "normal" && value !== "wide") return;
  settings.pageWidth = value;
  saveSettings();
  applyPageWidth();
}

function applySidebar(): void {
  document.body.classList.toggle("sidebar-collapsed", !settings.sidebar);
  sidebarToggle.setAttribute("aria-pressed", String(settings.sidebar));
  sidebarToggle.title = `${settings.sidebar ? "Hide" : "Show"} sidebar (Ctrl+\\)`;
  sidebar.setAttribute("aria-hidden", String(!settings.sidebar));
  window.requestAnimationFrame(() => activeTab()?.editor.focus({ preventScroll: true }));
}

function toggleSidebar(): void {
  settings.sidebar = !settings.sidebar;
  saveSettings();
  applySidebar();
}

function saveSettings(): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* settings are a nicety; losing them is harmless */
  }
}

function saveSessionNow(): void {
  const data: SessionFile = {
    version: 1,
    activeId: state.activeId,
    tabs: state.tabs.map((tab) => ({
      id: tab.id,
      title: tab.title,
      fileName: tab.fileName,
      filePath: tab.filePath,
      dirty: tab.dirty,
      html: tab.editor.innerHTML,
      style: tab.editor.getAttribute("style") ?? "",
      folderId: tab.folderId,
    })),
    folders: state.folders,
  };
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(data));
  } catch {
    if (!quotaWarned) {
      quotaWarned = true;
      toast("Autosave failed: documents exceed local storage space.", true);
    }
  }
}

function scheduleSessionSave(): void {
  window.clearTimeout(sessionSaveTimer);
  sessionSaveTimer = window.setTimeout(saveSessionNow, 400);
}

function restoreSession(): void {
  let data: SessionFile | null = null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) data = JSON.parse(raw) as SessionFile;
  } catch {
    data = null;
  }

  if (data && data.version === 1) state.folders = restoreFolders(data.folders);

  if (data && data.version === 1 && Array.isArray(data.tabs) && data.tabs.length) {
    for (const stored of data.tabs) {
      if (!stored || typeof stored.html !== "string") continue;
      createTab({
        id: stored.id,
        title: stored.title,
        html: stored.html,
        fileName: stored.fileName,
        filePath: stored.filePath,
        dirty: Boolean(stored.dirty),
        style: stored.style,
        folderId: stored.folderId,
      });
    }
  }

  if (!state.tabs.length) createTab({ title: "Untitled" });

  const target = state.tabs.find((tab) => tab.id === data?.activeId) ?? state.tabs[0];
  activateTab(target.id);
}

// ------------------------------------------------------------------- tabs ---

interface CreateTabOptions {
  id?: string;
  title?: string;
  html?: string;
  fileName?: string | null;
  filePath?: string | null;
  dirty?: boolean;
  style?: string;
  folderId?: string | null;
}

function createTab(options: CreateTabOptions = {}): Tab {
  const id = options.id ?? newId();
  const title = uniqueDocumentTitle(options.title ?? "Untitled", state.tabs.map((tab) => tab.title));

  const wrap = makeEl("div", "tab-page");

  const editor = makeEl("div", "editor");
  editor.contentEditable = "true";
  editor.spellcheck = true;
  editor.setAttribute("role", "textbox");
  editor.setAttribute("aria-multiline", "true");
  editor.setAttribute("aria-label", `${title} document`);
  editor.dataset.placeholder = "Start writing…";
  editor.innerHTML = options.html ?? "";
  // A saved session can contain an empty formatting carrier from a toolbar
  // choice made just before closing; strip markers so counts stay accurate.
  for (const span of Array.from(editor.querySelectorAll<HTMLElement>(".caret-style"))) {
    stripCarrierMarker(span, null);
    if (!carrierHasText(span)) span.remove();
  }
  if (options.style) editor.setAttribute("style", options.style);
  wrap.append(editor);
  workspace.append(wrap);

  const tab: Tab = {
    id,
    title,
    fileName: options.fileName ?? null,
    filePath: options.filePath ?? null,
    dirty: options.dirty ?? false,
    folderId: restoreFolderId(options.folderId, state.folders),
    editor,
    wrap,
    lastRange: null,
    pending: {},
  };
  wrap.prepend(buildDocHeader(tab));

  editor.addEventListener("input", () => onEditorInput(tab));
  editor.addEventListener("keydown", (event) => onEditorKeydown(event));
  editor.addEventListener("compositionend", () => audio.play("key"));
  editor.addEventListener("paste", onPaste);
  editor.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const anchor = target.closest("a");
    if (anchor) {
      event.preventDefault();
      toast(anchor.getAttribute("href") ?? "Link");
      return;
    }
    clearPendingFormat(tab);
    updateToolbarState();
    if (target === editor) placeCaretBelowLastLine(tab, event.clientY);
  });
  wrap.addEventListener("click", (event) => {
    const target = event.target as Element;
    if (target.closest(".editor") || target.closest(".doc-header")) return;
    placeCaretInPage(tab, event.clientX, event.clientY);
  });

  state.tabs.push(tab);
  renderTabs();
  return tab;
}

function newId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function renderTabs(): void {
  tabsEl.replaceChildren();
  const query = sidebarFilterText.trim().toLocaleLowerCase();

  for (const folder of state.folders) {
    const docs = state.tabs.filter((tab) => tab.folderId === folder.id);
    const folderMatches = query && folder.name.toLocaleLowerCase().includes(query);
    const visibleDocs = !query || folderMatches
      ? docs
      : docs.filter((tab) => tab.title.toLocaleLowerCase().includes(query));
    if (query && !folderMatches && !visibleDocs.length) continue;

    const group = makeEl("section", "folder-group");
    group.setAttribute("role", "group");
    const row = makeEl("div", "folder-row");
    const toggle = makeEl("button", "folder-toggle");
    toggle.type = "button";
    toggle.dataset.sidebarEntry = "folder";
    toggle.dataset.folderId = folder.id;
    toggle.tabIndex = -1;
    toggle.setAttribute("role", "treeitem");
    toggle.setAttribute("aria-expanded", String(folder.expanded || Boolean(query && visibleDocs.length)));
    toggle.setAttribute("aria-label", `${folder.expanded ? "Collapse" : "Expand"} ${folder.name}`);
    const chevron = icon("chevron");
    chevron.classList.add("folder-chevron");
    toggle.append(chevron);
    const folderIcon = icon("folder");
    folderIcon.classList.add("folder-icon");
    toggle.append(folderIcon);
    const label = makeEl("span", "folder-name", folder.name);
    label.addEventListener("dblclick", (event) => {
      event.stopPropagation();
      startFolderRename(folder, label);
    });
    toggle.append(label, makeEl("span", "folder-count", String(docs.length)));
    row.append(toggle);
    row.append(sidebarMore(`Folder options for ${folder.name}`, () => showFolderMenu(folder)));
    toggle.addEventListener("click", () => {
      folder.expanded = !folder.expanded;
      renderTabs();
      scheduleSessionSave();
      tabsEl.querySelector<HTMLElement>(`.folder-toggle[data-folder-id="${CSS.escape(folder.id)}"]`)?.focus();
    });
    row.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      showFolderMenu(folder, event.clientX, event.clientY);
    });
    wireFolderDrop(row, folder.id);

    const list = makeEl("div", "folder-documents");
    list.hidden = !(folder.expanded || Boolean(query && visibleDocs.length));
    for (const tab of visibleDocs) list.append(buildDocumentRow(tab));
    group.append(row, list);
    tabsEl.append(group);
  }

  const rootTabs = state.tabs.filter((tab) => tab.folderId === null);
  const visibleRoot = !query ? rootTabs : rootTabs.filter((tab) => tab.title.toLocaleLowerCase().includes(query));
  const rootLabel = makeEl("div", "root-label", `Unfiled · ${rootTabs.length}`);
  rootLabel.dataset.sidebarEntry = "root";
  rootLabel.setAttribute("role", "presentation");
  rootLabel.tabIndex = -1;
  rootLabel.addEventListener("contextmenu", (event) => event.preventDefault());
  wireRootDrop(rootLabel);
  const root = makeEl("div", "root-documents");
  root.dataset.sidebarEntry = "root-drop";
  root.setAttribute("role", "group");
  for (const tab of visibleRoot) root.append(buildDocumentRow(tab));
  wireRootDrop(root);
  tabsEl.append(rootLabel, root);

  for (const tab of state.tabs) renderDocHeader(tab);
  tabsEl.querySelector(".tab.active")?.scrollIntoView({ block: "nearest" });
}

function sidebarMore(label: string, action: () => void): HTMLButtonElement {
  const button = makeEl("button", "sidebar-more");
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.append(icon("more"));
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    action();
  });
  return button;
}

function buildDocumentRow(tab: Tab): HTMLElement {
  const active = tab.id === state.activeId;
  const item = makeEl("div", `tab document-row${active ? " active" : ""}`);
  item.setAttribute("role", "treeitem");
  item.setAttribute("aria-selected", String(active));
  item.setAttribute("aria-label", tab.title);
  item.dataset.sidebarEntry = "document";
  item.dataset.id = tab.id;
  item.tabIndex = active ? 0 : -1;
  item.draggable = true;

  const initial = makeEl("span", "tab-initial", (tab.title.trim()[0] ?? "?").toUpperCase());
  initial.setAttribute("aria-hidden", "true");
  const label = makeEl("span", "tab-title", tab.title);
  label.title = tab.filePath ?? tab.title;
  label.addEventListener("dblclick", (event) => {
    event.stopPropagation();
    startRename(tab, label);
  });
  item.append(initial, label);
  if (tab.dirty) {
    const dot = makeEl("span", "dirty-dot");
    dot.title = "Unsaved changes";
    dot.setAttribute("aria-label", "Unsaved changes");
    item.append(dot);
  }
  item.append(sidebarMore(`Document options for ${tab.title}`, () => showDocumentMenu(tab)));
  const close = makeEl("button", "tab-close");
  close.type = "button";
  close.title = "Close tab (Ctrl+W)";
  close.setAttribute("aria-label", `Close ${tab.title}`);
  close.append(icon("close"));
  close.addEventListener("click", (event) => {
    event.stopPropagation();
    void closeTab(tab);
  });
  item.append(close);
  item.addEventListener("click", () => activateTab(tab.id));
  item.addEventListener("auxclick", (event) => {
    if (event.button === 1) {
      event.preventDefault();
      void closeTab(tab);
    }
  });
  item.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    showDocumentMenu(tab, event.clientX, event.clientY);
  });
  item.addEventListener("dragstart", (event) => {
    draggingTabId = tab.id;
    item.classList.add("dragging");
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", tab.id);
    }
  });
  item.addEventListener("dragend", () => {
    draggingTabId = null;
    item.classList.remove("dragging");
    tabsEl.querySelectorAll(".drop-target").forEach((target) => target.classList.remove("drop-target"));
  });
  item.addEventListener("dragover", (event) => {
    if (!draggingTabId || draggingTabId === tab.id) return;
    event.preventDefault();
  });
  item.addEventListener("drop", (event) => {
    if (!draggingTabId || draggingTabId === tab.id) return;
    event.preventDefault();
    event.stopPropagation();
    reorderTabs(draggingTabId, tab.id);
  });
  return item;
}

function wireFolderDrop(row: HTMLElement, folderId: string): void {
  row.addEventListener("dragover", (event) => {
    if (!draggingTabId) return;
    event.preventDefault();
    row.classList.add("drop-target");
  });
  row.addEventListener("dragleave", (event) => {
    if (!row.contains(event.relatedTarget as Node | null)) row.classList.remove("drop-target");
  });
  row.addEventListener("drop", (event) => {
    if (!draggingTabId) return;
    event.preventDefault();
    event.stopPropagation();
    row.classList.remove("drop-target");
    moveTabToFolder(draggingTabId, folderId);
  });
}

function wireRootDrop(root: HTMLElement): void {
  root.addEventListener("dragover", (event) => {
    if (!draggingTabId || (event.target as Element).closest(".document-row")) return;
    event.preventDefault();
    root.classList.add("drop-target");
  });
  root.addEventListener("dragleave", (event) => {
    if (!root.contains(event.relatedTarget as Node | null)) root.classList.remove("drop-target");
  });
  root.addEventListener("drop", (event) => {
    if (!draggingTabId) return;
    event.preventDefault();
    root.classList.remove("drop-target");
    moveTabToFolder(draggingTabId, null);
  });
}

function reorderTabs(draggedId: string, targetId: string): void {
  const from = state.tabs.findIndex((tab) => tab.id === draggedId);
  const to = state.tabs.findIndex((tab) => tab.id === targetId);
  if (from < 0 || to < 0 || from === to) return;
  const [tab] = state.tabs.splice(from, 1);
  state.tabs.splice(to, 0, tab);
  draggingTabId = null;
  renderTabs();
  scheduleSessionSave();
}

function moveTabToFolder(tabId: string, folderId: string | null): void {
  state.tabs = assignDocument(state.tabs, tabId, folderId, state.folders);
  draggingTabId = null;
  if (folderId) {
    const folder = state.folders.find((item) => item.id === folderId);
    if (folder) folder.expanded = true;
  }
  renderTabs();
  scheduleSessionSave();
}

function startFolderRename(folder: Folder, label: HTMLElement, onCommit?: (folder: Folder) => void): void {
  const input = makeEl("input", "folder-rename");
  input.value = folder.name;
  input.setAttribute("aria-label", "Folder name");
  const row = label.closest(".folder-row");
  const toggle = row?.querySelector(".folder-toggle");
  if (toggle) toggle.replaceWith(input);
  else label.replaceWith(input);
  input.focus();
  input.select();
  let finished = false;
  const finish = (commit: boolean) => {
    if (finished) return;
    finished = true;
    if (commit && input.value.trim()) {
      state.folders = updateFolderName(state.folders, folder.id, input.value);
    }
    const current = state.folders.find((item) => item.id === folder.id);
    renderTabs();
    scheduleSessionSave();
    if (commit && current) onCommit?.(current);
  };
  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      input.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      input.onblur = null;
      finish(false);
    }
  });
  input.onblur = () => finish(true);
}

function createFolder(onCommit?: (folder: Folder) => void): void {
  const folder: Folder = { id: newId(), name: "New folder", expanded: true };
  state.folders = addFolder(state.folders, folder.id, folder.name);
  const created = state.folders.find((item) => item.id === folder.id)!;
  renderTabs();
  scheduleSessionSave();
  const label = tabsEl.querySelector<HTMLElement>(`.folder-toggle[data-folder-id="${CSS.escape(created.id)}"] .folder-name`);
  if (label) startFolderRename(created, label, onCommit);
}

interface SidebarMenuItem {
  label: string;
  action?: () => void;
  danger?: boolean;
  heading?: boolean;
}

function closeSidebarMenu(): void {
  sidebarMenu?.remove();
  sidebarMenu = null;
}

function showSidebarMenu(items: SidebarMenuItem[], x = 12, y = 88): void {
  closeSidebarMenu();
  const menu = makeEl("div", "sidebar-menu");
  menu.setAttribute("role", "menu");
  for (const item of items) {
    if (item.heading) {
      menu.append(makeEl("div", "menu-label", item.label));
      continue;
    }
    const button = makeEl("button", item.danger ? "menu-danger" : "", item.label);
    button.type = "button";
    button.setAttribute("role", "menuitem");
    button.addEventListener("click", () => {
      closeSidebarMenu();
      item.action?.();
    });
    menu.append(button);
  }
  document.body.append(menu);
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))}px`;
  menu.querySelector<HTMLButtonElement>("button")?.focus();
  sidebarMenu = menu;
}

function beginFolderRename(folder: Folder): void {
  const label = tabsEl.querySelector<HTMLElement>(`.folder-toggle[data-folder-id="${CSS.escape(folder.id)}"] .folder-name`);
  if (label) startFolderRename(folder, label);
}

function showFolderMenu(folder: Folder, x?: number, y?: number): void {
  showSidebarMenu([
    { label: "Rename", action: () => beginFolderRename(folder) },
    { label: "New document here", action: () => newTab(folder.id) },
    { label: "Export folder…", action: () => void exportFolder(folder) },
    { label: "Delete folder…", action: () => void confirmDeleteFolder(folder), danger: true },
  ], x, y);
}

function showDocumentMenu(tab: Tab, x?: number, y?: number): void {
  const items: SidebarMenuItem[] = [{ label: "Move to folder", heading: true }];
  items.push({ label: "No folder", action: () => moveTabToFolder(tab.id, null) });
  for (const folder of state.folders) {
    items.push({ label: folder.name, action: () => moveTabToFolder(tab.id, folder.id) });
  }
  items.push(
    { label: "New folder…", action: () => createFolder((folder) => moveTabToFolder(tab.id, folder.id)) },
  );
  showSidebarMenu(items, x, y);
}

async function confirmDeleteFolder(folder: Folder): Promise<void> {
  const docs = state.tabs.filter((tab) => tab.folderId === folder.id);
  const dirtyCount = docs.filter((tab) => tab.dirty).length;
  const content = makeEl("div");
  content.append(makeEl("p", "", `Delete “${folder.name}”? It contains ${docs.length} document${docs.length === 1 ? "" : "s"}.`));
  if (dirtyCount) {
    content.append(makeEl("p", "modal-hint", `${dirtyCount} document${dirtyCount === 1 ? " has" : "s have"} unsaved changes. Deleting them will discard that content.`));
  } else {
    content.append(makeEl("p", "modal-hint", "Choose whether to keep the documents at the root or delete them too."));
  }
  const choice = await openDialog({
    title: "Delete folder",
    content,
    buttons: [
      { label: "Cancel", value: "cancel" },
      { label: "Move documents to root", value: "root", primary: true },
      { label: `Delete folder + ${docs.length} documents`, value: "delete", danger: true },
    ],
  });
  if (choice !== "root" && choice !== "delete") return;

  const result = removeFolder(state.folders, state.tabs, folder.id, choice === "delete");
  state.folders = result.folders;
  const removed = new Set(result.deletedDocumentIds);
  if (removed.size) {
    for (const tab of state.tabs) if (removed.has(tab.id)) tab.wrap.remove();
    state.tabs = result.documents;
  } else {
    state.tabs = result.documents;
  }
  if (!state.tabs.some((tab) => tab.id === state.activeId)) {
    state.activeId = "";
    const next = state.tabs[0] ?? createTab({ title: "Untitled" });
    activateTab(next.id);
  } else {
    renderTabs();
    updateStatus();
    scheduleSessionSave();
  }
}

async function exportFolder(folder: Folder): Promise<void> {
  const documents = state.tabs.filter((tab) => tab.folderId === folder.id);
  if (!documents.length) {
    toast("This folder has no open documents to export.");
    return;
  }
  const directory = await chooseExportDirectory();
  if (!directory) {
    if (!window.__TAURI__) toast("Folder export requires the desktop app.", true);
    return;
  }
  const files = documents.map((tab) => ({
    name: `${sanitizeFileName(tab.title)}.md`,
    contents: htmlToMarkdown(tab.editor),
  }));
  try {
    const count = await exportMarkdownFiles(directory, files);
    toast(`Exported ${count} document${count === 1 ? "" : "s"} from ${folder.name}.`);
  } catch (error) {
    toast(`Could not export folder: ${errorMessage(error)}`, true);
  }
}

function buildDocHeader(tab: Tab): HTMLElement {
  const header = makeEl("div", "doc-header");
  const titleEl = makeEl("span", "doc-title", tab.title);
  titleEl.title = "Double-click to rename";
  titleEl.addEventListener("dblclick", (event) => {
    event.stopPropagation();
    startRename(tab, titleEl);
  });
  const dot = makeEl("span", "doc-dirty");
  dot.title = "Unsaved changes";
  dot.setAttribute("aria-label", "Unsaved changes");
  dot.hidden = !tab.dirty;
  header.append(titleEl, dot);
  return header;
}

function renderDocHeader(tab: Tab): void {
  tab.editor.setAttribute("aria-label", `${tab.title} document`);
  const existing = tab.wrap.querySelector(".doc-header");
  if (existing) existing.replaceWith(buildDocHeader(tab));
  else tab.wrap.prepend(buildDocHeader(tab));
}

function icon(name: string): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "icon");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#icon-${name}`);
  svg.append(use);
  return svg;
}

function startRename(tab: Tab, label: HTMLElement): void {
  const input = makeEl("input", "tab-rename");
  input.value = tab.title;
  input.setAttribute("aria-label", "Tab name");
  label.replaceWith(input);
  input.focus();
  input.select();

  let finished = false;
  const finish = (commit: boolean) => {
    if (finished) return;
    finished = true;
    const value = input.value.trim();
    if (commit && value) {
      tab.title = uniqueDocumentTitle(value, state.tabs.filter((item) => item.id !== tab.id).map((item) => item.title));
    }
    renderTabs();
    updateDocumentTitle();
    scheduleSessionSave();
  };

  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      input.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      input.onblur = null;
      finish(false);
    }
  });
  input.onblur = () => finish(true);
}

function activateTab(id: string): void {
  const previous = activeTab();
  if (previous) {
    captureSelection(previous);
    clearPendingFormat(previous);
  }

  const tab = state.tabs.find((candidate) => candidate.id === id);
  if (!tab) return;
  state.activeId = id;
  clearPendingFormat(tab);

  for (const other of state.tabs) {
    const isActive = other.id === id;
    other.wrap.classList.toggle("active", isActive);
    other.wrap.hidden = !isActive;
  }

  renderTabs();
  updateDocumentTitle();
  updateStatus();
  updateToolbarState();
  scheduleSessionSave();

  tab.editor.focus({ preventScroll: true });
  if (tab.lastRange && tab.editor.contains(tab.lastRange.startContainer)) {
    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(tab.lastRange);
    }
  } else {
    placeCaretAtEnd(tab.editor);
  }

  finder.refresh();
  scheduleCenter();
}

function newTab(folderId: string | null = null): void {
  const folder = folderId ? state.folders.find((item) => item.id === folderId) : null;
  if (folder) folder.expanded = true;
  const tab = createTab({ folderId });
  activateTab(tab.id);
}

async function closeTab(tab: Tab): Promise<void> {
  if (tab.dirty) {
    const content = makeEl("div");
    content.append(
      makeEl("p", "", `“${tab.title}” has unsaved changes.`),
      makeEl("p", "modal-hint", "Closing it now will lose those changes."),
    );
    const choice = await openDialog({
      title: "Close tab?",
      content,
      buttons: [
        { label: "Cancel", value: "cancel", primary: true },
        { label: "Close without saving", value: "close", danger: true },
      ],
    });
    if (choice !== "close") return;
  }

  const index = state.tabs.indexOf(tab);
  if (index < 0) return;
  state.tabs.splice(index, 1);
  tab.wrap.remove();

  if (!state.tabs.length) {
    const fresh = createTab({});
    activateTab(fresh.id);
  } else if (state.activeId === tab.id) {
    const next = state.tabs[Math.min(index, state.tabs.length - 1)];
    activateTab(next.id);
  } else {
    renderTabs();
    updateStatus();
  }
  saveSessionNow();
}

function cycleTab(delta: number): void {
  if (state.tabs.length < 2) return;
  const index = state.tabs.findIndex((tab) => tab.id === state.activeId);
  if (index < 0) return;
  const next = (index + delta + state.tabs.length) % state.tabs.length;
  activateTab(state.tabs[next].id);
}

// ------------------------------------------------------------ editor state ---

function onEditorInput(tab: Tab): void {
  cleanCarriers(tab);
  ensurePendingCarrier(tab);
  markDirty(tab);
  updateStatus();
  updateToolbarState();
  finder.refresh();
  scheduleSessionSave();
  scheduleCenter();
}

function markDirty(tab: Tab): void {
  if (tab.dirty) return;
  tab.dirty = true;
  renderTabs();
  updateDocumentTitle();
  scheduleSessionSave();
}

function afterEdit(tab: Tab): void {
  markDirty(tab);
  updateStatus();
  finder.refresh();
  scheduleSessionSave();
  scheduleCenter();
}

function updateDocumentTitle(): void {
  const tab = activeTab();
  const title = tab ? `${tab.title}${tab.dirty ? " •" : ""} — Inkwell` : "Inkwell";
  document.title = title;
  setWindowTitle(title);
}

function captureSelection(tab: Tab): void {
  const selection = window.getSelection();
  if (selection && selection.rangeCount && selection.anchorNode && tab.editor.contains(selection.anchorNode)) {
    tab.lastRange = selection.getRangeAt(0).cloneRange();
  }
}

function placeCaretAtEnd(editor: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  const selection = window.getSelection();
  if (!selection) return;
  selection.removeAllRanges();
  selection.addRange(range);
}

function restoreSelection(tab: Tab): boolean {
  const selection = window.getSelection();
  if (!selection) return false;
  if (tab.lastRange && tab.editor.contains(tab.lastRange.startContainer)) {
    selection.removeAllRanges();
    selection.addRange(tab.lastRange);
    return true;
  }
  return false;
}

function prepareEditor(): Tab | null {
  const tab = activeTab();
  if (!tab) return null;
  const selection = window.getSelection();
  const inside = Boolean(
    selection && selection.rangeCount && selection.anchorNode && tab.editor.contains(selection.anchorNode),
  );
  const focused = document.activeElement === tab.editor;
  if (!focused) {
    const liveRange =
      inside && selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
    tab.editor.focus({ preventScroll: true });
    // Re-focusing after a toolbar control may reset the live range to the
    // start, so put back the range captured while the editor had focus.
    if (tab.lastRange && tab.editor.contains(tab.lastRange.startContainer)) {
      selection?.removeAllRanges();
      selection?.addRange(tab.lastRange);
    } else if (liveRange && tab.editor.contains(liveRange.startContainer)) {
      selection?.removeAllRanges();
      selection?.addRange(liveRange);
    } else {
      return null;
    }
  } else if (!inside && !restoreSelection(tab)) {
    // A toolbar control took focus, so the live range is stale. Restoring the
    // last known range is safe; falling back to the end of the document is not,
    // because it would format and type in the wrong place.
    return null;
  }
  return tab;
}

function firstSelectedTextNode(tab: Tab, range: Range): Node | null {
  const walker = document.createTreeWalker(tab.editor, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    try {
      if (!range.intersectsNode(node)) continue;
    } catch {
      continue;
    }
    const start = node === range.startContainer ? range.startOffset : 0;
    const end = node === range.endContainer ? range.endOffset : node.data.length;
    if (end > start) return node;
  }
  return null;
}

function caretElement(tab: Tab): HTMLElement {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return tab.editor;
  const range = selection.getRangeAt(0);

  // WebKit can leave a non-collapsed selection's start boundary at the end of
  // the previous text node, outside the styled span. Use the first selected
  // character so indicators reflect the selection, not the text before it.
  if (!range.collapsed) {
    const selected = firstSelectedTextNode(tab, range);
    const selectedElement = selected ? elementForNode(selected) : null;
    if (selectedElement && tab.editor.contains(selectedElement)) return selectedElement;
  }

  const node = range.startContainer;
  const element = node
    ? node.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : node.parentElement
    : tab.editor;
  return (element && tab.editor.contains(element) ? element : tab.editor) as HTMLElement;
}

function updateStatus(): void {
  const tab = activeTab();
  if (!tab) return;
  const text = tab.editor.innerText;
  const words = countWords(text);
  const chars = countChars(text);
  let line = `${formatNumber(words)} words · ${formatNumber(chars)} characters`;

  const selection = window.getSelection();
  if (selection && selection.rangeCount && tab.editor.contains(selection.anchorNode)) {
    const selected = selectionCounts(selection.toString());
    if (selected) {
      line += ` · selection: ${formatNumber(selected.words)} words / ${formatNumber(selected.chars)} chars`;
    }
  }

  counts.textContent = line;
  fileInfo.textContent = tab.filePath ?? tab.title;
  fileInfo.title = tab.filePath ?? "Not saved yet — Ctrl+S to export Markdown";
}

function updateToolbarState(): void {
  const tab = activeTab();
  if (!tab) return;

  const range = currentRange(tab);
  const collapsed = !range || range.collapsed;
  const element = caretElement(tab);
  const computed = getComputedStyle(element);
  const pending = tab.pending;

  for (const [command, button] of [
    ["bold", toolbar.querySelector<HTMLElement>("[data-cmd='bold']")],
    ["italic", toolbar.querySelector<HTMLElement>("[data-cmd='italic']")],
    ["underline", toolbar.querySelector<HTMLElement>("[data-cmd='underline']")],
  ] as const) {
    if (!button) continue;
    let active = false;
    if (collapsed && pending[command] !== undefined) active = Boolean(pending[command]);
    else {
      try {
        active = document.queryCommandState(command);
      } catch {
        active = false;
      }
    }
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }

  for (const [command, button] of [
    ["insertUnorderedList", toolbar.querySelector<HTMLElement>("[data-cmd='insertUnorderedList']")],
    ["insertOrderedList", toolbar.querySelector<HTMLElement>("[data-cmd='insertOrderedList']")],
  ] as const) {
    if (!button) continue;
    let active = false;
    try {
      active = document.queryCommandState(command);
    } catch {
      active = false;
    }
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }

  try {
    const block = String(document.queryCommandValue("formatBlock")).toLowerCase().replace(/[<>]/g, "");
    blockStyle.value = block === "h1" || block === "h2" ? block : "p";
  } catch {
    blockStyle.value = "p";
  }

  if (document.activeElement !== fontSizeInput) {
    const pendingSize = collapsed && pending.fontSize !== undefined
      ? Number.parseFloat(pending.fontSize ?? "")
      : Number.NaN;
    const size = Number.isFinite(pendingSize)
      ? pendingSize
      : Math.round(Number.parseFloat(computed.fontSize));
    if (Number.isFinite(size)) fontSizeInput.value = String(size);
  }

  const family = collapsed && pending.fontFamily !== undefined && pending.fontFamily
    ? pending.fontFamily
    : computed.fontFamily;
  const primary = family.split(",")[0]?.replace(/["']/g, "").trim() ?? "";
  const option = Array.from(fontFamily.options).find(
    (candidate) => candidate.value.toLowerCase() === primary.toLowerCase(),
  );
  fontFamily.value = option ? option.value : "";

  const pendingColor = collapsed && "color" in pending ? pending.color : undefined;
  const shownColor = pendingColor === undefined ? computed.color : pendingColor ?? computed.color;
  colorBar.style.fill = shownColor;
  const hex = rgbToHex(shownColor);
  if (hex) colorCustom.value = hex;
  const automatic = pendingColor !== undefined
    ? pendingColor === null
    : !inlineAncestor(element, "color") ||
      ["inherit", "initial", "unset"].includes(
        (inlineAncestor(element, "color")?.style.color ?? "").trim().toLowerCase(),
      );
  colorDefault.classList.toggle("active", automatic);

  const pendingBackground = collapsed && "background" in pending ? pending.background : undefined;
  const highlight = pendingBackground !== undefined ? null : highlightAncestor(element);
  const activeBackground = pendingBackground !== undefined
    ? pendingBackground
    : highlight
      ? getComputedStyle(highlight).backgroundColor
      : null;
  highlightButton.classList.toggle("active", Boolean(activeBackground));
  highlightButton.setAttribute("aria-pressed", String(Boolean(activeBackground)));
  highlightPicker.style.setProperty("--swatch", activeBackground || settings.highlightColor);
}

function inlineAncestor(element: HTMLElement, property: string): HTMLElement | null {
  const tab = activeTab();
  for (let node: HTMLElement | null = element; node && node !== tab?.editor; node = node.parentElement) {
    if (node.style.getPropertyValue(property)) return node;
  }
  return null;
}

function highlightAncestor(element: HTMLElement): HTMLElement | null {
  const tab = activeTab();
  for (let node: HTMLElement | null = element; node && node !== tab?.editor; node = node.parentElement) {
    const background = node.style.getPropertyValue("background-color").trim().toLowerCase();
    if (node.tagName === "MARK" || (background && background !== "transparent" && background !== "rgba(0, 0, 0, 0)")) {
      return node;
    }
  }
  return null;
}

function rgbToHex(color: string): string | null {
  const match = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(color);
  if (!match) return /^#[0-9a-f]{6}$/i.test(color) ? color : null;
  return (
    "#" +
    [match[1], match[2], match[3]]
      .map((value) => Math.min(255, Number(value)).toString(16).padStart(2, "0"))
      .join("")
  );
}

// -------------------------------------------------------------- formatting ---

function runCommand(command: string): void {
  const tab = prepareEditor();
  if (!tab) return;
  const range = currentRange(tab);

  if (range?.collapsed && (command === "bold" || command === "italic" || command === "underline")) {
    const current = tab.pending[command] ?? contextAt(tab, range, null)[command];
    setPending(tab, command, !current);
    ensurePendingCarrier(tab, true);
    updateToolbarState();
    scheduleSessionSave();
    return;
  }

  const listCommand = command === "insertUnorderedList" || command === "insertOrderedList";
  const listCaret = listCommand ? captureListCaret(tab) : null;
  if (listCommand) clearPendingFormat(tab);

  try {
    document.execCommand("styleWithCSS", false, "false");
    document.execCommand(command, false);
  } catch {
    return;
  }
  if (listCommand) {
    normalizeListWrappers(tab);
    normalizeTopLevelText(tab);
    if (!restoreListCaret(tab, listCaret)) {
      const item = tab.editor.querySelector("li");
      if (item) placeCaretAtEnd(item);
    }
  }
  tab.pending = {};
  cleanEmptyStyles(tab);
  captureSelection(tab);
  afterEdit(tab);
  updateToolbarState();
}

function historyStep(direction: "undo" | "redo"): void {
  const tab = prepareEditor();
  if (!tab) return;
  tab.pending = {};
  try {
    document.execCommand(direction, false);
  } catch {
    return;
  }
  cleanEmptyStyles(tab);
  captureSelection(tab);
  afterEdit(tab);
  updateToolbarState();
}

function formatBlock(value: string): void {
  const tab = prepareEditor();
  if (!tab) return;
  tab.pending = {};
  try {
    document.execCommand("formatBlock", false, value);
  } catch {
    return;
  }
  captureSelection(tab);
  afterEdit(tab);
  updateToolbarState();
}

function blockOf(node: Node): HTMLElement | null {
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return (element?.closest(BLOCK_SELECTOR) as HTMLElement | null) ?? null;
}

function currentRange(tab: Tab): Range | null {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!tab.editor.contains(range.commonAncestorContainer)) return null;
  return range;
}

/** Chrome sometimes wraps a new list inside the paragraph it came from. */
function normalizeListWrappers(tab: Tab): void {
  for (const block of Array.from(tab.editor.querySelectorAll<HTMLElement>("p,div"))) {
    if (block === tab.editor) continue;
    const nodes = Array.from(block.childNodes);
    const meaningful = nodes.filter(
      (node) =>
        (node.nodeType === Node.ELEMENT_NODE &&
          ["UL", "OL"].includes((node as Element).tagName)) ||
        (node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim()),
    );
    if (meaningful.length === 1 && meaningful[0].nodeType === Node.ELEMENT_NODE) {
      const only = meaningful[0] as Element;
      if (only.tagName === "UL" || only.tagName === "OL") block.replaceWith(only);
    }
  }
}

interface ListCaret {
  text: string;
  offset: number;
  index: number;
}

/**
 * Chrome leaves bare text nodes at the editor root when a list is toggled off.
 * Wrap them in paragraphs so the caret and Markdown export keep working.
 */
function normalizeTopLevelText(tab: Tab): void {
  for (const child of Array.from(tab.editor.children)) {
    if (child.tagName === "BR") child.remove();
  }
  let buffer: Node[] = [];
  const flush = (before: Node | null): void => {
    if (!buffer.length) return;
    if (!buffer.some((node) => (node.textContent ?? "").trim())) {
      buffer.forEach((node) => (node as ChildNode).remove());
      buffer = [];
      return;
    }
    const paragraph = document.createElement("p");
    buffer.forEach((node) => paragraph.append(node));
    tab.editor.insertBefore(paragraph, before);
    buffer = [];
  };
  for (const node of Array.from(tab.editor.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) buffer.push(node);
    else flush(node);
  }
  flush(null);
}

function ownText(element: HTMLElement): string {
  return Array.from(element.childNodes)
    .filter(
      (node) =>
        node.nodeType === Node.TEXT_NODE ||
        (node.nodeType === Node.ELEMENT_NODE &&
          !["UL", "OL"].includes((node as Element).tagName)),
    )
    .map((node) => node.textContent ?? "")
    .join("")
    .replace(/\u200b/g, "");
}

function captureListCaret(tab: Tab): ListCaret | null {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  const block = blockOf(range.endContainer);
  if (!block || block === tab.editor) return null;
  const before = document.createRange();
  before.selectNodeContents(block);
  try {
    before.setEnd(range.endContainer, range.endOffset);
  } catch {
    return null;
  }
  return {
    text: ownText(block),
    offset: before.toString().replace(/\u200b/g, "").length,
    index: Array.from(tab.editor.children).indexOf(block),
  };
}

function placeCaretAtTextOffset(element: HTMLElement, offset: number): void {
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, offset);
  const range = document.createRange();
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (remaining <= node.data.length) {
      range.setStart(node, remaining);
      range.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return;
    }
    remaining -= node.data.length;
  }
  range.selectNodeContents(element);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/**
 * Restore the caret by block text and character offset. A live Range cannot be
 * used here: Chrome replaces the original text node when toggling a list, and
 * a cloned Range then collapses to the start of the editor.
 */
function restoreListCaret(tab: Tab, saved: ListCaret | null): boolean {
  if (!saved) return false;
  const candidates = Array.from(
    tab.editor.querySelectorAll<HTMLElement>("li,p,div,h1,h2,h3,h4,h5,h6"),
  ).filter((element) => element !== tab.editor && ownText(element) === saved.text);
  if (!candidates.length) return false;
  const candidate =
    candidates.find((element) => Array.from(tab.editor.children).indexOf(element) === saved.index) ??
    candidates[0];
  placeCaretAtTextOffset(candidate, Math.min(saved.offset, ownText(candidate).length));
  return true;
}

/** Native commands leave style="" behind when they merge formatting. */
function cleanEmptyStyles(tab: Tab): void {
  for (const element of Array.from(tab.editor.querySelectorAll<HTMLElement>("[style]"))) {
    if (!element.getAttribute("style")?.trim()) element.removeAttribute("style");
  }
  for (const span of Array.from(tab.editor.querySelectorAll<HTMLElement>("span"))) {
    if (span.classList.contains("caret-style")) continue;
    if (!span.attributes.length) span.replaceWith(...Array.from(span.childNodes));
  }
}

function setPending<K extends keyof PendingFormat>(tab: Tab, key: K, value: PendingFormat[K]): void {
  tab.pending[key] = value;
}

function clearPendingFormat(tab: Tab): void {
  tab.pending = {};
  const selection = window.getSelection();
  const anchor = selection?.anchorNode ?? null;
  for (const span of Array.from(tab.editor.querySelectorAll<HTMLElement>(".caret-style"))) {
    if (anchor && span.contains(anchor)) continue;
    if (!carrierHasText(span)) span.remove();
  }
}

/** Strip the invisible carrier marker wherever real text has been typed. */
function cleanCarriers(tab: Tab): void {
  const selection = window.getSelection();
  for (const span of Array.from(tab.editor.querySelectorAll<HTMLElement>(".caret-style"))) {
    stripCarrierMarker(span, selection);
  }
}

function inlineValue(
  element: HTMLElement | null,
  property: string,
  skip: HTMLElement | null = null,
): string | null {
  const tab = activeTab();
  for (let node: HTMLElement | null = element; node && node !== tab?.editor; node = node.parentElement) {
    if (node === skip) continue;
    const value = node.style?.getPropertyValue(property);
    if (value) return value;
  }
  return null;
}

function backgroundAt(element: HTMLElement | null, skip: HTMLElement | null = null): string | null {
  const tab = activeTab();
  for (let node: HTMLElement | null = element; node && node !== tab?.editor; node = node.parentElement) {
    if (node === skip) continue;
    if (node.tagName === "MARK") {
      const highlight = rgbToHex(getComputedStyle(node).backgroundColor);
      if (highlight) return highlight;
    }
    const value = (node.style?.getPropertyValue("background-color") ?? "").trim();
    if (!value) continue;
    const lower = value.toLowerCase();
    if (lower === "transparent" || /rgba?\([^)]*,\s*0(?:\.0+)?\)$/.test(lower)) continue;
    const color = rgbToHex(value);
    if (color) return color;
  }
  return null;
}

const INHERITED_COLORS = new Set(["inherit", "initial", "unset", "currentcolor"]);

/**
 * Resolve the inline formatting around a range. `skip` ignores one carrier so
 * an empty carrier can be restyled against the text that surrounds it.
 */
function contextAt(tab: Tab, range: Range, skip: HTMLElement | null): InlineContext {
  const node = range.startContainer;
  const initial = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  const element = initial && tab.editor.contains(initial) ? (initial as HTMLElement) : tab.editor;
  const boolElement = skip && skip.contains(element) ? skip.parentElement ?? tab.editor : element;
  const computed = getComputedStyle(boolElement);
  const weight = Number.parseInt(computed.fontWeight, 10);
  const colorValue = inlineValue(element, "color", skip);
  const sizeValue = inlineValue(element, "font-size", skip);
  const familyValue = inlineValue(element, "font-family", skip);
  return {
    bold: Number.isFinite(weight) ? weight >= 600 : computed.fontWeight === "bold",
    italic: computed.fontStyle === "italic" || computed.fontStyle === "oblique",
    underline: computed.textDecorationLine.includes("underline"),
    color:
      colorValue && !INHERITED_COLORS.has(colorValue.trim().toLowerCase())
        ? rgbToHex(colorValue)
        : null,
    fontSize:
      sizeValue && !INHERITED_COLORS.has(sizeValue.trim().toLowerCase()) ? sizeValue : null,
    fontFamily:
      familyValue && !INHERITED_COLORS.has(familyValue.trim().toLowerCase()) ? familyValue : null,
    background: backgroundAt(element, skip),
  };
}

function applyCarrierStyle(span: HTMLElement, style: string): void {
  if (style) span.setAttribute("style", style);
  else span.removeAttribute("style");
}

/**
 * When a color or highlight is changed at the end of a differently styled run,
 * insert the caret after that run instead of nesting a reset inside it. A flat
 * structure keeps the visual result and the exported Markdown unambiguous.
 */
function escapeStyledAncestor(tab: Tab, range: Range): boolean {
  const wantsColor = tab.pending.color !== undefined;
  const wantsBackground = tab.pending.background !== undefined;
  if (!wantsColor && !wantsBackground) return false;
  const block = blockOf(range.startContainer);
  if (!block || block === tab.editor) return false;
  const pendingColor = tab.pending.color === null ? null : rgbToHex(tab.pending.color ?? "");
  const pendingBackground =
    tab.pending.background === null ? null : rgbToHex(tab.pending.background ?? "");

  let target: HTMLElement | null = null;
  let node = elementForNode(range.startContainer);
  while (node && node !== block && node !== tab.editor) {
    const colorDiffers =
      wantsColor && Boolean(node.style.color) && rgbToHex(node.style.color) !== pendingColor;
    const backgroundDiffers =
      wantsBackground &&
      (Boolean(node.style.backgroundColor) || node.tagName === "MARK") &&
      rgbToHex(node.style.backgroundColor) !== pendingBackground;
    if (colorDiffers || backgroundDiffers) target = node;
    node = node.parentElement;
  }
  if (!target) return false;

  const trailing = document.createRange();
  try {
    trailing.setStart(range.startContainer, range.startOffset);
    trailing.setEnd(target, target.childNodes.length);
  } catch {
    return false;
  }
  if (trailing.toString().replace(/\u200b/g, "").length) return false;

  const placement = document.createRange();
  placement.setStartAfter(target);
  placement.collapse(true);
  // An unstyled carrier keeps the next keystroke out of the previous styled
  // span, which would otherwise swallow it and lose the reset.
  const span = document.createElement("span");
  span.className = "caret-style";
  const style = carrierStyle(tab.pending, contextAt(tab, placement, null));
  if (style) span.setAttribute("style", style);
  span.append(document.createTextNode("\u200b"));
  placement.insertNode(span);
  const inside = document.createRange();
  inside.setStart(span.firstChild as Text, 1);
  inside.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(inside);
  return true;
}

/**
 * Keep a pending format attached to the caret. The pending object, not the
 * DOM, is the source of truth: when Backspace removes the last formatted
 * character (and the browser removes its span), the next call rebuilds one.
 */
function ensurePendingCarrier(tab: Tab, forceNew = false): void {
  if (!hasPendingFormat(tab.pending)) return;
  const range = currentRange(tab);
  if (!range || !range.collapsed) return;
  // A lost selection can sit on the editor root. Do not create an inline
  // carrier beside block children; wait until the caret is inside a block.
  if (range.startContainer === tab.editor && tab.editor.firstElementChild) return;
  if (forceNew && escapeStyledAncestor(tab, range)) return;
  const selection = window.getSelection();
  const element = elementForNode(range.startContainer);
  const existing = (element?.closest(".caret-style") as HTMLElement | null) ?? null;

  if (existing && tab.editor.contains(existing)) {
    stripCarrierMarker(existing, selection);
    if (!forceNew || !carrierHasText(existing)) {
      applyCarrierStyle(existing, carrierStyle(tab.pending, contextAt(tab, range, existing)));
      return;
    }
  }

  const style = carrierStyle(tab.pending, contextAt(tab, range, null));
  if (!style) return;
  const span = insertCarrier(range, style);
  if (!span) return;
  const text = span.firstChild;
  const inside = document.createRange();
  if (text) inside.setStart(text, 1);
  else inside.setStart(span, 0);
  inside.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(inside);
}

function editorLineHeight(tab: Tab): number {
  return Number.parseFloat(getComputedStyle(tab.editor).lineHeight) || 24;
}

function lastContentBlock(tab: Tab): HTMLElement | null {
  const blocks = Array.from(tab.editor.children).filter(
    (element): element is HTMLElement => BLOCK_TAGS.has(element.tagName),
  );
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block.tagName === "UL" || block.tagName === "OL") {
      if (block.querySelector("li")) return block;
      continue;
    }
    if ((block.textContent ?? "").replace(/[\s\u200b\u00a0]/g, "")) return block;
  }
  return blocks[blocks.length - 1] ?? null;
}

function contentBottom(tab: Tab): number {
  const block = lastContentBlock(tab);
  if (!block) return tab.editor.getBoundingClientRect().top;
  const range = document.createRange();
  range.selectNodeContents(block);
  const rect = range.getBoundingClientRect();
  return rect.height ? rect.bottom : block.getBoundingClientRect().bottom;
}

function appendBlankLine(tab: Tab): HTMLElement {
  const line = document.createElement("p");
  line.append(document.createElement("br"));
  tab.editor.append(line);
  return line;
}

function placeCaretInBlock(block: HTMLElement): void {
  const range = document.createRange();
  const br = block.querySelector(":scope > br");
  if (br) {
    range.setStartBefore(br);
    range.collapse(true);
  } else {
    range.selectNodeContents(block);
    range.collapse(false);
  }
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function placeCaretBelowLastLine(tab: Tab, y: number): void {
  if (y <= contentBottom(tab) + editorLineHeight(tab) * 0.9) return;
  const line = appendBlankLine(tab);
  placeCaretInBlock(line);
  markDirty(tab);
  scheduleSessionSave();
  scheduleCenter();
}

function placeCaretInPage(tab: Tab, x: number, y: number): void {
  const box = tab.editor.getBoundingClientRect();
  tab.editor.focus({ preventScroll: true });
  if (y > box.bottom || y > contentBottom(tab) + editorLineHeight(tab) * 1.2) {
    const line = appendBlankLine(tab);
    placeCaretInBlock(line);
    markDirty(tab);
    scheduleSessionSave();
    scheduleCenter();
    return;
  }
  const clampedX = Math.min(box.right - 8, Math.max(box.left + 8, x));
  const doc = document as Document & {
    caretRangeFromPoint?: (pointX: number, pointY: number) => Range | null;
  };
  const caret = doc.caretRangeFromPoint?.(clampedX, y) ?? null;
  const selection = window.getSelection();
  if (caret && selection && tab.editor.contains(caret.startContainer)) {
    selection.removeAllRanges();
    selection.addRange(caret);
    return;
  }
  placeCaretAtEnd(tab.editor);
}

function caretOnLastLine(tab: Tab): boolean {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return false;
  const range = selection.getRangeAt(0);
  if (!range.collapsed) return false;
  const block = blockOf(range.startContainer);
  if (!block) return false;
  const item = block.closest("li");
  const top = item ? item.parentElement?.parentElement : block;
  const last = tab.editor.lastElementChild;
  if (!top || top !== last) return false;
  if (top.tagName === "UL" || top.tagName === "OL") return false;
  const rect = range.getBoundingClientRect();
  if (!rect.height) return true;
  return rect.bottom >= block.getBoundingClientRect().bottom - editorLineHeight(tab) * 0.75;
}

function applyInlineStyle(property: "color" | "font-size" | "font-family", value: string | null): void {
  const tab = prepareEditor();
  if (!tab) return;
  const range = currentRange(tab);
  if (!range) return;

  if (range.collapsed) {
    if (property === "font-size" && !value) return;
    const key = property === "color" ? "color" : property === "font-size" ? "fontSize" : "fontFamily";
    setPending(tab, key, value);
    ensurePendingCarrier(tab, true);
    updateToolbarState();
    scheduleSessionSave();
    return;
  }

  tab.pending = {};
  if (property === "font-size") {
    if (!value) return;
    applyFontSizeToSelection(tab, value);
  } else if (property === "color" && value === null) {
    // "inherit" keeps the default automatic instead of baking black/white in.
    try {
      document.execCommand("styleWithCSS", false, "true");
      document.execCommand("foreColor", false, "inherit");
    } catch {
      removeInlineProperty(tab, range, "color");
    }
  } else {
    try {
      document.execCommand("styleWithCSS", false, "true");
      document.execCommand(property === "color" ? "foreColor" : "fontName", false, value ?? "");
    } catch {
      return;
    }
  }

  cleanEmptyStyles(tab);
  captureSelection(tab);
  afterEdit(tab);
  updateToolbarState();
}

/**
 * Font size has no native px command. Apply the native size-7 command first
 * (so undo works), then rewrite that span to the exact pixel value.
 */
function applyFontSizeToSelection(tab: Tab, value: string): void {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return;
  const original = selection.getRangeAt(0).cloneRange();

  try {
    document.execCommand("styleWithCSS", false, "true");
    document.execCommand("fontSize", false, "7");
  } catch {
    applyFontSizeDirect(tab, original, value);
    return;
  }

  const current = selection.rangeCount ? selection.getRangeAt(0) : original;
  const candidates = Array.from(
    tab.editor.querySelectorAll<HTMLElement>('span[style*="font-size"], font[size="7"]'),
  ).filter((element) => {
    const size = element.style.fontSize.toLowerCase();
    if (element.tagName !== "FONT" && size !== "xxx-large" && size !== "-webkit-xxx-large") return false;
    try {
      return current.intersectsNode(element) || original.intersectsNode(element);
    } catch {
      return false;
    }
  });

  if (!candidates.length) {
    applyFontSizeDirect(tab, original, value);
    return;
  }

  for (const element of candidates) {
    if (element.tagName === "FONT") {
      const span = document.createElement("span");
      if (element.getAttribute("style")) span.setAttribute("style", element.getAttribute("style") ?? "");
      span.style.fontSize = value;
      while (element.firstChild) span.append(element.firstChild);
      element.replaceWith(span);
      continue;
    }
    element.style.fontSize = value;
    for (const inner of Array.from(element.querySelectorAll<HTMLElement>('[style*="font-size"]'))) {
      inner.style.removeProperty("font-size");
      if (!inner.getAttribute("style")?.trim()) inner.removeAttribute("style");
    }
  }
  cleanEmptyStyles(tab);
}

/** Fallback for browsers that do not produce a size-7 wrapper. */
function applyFontSizeDirect(tab: Tab, range: Range, value: string): void {
  const startBlock = blockOf(range.startContainer);
  const endBlock = blockOf(range.endContainer);

  if (startBlock && endBlock && startBlock !== endBlock) {
    for (const block of tab.editor.querySelectorAll<HTMLElement>(BLOCK_SELECTOR)) {
      if (!range.intersectsNode(block) || !block.textContent?.trim()) continue;
      if (Array.from(block.children).some((child) => BLOCK_TAGS.has(child.tagName))) continue;
      const span = document.createElement("span");
      span.style.setProperty("font-size", value);
      while (block.firstChild) span.append(block.firstChild);
      block.append(span);
    }
    return;
  }

  const span = document.createElement("span");
  span.style.setProperty("font-size", value);
  try {
    span.append(range.extractContents());
    range.insertNode(span);
  } catch {
    return;
  }
  const wrapped = document.createRange();
  wrapped.selectNodeContents(span);
  const selection = window.getSelection();
  if (selection) {
    selection.removeAllRanges();
    selection.addRange(wrapped);
  }
}

function removeInlineProperty(tab: Tab, range: Range, property: string): void {
  for (const element of Array.from(tab.editor.querySelectorAll<HTMLElement>("[style]"))) {
    try {
      if (!range.intersectsNode(element)) continue;
    } catch {
      continue;
    }
    element.style.removeProperty(property);
    if (!element.getAttribute("style")?.trim()) element.removeAttribute("style");
  }
}

function changeFontSize(delta: number): void {
  const tab = activeTab();
  if (!tab) return;
  const range = currentRange(tab);
  const pendingSize = range?.collapsed ? tab.pending.fontSize : undefined;
  const baseSize = pendingSize !== undefined
    ? Number.parseFloat(pendingSize ?? "")
    : Number.parseFloat(getComputedStyle(caretElement(tab)).fontSize);
  const size = clampFontSize(Number.isFinite(baseSize) ? baseSize : 17);
  const next = nextFontSize(size, delta > 0 ? 1 : -1);
  fontSizeInput.value = String(next);
  applyInlineStyle("font-size", `${next}px`);
}

function applyFontSize(): void {
  const size = clampFontSize(Math.round(Number(fontSizeInput.value) || 17));
  fontSizeInput.value = String(size);
  applyInlineStyle("font-size", `${size}px`);
}

// ---------------------------------------------------------------- highlight ---

function elementForNode(node: Node | null): HTMLElement | null {
  if (!node) return null;
  return node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement;
}

function hasHighlightAt(node: Node | null): boolean {
  const tab = activeTab();
  for (let element = elementForNode(node); element && element !== tab?.editor; element = element.parentElement) {
    if (element.tagName === "MARK") return true;
    const background = element.style.backgroundColor;
    if (background && background !== "transparent" && background !== "rgba(0, 0, 0, 0)") return true;
  }
  return false;
}

function selectionHasHighlight(range: Range): boolean {
  return hasHighlightAt(range.startContainer) && hasHighlightAt(range.endContainer);
}

function applyHighlight(color: string | null): void {
  const tab = prepareEditor();
  if (!tab) return;
  const range = currentRange(tab);
  if (!range) return;

  if (range.collapsed) {
    setPending(tab, "background", color);
    ensurePendingCarrier(tab, true);
    updateToolbarState();
    scheduleSessionSave();
    return;
  }

  tab.pending = {};
  const marks = color === null
    ? Array.from(tab.editor.querySelectorAll("mark")).filter((mark) => {
        try {
          return range.intersectsNode(mark);
        } catch {
          return false;
        }
      })
    : [];
  const selection = marks.length ? window.getSelection() : null;
  const savedSelection = selection
    ? {
        anchor: selection.anchorNode,
        anchorOffset: selection.anchorOffset,
        focus: selection.focusNode,
        focusOffset: selection.focusOffset,
      }
    : null;

  // <mark> styling comes from CSS, so hiliteColor cannot clear part of it.
  // Convert only intersecting marks to inline spans first; the native command
  // can then split the span at the selection boundaries without touching the
  // unselected highlighted text.
  for (const mark of marks) {
    const span = document.createElement("span");
    span.style.backgroundColor = getComputedStyle(mark).backgroundColor;
    while (mark.firstChild) span.append(mark.firstChild);
    mark.replaceWith(span);
  }

  if (
    selection &&
    savedSelection?.anchor &&
    savedSelection.focus &&
    tab.editor.contains(savedSelection.anchor) &&
    tab.editor.contains(savedSelection.focus)
  ) {
    selection.setBaseAndExtent(
      savedSelection.anchor,
      savedSelection.anchorOffset,
      savedSelection.focus,
      savedSelection.focusOffset,
    );
  }

  try {
    document.execCommand("styleWithCSS", false, "true");
    document.execCommand("hiliteColor", false, color ?? "transparent");
  } catch {
    if (color === null) {
      removeInlineProperty(tab, range, "background-color");
    } else {
      return;
    }
  }

  cleanEmptyStyles(tab);
  captureSelection(tab);
  afterEdit(tab);
  updateToolbarState();
}

function toggleHighlight(): void {
  const tab = activeTab();
  if (!tab) return;
  const range = currentRange(tab);
  if (range?.collapsed) {
    const current = tab.pending.background !== undefined
      ? tab.pending.background
      : backgroundAt(caretElement(tab));
    applyHighlight(current ? null : settings.highlightColor);
    return;
  }
  if (range && !range.collapsed && selectionHasHighlight(range)) {
    applyHighlight(null);
  } else {
    applyHighlight(settings.highlightColor);
  }
}

function setHighlightColor(color: string | null): void {
  if (color) {
    settings.highlightColor = color;
    saveSettings();
    renderHighlightSwatches();
  }
  applyHighlight(color);
}

function applyColor(color: string | null): void {
  if (color) {
    colorBar.style.fill = color;
    colorCustom.value = color;
  }
  colorDefault.classList.toggle("active", color === null);
  applyInlineStyle("color", color);
}

function closeColorPopover(restoreFocus = false): void {
  colorPopover.hidden = true;
  colorButton.setAttribute("aria-expanded", "false");
  if (restoreFocus) colorButton.focus();
}

function closeHighlightPopover(restoreFocus = false): void {
  highlightPopover.hidden = true;
  highlightPicker.setAttribute("aria-expanded", "false");
  if (restoreFocus) highlightPicker.focus();
}

// ------------------------------------------------------------------ files ---

function sanitizeFileName(title: string): string {
  const cleaned = title.replace(/[\\/:*?"<>|]+/g, "-").trim();
  return cleaned || "untitled";
}

async function saveActive(askForPath: boolean): Promise<boolean> {
  const tab = activeTab();
  if (!tab) return false;
  const markdown = htmlToMarkdown(tab.editor);
  const defaultName = `${sanitizeFileName(tab.title)}.md`;

  try {
    const saved = await saveMarkdownFile(
      defaultName,
      markdown,
      tab.filePath,
      askForPath || !tab.filePath,
    );
    if (!saved) return false;
    tab.filePath = saved.path;
    tab.fileName = saved.name;
    if (tab.title === "Untitled" || !tab.title.trim()) {
      tab.title = uniqueDocumentTitle(
        stripExtension(saved.name),
        state.tabs.filter((item) => item.id !== tab.id).map((item) => item.title),
      );
      tab.editor.setAttribute("aria-label", `${tab.title} document`);
    }
    tab.dirty = false;
    renderTabs();
    updateDocumentTitle();
    updateStatus();
    saveSessionNow();
    toast(`Saved ${saved.name}`);
    return true;
  } catch (error) {
    toast(`Could not save: ${errorMessage(error)}`, true);
    return false;
  }
}

async function openFile(): Promise<void> {
  try {
    const file = await openMarkdownFile();
    if (!file) return;
    importText(file.name, file.text, file.path);
  } catch (error) {
    toast(`Could not open file: ${errorMessage(error)}`, true);
  }
}

async function openStartupFiles(): Promise<void> {
  try {
    const files = await startupMarkdownFiles();
    for (const file of files) importText(file.name, file.text, file.path);
  } catch (error) {
    toast(`Could not open file: ${errorMessage(error)}`, true);
  }
}

function importText(name: string, text: string, path: string | null): void {
  let html: string;
  try {
    html = markdownToHtml(text);
  } catch (error) {
    toast(`Could not read ${name}: ${errorMessage(error)}`, true);
    return;
  }
  const tab = createTab({
    title: stripExtension(name),
    html,
    fileName: name,
    filePath: path,
    dirty: false,
  });
  activateTab(tab.id);
  toast(`Opened ${name}`);
}

function onPaste(event: ClipboardEvent): void {
  event.preventDefault();
  const data = event.clipboardData;
  if (!data) return;
  const html = data.getData("text/html");
  if (html) {
    document.execCommand("insertHTML", false, sanitizeHtml(html));
  } else {
    document.execCommand("insertText", false, data.getData("text/plain"));
  }
  const tab = activeTab();
  if (tab) afterEdit(tab);
}

// ------------------------------------------------------ focus + typewriter ---

function enterFocus(): void {
  state.focus = true;
  document.body.classList.add("focus");
  focusButton.setAttribute("aria-pressed", "true");
  scheduleCenter();
}

function exitFocus(): void {
  state.focus = false;
  state.typewriter = false;
  document.body.classList.remove("focus", "typewriter", "chrome");
  focusButton.setAttribute("aria-pressed", "false");
  typewriterButton.setAttribute("aria-pressed", "false");
  window.clearTimeout(state.chromeTimer);
  activeTab()?.editor.focus({ preventScroll: true });
}

function toggleFocus(): void {
  if (state.focus) exitFocus();
  else enterFocus();
}

function toggleTypewriter(): void {
  if (state.typewriter) {
    exitFocus();
    return;
  }
  state.typewriter = true;
  document.body.classList.add("typewriter");
  typewriterButton.setAttribute("aria-pressed", "true");
  enterFocus();
  audio.ensure();
  toast("Typewriter mode on — Esc to exit");
  scheduleCenter();
}

function revealChrome(): void {
  if (!state.focus) return;
  document.body.classList.add("chrome");
  window.clearTimeout(state.chromeTimer);
  state.chromeTimer = window.setTimeout(() => document.body.classList.remove("chrome"), 3000);
}

function scheduleCenter(): void {
  if (!state.typewriter) return;
  cancelAnimationFrame(centerFrame);
  centerFrame = requestAnimationFrame(centerCaret);
}

function centerCaret(): void {
  if (!state.typewriter) return;
  const tab = activeTab();
  const selection = window.getSelection();
  if (!tab || !selection || !selection.rangeCount) return;

  const range = selection.getRangeAt(0).cloneRange();
  let rect = range.getBoundingClientRect();
  if (!rect.height && !rect.width) {
    const node = range.startContainer;
    const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    if (!element) return;
    rect = element.getBoundingClientRect();
  }

  const box = tab.wrap.getBoundingClientRect();
  if (!box.height) return;
  const lineHeight = Number.parseFloat(getComputedStyle(tab.editor).lineHeight) || 24;
  const caretCenter = rect.top + (rect.height || lineHeight) / 2;
  tab.wrap.scrollTop += caretCenter - (box.top + box.height / 2);
}

let lastKeySoundAt = 0;

/**
 * Sounds are driven by keydown, not input, so they stay ahead of a slow input
 * handler. Modifier-only keys and shortcuts are silent; key repeat is capped
 * so a held key cannot pile up clicks.
 */
function playKeySound(event: KeyboardEvent): void {
  if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
  if (event.key === "Tab" && event.shiftKey) return;
  const key = event.key;
  const edits =
    key === "Enter" ||
    key === "Backspace" ||
    key === "Delete" ||
    key === "Tab" ||
    key === " " ||
    key.length === 1;
  if (!edits) return;
  const now = performance.now();
  if (event.repeat && now - lastKeySoundAt < 32) return;
  lastKeySoundAt = now;
  if (key === "Enter") audio.play("enter");
  else if (key === "Backspace" || key === "Delete") audio.play("backspace");
  else if (key === " ") audio.play("space");
  else audio.play("key");
}

function caretAtStartOfItem(item: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return false;
  const range = selection.getRangeAt(0);
  if (!range.collapsed || !item.contains(range.startContainer)) return false;
  const before = document.createRange();
  before.selectNodeContents(item);
  try {
    before.setEnd(range.startContainer, range.startOffset);
  } catch {
    return false;
  }
  return before.toString().replace(/\u200b/g, "").length === 0;
}

/** Backspace at the start of an item removes only its bullet, not its text. */
function unlistItem(tab: Tab, item: HTMLElement): void {
  const list = item.parentElement;
  if (!list || (list.tagName !== "UL" && list.tagName !== "OL")) return;
  const paragraph = document.createElement("p");
  const nested: HTMLElement[] = [];
  for (const node of Array.from(item.childNodes)) {
    if (
      node.nodeType === Node.ELEMENT_NODE &&
      ["UL", "OL"].includes((node as Element).tagName)
    ) {
      nested.push(node as HTMLElement);
    } else {
      paragraph.append(node);
    }
  }

  const hasPrevious = Boolean(item.previousElementSibling);
  const hasFollowing = Boolean(item.nextElementSibling);
  const insertion: HTMLElement = paragraph;
  if (hasPrevious && hasFollowing) {
    const tail = list.cloneNode(false) as HTMLElement;
    while (item.nextSibling) tail.append(item.nextSibling);
    list.after(paragraph);
    paragraph.after(tail);
  } else if (hasPrevious) {
    list.after(paragraph);
  } else {
    list.before(paragraph);
  }
  item.remove();
  if (!list.querySelector("li")) list.remove();

  let anchor: HTMLElement = insertion;
  for (const node of nested) {
    anchor.after(node);
    anchor = node;
  }

  const range = document.createRange();
  range.selectNodeContents(paragraph);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);

  tab.pending = {};
  markDirty(tab);
  updateStatus();
  updateToolbarState();
  scheduleSessionSave();
  scheduleCenter();
}

function listItemAt(tab: Tab): HTMLElement | null {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return null;
  const element = elementForNode(selection.getRangeAt(0).startContainer);
  const item = element?.closest("li") as HTMLElement | null;
  return item && tab.editor.contains(item) ? item : null;
}

/**
 * Enter on an empty item ends the list instead of leaving another empty
 * bullet behind. Nested lists exit at the outermost level.
 */
function exitEmptyListItem(tab: Tab, item: HTMLElement): boolean {
  if (ownText(item).trim() || item.querySelector(":scope > ul, :scope > ol")) return false;
  const list = item.parentElement;
  if (!list || (list.tagName !== "UL" && list.tagName !== "OL")) return false;

  let outer: HTMLElement = list;
  while (outer.parentElement) {
    const parentList = outer.parentElement.closest("ul,ol");
    if (!parentList) break;
    outer = parentList as HTMLElement;
  }

  const paragraph = document.createElement("p");
  paragraph.append(document.createElement("br"));

  let topItem: HTMLElement = item;
  while (topItem.parentElement && topItem.parentElement !== outer) {
    const parentItem = topItem.parentElement.closest("li") as HTMLElement | null;
    if (!parentItem) break;
    topItem = parentItem;
  }

  const atTop = topItem === item;
  const hasPrevious = Boolean(atTop && topItem.previousElementSibling);
  const hasFollowing = Boolean(atTop && topItem.nextElementSibling);
  if (atTop && hasPrevious && hasFollowing) {
    const tail = outer.cloneNode(false) as HTMLElement;
    while (topItem.nextSibling) tail.append(topItem.nextSibling);
    outer.after(paragraph);
    paragraph.after(tail);
  } else if (atTop && hasFollowing) {
    outer.before(paragraph);
  } else {
    outer.after(paragraph);
  }
  item.remove();

  let cursor: HTMLElement | null = list;
  while (
    cursor &&
    (cursor.tagName === "UL" || cursor.tagName === "OL") &&
    !cursor.querySelector("li")
  ) {
    const next = cursor.parentElement?.closest("ul,ol") as HTMLElement | null;
    cursor.remove();
    cursor = next;
  }

  placeCaretInBlock(paragraph);
  tab.pending = {};
  markDirty(tab);
  updateStatus();
  updateToolbarState();
  scheduleSessionSave();
  scheduleCenter();
  return true;
}

function placeCaretInListItem(item: HTMLElement): void {
  const range = document.createRange();
  const nested = item.querySelector(":scope > ul, :scope > ol");
  if (nested) {
    range.setStartBefore(nested);
    range.collapse(true);
  } else {
    range.selectNodeContents(item);
    range.collapse(false);
  }
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/** Tab nests under the previous item; Shift+Tab lifts one level back out. */
function moveListItem(item: HTMLElement, outdent: boolean): void {
  const list = item.parentElement;
  if (!list || (list.tagName !== "UL" && list.tagName !== "OL")) return;

  if (!outdent) {
    const previous = item.previousElementSibling;
    if (!previous || previous.tagName !== "LI") return;
    let nested = previous.querySelector(":scope > ul, :scope > ol") as HTMLElement | null;
    if (!nested) {
      nested = document.createElement(list.tagName.toLowerCase());
      previous.append(nested);
    }
    nested.append(item);
  } else {
    const parentItem = list.parentElement;
    if (!parentItem || parentItem.tagName !== "LI") return;
    parentItem.after(item);
    if (!list.querySelector("li")) list.remove();
  }

  placeCaretInListItem(item);
  const tab = activeTab();
  if (tab) {
    markDirty(tab);
    updateToolbarState();
    scheduleSessionSave();
    scheduleCenter();
  }
}

function onEditorKeydown(event: KeyboardEvent): void {
  const tab = activeTab();
  if (!tab) return;
  playKeySound(event);

  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown", "Escape"].includes(event.key)) {
    clearPendingFormat(tab);
  }

  if (
    event.key === "Enter" &&
    !event.isComposing &&
    !event.shiftKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey
  ) {
    const item = listItemAt(tab);
    if (item && exitEmptyListItem(tab, item)) {
      event.preventDefault();
      return;
    }
  }

  if (
    event.key === "Backspace" &&
    !event.isComposing &&
    !event.shiftKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey
  ) {
    const item = listItemAt(tab);
    if (item && caretAtStartOfItem(item)) {
      event.preventDefault();
      unlistItem(tab, item);
      return;
    }
  }

  if (event.key === "Tab" && !event.isComposing && !event.ctrlKey && !event.metaKey && !event.altKey) {
    const item = listItemAt(tab);
    if (item) {
      event.preventDefault();
      moveListItem(item, event.shiftKey);
      return;
    }
  }

  if (
    event.key === "ArrowDown" &&
    !event.isComposing &&
    !event.shiftKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    caretOnLastLine(tab)
  ) {
    event.preventDefault();
    placeCaretInBlock(appendBlankLine(tab));
    markDirty(tab);
    scheduleSessionSave();
    scheduleCenter();
    updateToolbarState();
    return;
  }

  if (state.typewriter) scheduleCenter();
}

// ------------------------------------------------------------------ timer ---

function showSummary(summary: TimerSummary): void {
  const content = makeEl("div", "summary");
  const rows: Array<[string, string]> = [
    ["Mode", summary.mode === "countdown" ? "Countdown" : "Stopwatch"],
    ["Elapsed", formatDuration(summary.elapsedMs)],
  ];
  if (summary.wordTracking) {
    rows.push(
      ["Words written", formatNumber(summary.words)],
      ["Words per minute", formatNumber(summary.wpm)],
    );
  }
  for (const [label, value] of rows) {
    const row = makeEl("div", "summary-row");
    row.append(makeEl("span", "summary-label", label), makeEl("strong", "summary-value", value));
    content.append(row);
  }
  void openDialog({
    title: summary.mode === "countdown" ? "Countdown complete" : "Session summary",
    content,
    buttons: [{ label: "Done", value: "done", primary: true }],
  });
}

// ------------------------------------------------------------- shortcuts ----

function showShortcuts(): void {
  const groups: Array<[string, Array<[string, string]>]> = [
    ["File and tabs", [
      ["Ctrl+T", "New tab"],
      ["Ctrl+W", "Close tab"],
      ["F2", "Rename the current tab"],
      ["Ctrl+O", "Open Markdown"],
      ["Ctrl+S", "Save / export Markdown"],
      ["Ctrl+Shift+S", "Save As"],
      ["Ctrl+PageDown / Ctrl+Tab", "Next tab"],
      ["Ctrl+PageUp / Ctrl+Shift+Tab", "Previous tab"],
      ["Ctrl+1…9", "Jump to tab"],
    ]],
    ["Formatting", [
      ["Ctrl+B", "Bold"],
      ["Ctrl+I", "Italic"],
      ["Ctrl+U", "Underline"],
      ["Ctrl+Shift+H", "Highlight"],
      ["Ctrl+Shift+8 / Ctrl+Shift+7", "Bullet / numbered list"],
      ["Tab / Shift+Tab (in a list)", "Indent / outdent list item"],
      ["Ctrl+Alt+0 / 1 / 2", "Normal text / Heading 1 / Heading 2"],
      ["Ctrl+= / Ctrl+-", "Increase / decrease font size"],
      ["Ctrl+Z / Ctrl+Shift+Z", "Undo / redo"],
    ]],
    ["Find and replace", [
      ["Ctrl+F", "Find"],
      ["Ctrl+H", "Find and replace"],
      ["Enter / Shift+Enter", "Next / previous match"],
      ["Esc", "Close find"],
    ]],
    ["Modes", [
      ["F11", "Distraction-free mode"],
      ["Ctrl+\\", "Show / hide the document sidebar"],
      ["Ctrl+Shift+T", "Typewriter + distraction-free"],
      ["Ctrl+Shift+M", "Mute key sounds"],
      ["Alt+T", "Timer panel"],
      ["Esc", "Exit focus / close panel"],
      ["Ctrl+/", "This cheat sheet"],
    ]],
  ];

  const content = makeEl("div", "shortcuts");
  for (const [title, entries] of groups) {
    content.append(makeEl("h3", "", title));
    const list = makeEl("dl", "shortcut-list");
    for (const [keys, description] of entries) {
      const row = makeEl("div", "shortcut-row");
      const key = makeEl("dt");
      const kbd = makeEl("kbd", "", keys);
      key.append(kbd);
      row.append(key, makeEl("dd", "", description));
      list.append(row);
    }
    content.append(list);
  }

  void openDialog({
    title: "Keyboard shortcuts",
    content,
    wide: true,
    buttons: [{ label: "Close", value: "close", primary: true }],
  });
}

function isTextField(): boolean {
  const element = document.activeElement;
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  );
}

function onGlobalKeydown(event: KeyboardEvent): void {
  if (event.isComposing || dialogOpen()) return;
  const mod = event.ctrlKey || event.metaKey;
  const key = event.key;
  const lower = key.toLowerCase();

  if (key === "F11") {
    event.preventDefault();
    toggleFocus();
    return;
  }

  if (key === "F2") {
    event.preventDefault();
    const folderToggle = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>(".folder-toggle");
    const folder = folderToggle?.dataset.folderId
      ? state.folders.find((item) => item.id === folderToggle.dataset.folderId)
      : null;
    if (folder) {
      beginFolderRename(folder);
      return;
    }
    const tab = activeTab();
    const label = tabsEl.querySelector<HTMLElement>(".tab.active .tab-title");
    if (tab && label) startRename(tab, label);
    return;
  }

  if (key === "Escape") {
    if (sidebarMenu) {
      closeSidebarMenu();
      return;
    }
    if (!colorPopover.hidden) {
      closeColorPopover(true);
      return;
    }
    if (!highlightPopover.hidden) {
      closeHighlightPopover(true);
      return;
    }
    if (timer.isOpen()) {
      timer.togglePanel(false);
      return;
    }
    if (finder.open) {
      finder.close();
      return;
    }
    if (state.focus) exitFocus();
    return;
  }

  if (mod && event.altKey) {
    if (key === "0" || key === "1" || key === "2") {
      event.preventDefault();
      if (isTextField() && document.activeElement !== fontSizeInput) return;
      formatBlock(key === "0" ? "p" : `h${key}`);
    }
    return;
  }

  if (mod) {
    if (
      event.shiftKey &&
      !event.altKey &&
      (event.code === "Digit8" || event.code === "Digit7")
    ) {
      if (isTextField()) return;
      event.preventDefault();
      runCommand(event.code === "Digit8" ? "insertUnorderedList" : "insertOrderedList");
      return;
    }

    switch (lower) {
      case "t":
        event.preventDefault();
        if (event.shiftKey) toggleTypewriter();
        else newTab();
        return;
      case "w":
        event.preventDefault();
        if (activeTab()) void closeTab(activeTab()!);
        return;
      case "s":
        event.preventDefault();
        void saveActive(event.shiftKey);
        return;
      case "o":
        event.preventDefault();
        void openFile();
        return;
      case "f":
        event.preventDefault();
        finder.openBar(false);
        return;
      case "h":
        event.preventDefault();
        if (event.shiftKey) {
          if (!isTextField()) toggleHighlight();
        } else {
          finder.openBar(true);
        }
        return;
      case "\\":
        event.preventDefault();
        toggleSidebar();
        return;
      case "/":
        event.preventDefault();
        showShortcuts();
        return;
      case "m":
        if (event.shiftKey) {
          event.preventDefault();
          toggleMute();
        }
        return;
      case "tab":
        event.preventDefault();
        cycleTab(event.shiftKey ? -1 : 1);
        return;
      case "pagedown":
        event.preventDefault();
        cycleTab(event.shiftKey ? -1 : 1);
        return;
      case "pageup":
        event.preventDefault();
        cycleTab(event.shiftKey ? 1 : -1);
        return;
    }

    if (/^[1-9]$/.test(key) && event.ctrlKey && !event.shiftKey) {
      event.preventDefault();
      const tab = state.tabs[Number(key) - 1];
      if (tab) activateTab(tab.id);
      return;
    }

    if (isTextField()) return;

    if (lower === "b" || lower === "i" || lower === "u") {
      event.preventDefault();
      runCommand(lower === "b" ? "bold" : lower === "i" ? "italic" : "underline");
      return;
    }

    if (event.code === "Equal" || event.code === "NumpadAdd") {
      event.preventDefault();
      changeFontSize(2);
      return;
    }
    if (event.code === "Minus" || event.code === "NumpadSubtract") {
      event.preventDefault();
      changeFontSize(-2);
      return;
    }
    return;
  }

  if (event.altKey && lower === "t") {
    event.preventDefault();
    revealChrome();
    timer.togglePanel();
  }
}

// -------------------------------------------------------------- settings ----

function toggleMute(): void {
  settings.muted = !settings.muted;
  audio.setMuted(settings.muted);
  updateMuteButton();
  saveSettings();
}

function updateMuteButton(): void {
  muteButton.replaceChildren(icon(settings.muted ? "volume-off" : "volume"));
  muteButton.setAttribute("aria-pressed", String(settings.muted));
  muteButton.setAttribute("aria-label", `${settings.muted ? "Unmute" : "Mute"} key sounds`);
  muteButton.title = `${settings.muted ? "Unmute" : "Mute"} key sounds (Ctrl+Shift+M)`;
}

// ------------------------------------------------------------------ wiring ---

function buildSwatches(): void {
  for (const color of PRESET_COLORS) {
    const swatch = makeEl("button", "swatch");
    swatch.type = "button";
    swatch.style.background = color;
    swatch.title = color;
    swatch.setAttribute("aria-label", `Apply color ${color}`);
    swatch.addEventListener("click", () => {
      applyColor(color);
      closeColorPopover();
    });
    colorSwatches.append(swatch);
  }
}

function renderHighlightSwatches(): void {
  highlightSwatches.replaceChildren();
  for (const color of HIGHLIGHT_COLORS) {
    const swatch = makeEl("button", "swatch");
    swatch.type = "button";
    swatch.style.background = color;
    swatch.title = color;
    swatch.setAttribute("aria-label", `Highlight ${color}`);
    if (color === settings.highlightColor) swatch.classList.add("active");
    swatch.addEventListener("click", () => {
      setHighlightColor(color);
      closeHighlightPopover();
    });
    highlightSwatches.append(swatch);
  }
  highlightPicker.style.setProperty("--swatch", settings.highlightColor);
  highlightNone.classList.toggle("active", false);
}

function onSidebarKeydown(event: KeyboardEvent): void {
  if ((event.target as HTMLElement).closest("button, input")) return;
  const entry = (event.target as Element).closest<HTMLElement>("[data-sidebar-entry]");
  if (!entry) return;
  const folder = entry.dataset.folderId
    ? state.folders.find((item) => item.id === entry.dataset.folderId)
    : null;

  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    event.preventDefault();
    const entries = Array.from(tabsEl.querySelectorAll<HTMLElement>(".folder-toggle, .document-row, .root-label"))
      .filter((item) => !item.closest("[hidden]"));
    const index = entries.indexOf(entry);
    const next = entries[Math.max(0, Math.min(entries.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))];
    next?.focus();
  } else if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && folder) {
    event.preventDefault();
    folder.expanded = event.key === "ArrowRight";
    renderTabs();
    scheduleSessionSave();
    tabsEl.querySelector<HTMLElement>(`.folder-toggle[data-folder-id="${CSS.escape(folder.id)}"]`)?.focus();
  } else if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    if (folder) {
      folder.expanded = !folder.expanded;
      renderTabs();
      scheduleSessionSave();
      tabsEl.querySelector<HTMLElement>(`.folder-toggle[data-folder-id="${CSS.escape(folder.id)}"]`)?.focus();
    } else if (entry.dataset.id) {
      activateTab(entry.dataset.id);
    }
  }
}

function wireControls(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      switch (button.dataset.action) {
        case "open":
          void openFile();
          break;
        case "save":
          void saveActive(false);
          break;
        case "save-as":
          void saveActive(true);
          break;
        case "find":
          finder.openBar(false);
          break;
        case "timer":
          revealChrome();
          timer.togglePanel();
          break;
        case "focus":
          toggleFocus();
          break;
        case "typewriter":
          toggleTypewriter();
          break;
        case "shortcuts":
          showShortcuts();
          break;
        case "undo":
          historyStep("undo");
          break;
        case "redo":
          historyStep("redo");
          break;
      }
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-cmd]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.cmd === "highlight") toggleHighlight();
      else runCommand(button.dataset.cmd ?? "");
    });
  });

  sidebarToggle.addEventListener("click", toggleSidebar);
  newFolderButton.addEventListener("click", () => createFolder());
  pageWidthSelect.addEventListener("change", () => setPageWidth(pageWidthSelect.value));
  sidebarFilter.addEventListener("input", () => {
    sidebarFilterText = sidebarFilter.value;
    renderTabs();
  });
  tabsEl.addEventListener("keydown", onSidebarKeydown);
  document.addEventListener("mousedown", (event) => {
    if (sidebarMenu && !(event.target as Element).closest(".sidebar-menu")) closeSidebarMenu();
  });
  for (const button of themeButtons) {
    button.addEventListener("click", () => {
      const mode = button.dataset.themeMode as ThemeMode | undefined;
      if (mode === "system" || mode === "light" || mode === "dark") setTheme(mode);
    });
  }

  toolbar.addEventListener("mousedown", (event) => {
    if ((event.target as HTMLElement).closest("button")) event.preventDefault();
  });

  $("#new-tab").addEventListener("click", () => newTab());

  blockStyle.addEventListener("change", () => formatBlock(blockStyle.value));

  fontFamily.addEventListener("change", () => {
    const name = fontFamily.value;
    if (!name) return;
    applyInlineStyle("font-family", FONT_STACKS[name] ?? name);
  });

  fontSizeInput.addEventListener("change", applyFontSize);
  fontSizeInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      applyFontSize();
    }
  });
  $("#size-up").addEventListener("click", () => changeFontSize(2));
  $("#size-down").addEventListener("click", () => changeFontSize(-2));

  colorButton.addEventListener("click", () => {
    const show = colorPopover.hidden;
    closeHighlightPopover();
    colorPopover.hidden = !show;
    colorButton.setAttribute("aria-expanded", String(show));
    if (show) colorSwatches.querySelector<HTMLElement>("button")?.focus();
  });
  colorCustom.addEventListener("change", () => applyColor(colorCustom.value));
  colorDefault.addEventListener("click", () => {
    applyColor(null);
    closeColorPopover();
  });

  highlightPicker.addEventListener("click", () => {
    const show = highlightPopover.hidden;
    closeColorPopover();
    highlightPopover.hidden = !show;
    highlightPicker.setAttribute("aria-expanded", String(show));
    if (show) highlightSwatches.querySelector<HTMLElement>("button")?.focus();
  });
  highlightNone.addEventListener("click", () => {
    setHighlightColor(null);
    closeHighlightPopover();
  });

  document.addEventListener("mousedown", (event) => {
    const target = event.target as Element;
    if (!colorPopover.hidden && !target.closest(".color-wrap")) closeColorPopover();
    if (!highlightPopover.hidden && !target.closest(".highlight-wrap")) closeHighlightPopover();
  });

  volumeInput.addEventListener("input", () => {
    settings.volume = Math.min(1, Math.max(0, Number(volumeInput.value) / 100));
    audio.setVolume(settings.volume);
    if (settings.muted && settings.volume > 0) {
      settings.muted = false;
      audio.setMuted(false);
      updateMuteButton();
    }
    saveSettings();
  });
  muteButton.addEventListener("click", toggleMute);

  document.addEventListener("selectionchange", () => {
    const tab = activeTab();
    if (!tab) return;
    const selection = window.getSelection();
    if (selection && selection.rangeCount && selection.anchorNode && tab.editor.contains(selection.anchorNode)) {
      if (!selection.isCollapsed) tab.pending = {};
      captureSelection(tab);
      updateStatus();
      updateToolbarState();
      scheduleCenter();
    }
  });

  window.addEventListener("mousemove", (event) => {
    if (!state.focus) return;
    if (event.clientY < 84 || event.clientY > window.innerHeight - 84) revealChrome();
  });
  toolbar.addEventListener("mousemove", revealChrome);
  statusbar.addEventListener("mousemove", revealChrome);
  toolbar.addEventListener("focusin", revealChrome);
  statusbar.addEventListener("focusin", revealChrome);

  document.addEventListener("keydown", onGlobalKeydown);
  window.addEventListener("beforeunload", saveSessionNow);
  window.addEventListener("blur", scheduleSessionSave);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveSessionNow();
  });

  wireDragAndDrop();
}

function wireDragAndDrop(): void {
  let depth = 0;
  const hasFiles = (event: DragEvent): boolean =>
    Array.from(event.dataTransfer?.types ?? []).includes("Files");

  window.addEventListener("dragenter", (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    depth += 1;
    document.body.classList.add("dropping");
  });

  window.addEventListener("dragover", (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  });

  window.addEventListener("dragleave", (event) => {
    if (!hasFiles(event)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) document.body.classList.remove("dropping");
  });

  window.addEventListener("drop", (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    depth = 0;
    document.body.classList.remove("dropping");
    const files = Array.from(event.dataTransfer?.files ?? []).filter(
      (file) => /\.(md|markdown|mdown|txt)$/i.test(file.name) || file.type.startsWith("text/"),
    );
    if (!files.length) {
      toast("Drop a Markdown (.md) or text file.", true);
      return;
    }
    for (const file of files) {
      void file.text().then((text) => importText(file.name, text, null));
    }
  });
}

function init(): void {
  buildSwatches();
  renderHighlightSwatches();
  audio.setVolume(settings.volume);
  audio.setMuted(settings.muted);
  volumeInput.value = String(Math.round(settings.volume * 100));
  updateMuteButton();

  finder = new FindController(
    () => activeTab()?.editor ?? null,
    () => {
      const tab = activeTab();
      if (!tab) return;
      markDirty(tab);
      updateStatus();
      updateToolbarState();
      scheduleSessionSave();
    },
    () => {
      prepareEditor();
    },
  );

  timer = new TimerController({
    beginSession: () => {
      const tab = activeTab();
      return {
        startWords: tab ? countWords(tab.editor.innerText) : 0,
        getText: () => (tab ? tab.editor.innerText : ""),
      };
    },
    onSummary: showSummary,
  });

  wireControls();
  restoreSession();
  applyTheme();
  applyPageWidth();
  applySidebar();
  updateToolbarState();
  updateStatus();
  void openStartupFiles();
}

init();
