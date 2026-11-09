// UI-only helpers: menus, selection bar, sidebar resize, fullscreen.
// Touches no document state; formatting is delegated to the existing [data-cmd] handlers.
const $ = <T extends Element>(selector: string, root: ParentNode = document): T | null =>
  root.querySelector<T>(selector);
const $$ = <T extends Element>(selector: string, root: ParentNode = document): T[] =>
  Array.from(root.querySelectorAll<T>(selector));
const save = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* optional */
  }
};
const load = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

// ---- dropdown menus
const triggers = $$<HTMLButtonElement>("[data-menu]");
const panelFor = (trigger: HTMLElement): HTMLElement | null =>
  trigger.dataset.menu ? document.getElementById(trigger.dataset.menu) : null;

function closeMenus(except?: HTMLElement): void {
  for (const trigger of triggers) {
    if (trigger === except) continue;
    const panel = panelFor(trigger);
    if (panel) panel.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
  }
}

for (const trigger of triggers) {
  const panel = panelFor(trigger);
  if (!panel) continue;
  trigger.addEventListener("click", (event) => {
    const show = panel.hidden;
    closeMenus(trigger);
    panel.hidden = !show;
    trigger.setAttribute("aria-expanded", String(show));
    schedule();
    // Keyboard open only; mouse keeps the editor caret.
    if (show && (event as MouseEvent).detail === 0) $<HTMLElement>(".menu-item", panel)?.focus();
  });
  panel.addEventListener("click", (event) => {
    if ((event.target as Element).closest(".menu-item")) setTimeout(() => closeMenus(), 0);
  });
  panel.addEventListener("keydown", (event) => {
    const items = $$<HTMLElement>(".menu-item", panel);
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    } else if (event.key === "Escape") {
      event.stopPropagation();
      closeMenus();
      trigger.focus();
    }
  });
}
document.addEventListener("mousedown", (event) => {
  if (!(event.target as Element).closest(".menu-wrap")) closeMenus();
});
document.addEventListener(
  "keydown",
  (event) => {
    if (event.key !== "Escape" || !$("[data-menu][aria-expanded='true']")) return;
    event.stopPropagation();
    closeMenus();
  },
  true,
);

// ---- fullscreen
const fullscreenButton = $<HTMLButtonElement>("#fullscreen-btn");
fullscreenButton?.addEventListener("click", () => {
  const go = document.fullscreenElement
    ? document.exitFullscreen()
    : document.documentElement.requestFullscreen();
  Promise.resolve(go).catch(() => {
    /* blocked by host */
  });
});
document.addEventListener("fullscreenchange", () =>
  fullscreenButton?.setAttribute("aria-pressed", String(Boolean(document.fullscreenElement))),
);

// ---- contextual selection bar
const bar = $<HTMLElement>("#selection-bar");
const workspace = $<HTMLElement>("#workspace");
let pointerDown = false;
let frame = 0;

bar?.addEventListener("mousedown", (event) => {
  if ((event.target as Element).closest("button")) event.preventDefault();
});
workspace?.addEventListener("mousedown", () => {
  pointerDown = true;
  if (bar) bar.hidden = true;
});
document.addEventListener("mouseup", () => {
  if (!pointerDown) return;
  pointerDown = false;
  schedule();
});
document.addEventListener("selectionchange", () => {
  if (!pointerDown) schedule();
});
workspace?.addEventListener("scroll", () => schedule(), true);
window.addEventListener("resize", () => schedule());

function schedule(): void {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(place);
}

function place(): void {
  if (!bar) return;
  const selection = getSelection();
  const anchor = selection?.anchorNode;
  const element = anchor?.nodeType === Node.ELEMENT_NODE ? (anchor as HTMLElement) : anchor?.parentElement;
  const editor = element?.closest(".editor");
  if (
    !selection ||
    $("[data-menu][aria-expanded='true']") ||
    selection.isCollapsed ||
    !selection.rangeCount ||
    !editor ||
    !(editor.textContent || "").trim()
  ) {
    bar.hidden = true;
    return;
  }
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  if (!rect.width && !rect.height) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  // Mirror the main toolbar's state.
  for (const button of $$<HTMLButtonElement>("[data-cmd]", bar)) {
    const twin = $<HTMLElement>(`#toolbar [data-cmd="${button.dataset.cmd}"]`);
    const on = twin?.getAttribute("aria-pressed") === "true";
    button.classList.toggle("active", on);
    button.setAttribute("aria-pressed", String(on));
  }
  const width = bar.offsetWidth;
  const height = bar.offsetHeight;
  const top = rect.top - height - 10 < 8 ? rect.bottom + 10 : rect.top - height - 10;
  bar.style.top = `${Math.round(top)}px`;
  bar.style.left = `${Math.round(
    Math.max(8, Math.min(innerWidth - width - 8, rect.left + rect.width / 2 - width / 2)),
  )}px`;
}

// Keep the bar's pressed states current after a toolbar or bar command.
bar?.addEventListener("click", () => setTimeout(schedule, 0));
$<HTMLElement>("#toolbar")?.addEventListener("click", () => setTimeout(schedule, 0));

// ---- resizable sidebar
const sidebar = $<HTMLElement>("#sidebar");
const grip = $<HTMLElement>("#sidebar-resizer");
const MIN_WIDTH = 200;
const MAX_WIDTH = 380;
const setWidth = (pixels: number): number => {
  const value = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(pixels)));
  document.documentElement.style.setProperty("--sidebar-w", `${value}px`);
  return value;
};
const savedWidth = Number(load("inkwell.sidebar-w"));
if (savedWidth) setWidth(savedWidth);

grip?.addEventListener("pointerdown", (event) => {
  if (!sidebar) return;
  event.preventDefault();
  grip.setPointerCapture(event.pointerId);
  document.body.classList.add("resizing");
  const move = (moveEvent: PointerEvent): void => {
    setWidth(moveEvent.clientX - sidebar.getBoundingClientRect().left);
  };
  const up = (): void => {
    grip.removeEventListener("pointermove", move);
    grip.removeEventListener("pointerup", up);
    document.body.classList.remove("resizing");
    save("inkwell.sidebar-w", String(sidebar.offsetWidth));
  };
  grip.addEventListener("pointermove", move);
  grip.addEventListener("pointerup", up);
});

grip?.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" || !sidebar) return;
  event.preventDefault();
  save(
    "inkwell.sidebar-w",
    String(setWidth(sidebar.offsetWidth + (event.key === "ArrowRight" ? 16 : -16))),
  );
});

grip?.addEventListener("dblclick", () => {
  document.documentElement.style.removeProperty("--sidebar-w");
  save("inkwell.sidebar-w", "");
});

// ---- reading progress + volume fill
workspace?.addEventListener(
  "scroll",
  (event) => {
    const target = event.target;
    if (!(target as Element).classList?.contains("tab-page")) return;
    const scroller = target as HTMLElement;
    const max = scroller.scrollHeight - scroller.clientHeight;
    workspace.style.setProperty("--progress", max > 0 ? String(scroller.scrollTop / max) : "0");
  },
  true,
);

const volume = $<HTMLInputElement>("#volume");
const paintVolume = (): void => volume?.style.setProperty("--v", `${volume.value}%`);
volume?.addEventListener("input", paintVolume);
paintVolume();
