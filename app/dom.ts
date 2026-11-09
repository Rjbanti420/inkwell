export function $<T extends HTMLElement = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}

export function makeEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

let toastElement: HTMLElement | null = null;
let toastTimer: number | undefined;

export function toast(message: string, isError = false): void {
  if (!toastElement) {
    toastElement = makeEl("div", "toast");
    toastElement.setAttribute("role", "status");
    document.body.append(toastElement);
  }
  toastElement.textContent = message;
  toastElement.classList.toggle("error", isError);
  toastElement.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastElement?.classList.remove("show"), 2600);
}

export interface DialogButton {
  label: string;
  value: string;
  primary?: boolean;
  danger?: boolean;
}

interface DialogOptions {
  title: string;
  content: string | Node;
  buttons: DialogButton[];
  wide?: boolean;
}

export function dialogOpen(): boolean {
  return Boolean(document.querySelector(".modal-overlay"));
}

export function openDialog(options: DialogOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const previous = document.activeElement as HTMLElement | null;
    const overlay = makeEl("div", "modal-overlay");
    const dialog = makeEl("div", "modal" + (options.wide ? " wide" : ""));
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");

    const title = makeEl("h2", "modal-title", options.title);
    title.id = "modal-title";
    dialog.setAttribute("aria-labelledby", title.id);

    const body = makeEl("div", "modal-body");
    if (typeof options.content === "string") body.innerHTML = options.content;
    else body.append(options.content);

    const footer = makeEl("div", "modal-actions");
    const buttons = options.buttons.map((spec) => {
      const button = makeEl("button", "btn" + (spec.primary ? " primary" : "") + (spec.danger ? " danger" : ""), spec.label);
      button.type = "button";
      button.addEventListener("click", () => close(spec.value));
      footer.append(button);
      return button;
    });

    dialog.append(title, body, footer);
    overlay.append(dialog);
    document.body.append(overlay);

    const close = (value: string | null) => {
      overlay.remove();
      document.removeEventListener("keydown", onKeydown, true);
      if (previous && previous.isConnected) previous.focus();
      resolve(value);
    };

    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close(null);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        overlay.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"),
      ).filter((element) => !element.hasAttribute("disabled"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    overlay.addEventListener("mousedown", (event) => {
      if (event.target === overlay) close(null);
    });
    document.addEventListener("keydown", onKeydown, true);
    (buttons.find((_, index) => options.buttons[index].primary) ?? buttons[0])?.focus();
  });
}
