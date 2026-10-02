const { Plugin, PluginSettingTab, Setting } = require("obsidian");

const CLASS = "two-column-explorer";
const DEFAULTS = { showNamesOnHover: true, hoverAlignment: "right" };

module.exports = class TwoColumnExplorer extends Plugin {
  async onload() {
    this.explorers = new Map();
    this.stopped = false;
    const saved = await this.loadData();
    this.settings = {
      showNamesOnHover:
        typeof saved?.showNamesOnHover === "boolean"
          ? saved.showNamesOnHover
          : DEFAULTS.showNamesOnHover,
      showFolderCounts: saved?.showFolderCounts !== false,
      hoverAlignment: ["left", "center", "right"].includes(
        saved?.hoverAlignment,
      )
        ? saved.hoverAlignment
        : DEFAULTS.hoverAlignment,
    };
    this.addSettingTab(new Settings(this.app, this));
    this.registerEvent(
      this.app.workspace.on("layout-change", () => this.refresh()),
    );
    this.app.workspace.onLayoutReady(() => this.refresh());
  }

  refresh() {
    if (this.stopped) return;
    const views = this.app.workspace
      .getLeavesOfType("file-explorer")
      .map((leaf) => leaf.view);
    const current = new Set(views.map((view) => view.containerEl));
    for (const [element, state] of this.explorers) {
      if (
        !current.has(element) ||
        state.win !== element.ownerDocument.defaultView
      ) {
        state.observer.disconnect();
        state.restore?.();
        state.removeHover?.();
        element.classList.remove(CLASS);
        this.explorers.delete(element);
      }
    }
    for (const view of views) {
      const element = view.containerEl;
      if (!this.explorers.has(element)) {
        const win = element.ownerDocument.defaultView;
        if (!win) continue;
        const observer = new win.ResizeObserver(() => this.update(element));
        this.explorers.set(element, { observer, win, view });
        observer.observe(element);
      }
      this.update(element);
    }
  }

  update(element) {
    if (this.stopped) return;
    element.classList.toggle(CLASS, true);
    const state = this.explorers.get(element);
    if (!state) return;
    if (this.settings.showNamesOnHover && !state.removeHover) {
      state.removeHover = addHover(
        element,
        () => this.settings.hoverAlignment,
        () => this.settings.showFolderCounts,
        this.app,
      );
    } else if (!this.settings.showNamesOnHover && state.removeHover) {
      state.removeHover();
      state.removeHover = null;
    }
    if (!state.restore) state.restore = setColumns(state.view);
  }

  onunload() {
    this.stopped = true;
    for (const [element, state] of this.explorers) {
      state.observer.disconnect();
      element.classList.remove(CLASS);
      state.restore?.();
      state.removeHover?.();
    }
    this.explorers.clear();
  }
};

function addHover(container, getPosition, showCounts, app) {
  const doc = container.ownerDocument;
  const win = doc.defaultView;
  let hovered = null;
  let tooltip = null;
  let oldTitle = null;
  let tipWidth = 0;
  let tipHeight = 0;
  let timer = null;
  let lastX = 0;
  let lastY = 0;
  let tooltipStyle = null;
  const clear = () => {
    if (timer !== null) win.clearTimeout(timer);
    timer = null;
    tooltipStyle?.remove();
    tooltipStyle = null;
    if (hovered && oldTitle !== null && !hovered.hasAttribute("title")) {
      hovered.setAttribute("title", oldTitle);
    }
    tooltip?.remove();
    tooltip = null;
    hovered = null;
  };
  const show = (event) => {
    if (event.pointerType === "touch") return;
    const row = event.target.closest?.(".nav-folder-title, .nav-file-title");
    if (!row || !container.contains(row) || row === hovered) return;
    clear();
    if (row.querySelector('[contenteditable="true"]')) return;
    const path = row.getAttribute("data-path");
    const label = row.querySelector(
      ".nav-folder-title-content, .nav-file-title-content",
    );
    const name = path ? path.split("/").pop() : label?.textContent?.trim();
    if (!name) return;
    hovered = row;
    oldTitle = row.getAttribute("title");
    row.removeAttribute("title");
    tooltip = doc.createElement("div");
    tooltip.className = "two-column-name-tooltip";
    tooltip.setAttribute("role", "tooltip");
    if (
      showCounts() &&
      (row.classList?.contains("nav-folder-title") ||
        row.classList?.contains("nav-file-title"))
    ) {
      tooltipStyle = doc.createElement("style");
      tooltipStyle.textContent =
        "body > .tooltip { visibility: hidden !important; }";
      doc.head.appendChild(tooltipStyle);
      timer = win.setTimeout(() => {
        timer = null;
        if (!tooltip || hovered !== row || !showCounts()) return;
        const item = app.vault.getAbstractFileByPath(path);
        if (!item) return;
        const counts = doc.createElement("div");
        counts.className = "two-column-name-counts";
        if (item.stat) {
          const format = (timestamp) => {
            const date = new Date(timestamp);
            const pad = (value) => String(value).padStart(2, "0");
            return (
              date.getFullYear() +
              "-" +
              pad(date.getMonth() + 1) +
              "-" +
              pad(date.getDate()) +
              " " +
              pad(date.getHours()) +
              ":" +
              pad(date.getMinutes())
            );
          };
          counts.textContent =
            "Last modified: " +
            format(item.stat.mtime) +
            "\nCreated: " +
            format(item.stat.ctime);
        } else if (
          typeof item.getFileCount === "function" &&
          typeof item.getFolderCount === "function"
        ) {
          const files = item.getFileCount();
          const folders = item.getFolderCount();
          counts.textContent =
            files +
            (files === 1 ? " file, " : " files, ") +
            folders +
            (folders === 1 ? " folder" : " folders");
        } else return;
        tooltip.appendChild(counts);
        const size = tooltip.getBoundingClientRect();
        tipWidth = size.width;
        tipHeight = size.height;
        position(lastX, lastY);
      }, 1000);
    }
    tooltip.textContent = name;
    doc.body.appendChild(tooltip);
    const bounds = tooltip.getBoundingClientRect();
    tipWidth = bounds.width;
    tipHeight = bounds.height;
    if (Number.isFinite(event.clientX)) position(event.clientX, event.clientY);
    else {
      const rect = row.getBoundingClientRect();
      position(rect.left + rect.width / 2, rect.top);
    }
  };
  const position = (x, y) => {
    if (!tooltip) return;
    lastX = x;
    lastY = y;
    const alignment = getPosition();
    const left =
      alignment === "left"
        ? x - tipWidth
        : alignment === "center"
          ? x - tipWidth / 2
          : x;
    const top = y - tipHeight - 2 >= 8 ? y - tipHeight - 2 : y + 2;
    tooltip.style.left =
      Math.max(8, Math.min(left, win.innerWidth - tipWidth - 8)) + "px";
    tooltip.style.top =
      Math.max(8, Math.min(top, win.innerHeight - tipHeight - 8)) + "px";
  };
  const move = (event) => position(event.clientX, event.clientY);
  const out = (event) => {
    if (hovered && !hovered.contains(event.relatedTarget)) clear();
  };
  const key = (event) => {
    if (event.key === "Escape") clear();
  };
  const listeners = [
    [container, "pointerover", show],
    [container, "pointerout", out],
    [container, "pointermove", move],
    [container, "focusin", show],
    [container, "focusout", out],
    [container, "pointerdown", clear],
    [container, "dragstart", clear],
    [doc, "scroll", clear, true],
    [doc, "keydown", key],
    [win, "resize", clear],
    [win, "blur", clear],
  ];
  for (const [target, name, fn, capture] of listeners)
    target.addEventListener(name, fn, capture);
  return () => {
    clear();
    for (const [target, name, fn, capture] of listeners)
      target.removeEventListener(name, fn, capture);
  };
}
function setColumns(view) {
  const scroll = view.tree?.infinityScroll;
  const root = scroll?.rootEl;
  if (
    !root?.childrenEl ||
    !root.vChildren ||
    typeof scroll.updateVirtualDisplay !== "function"
  )
    return null;
  const originals = new Map();
  const marked = new Set();
  const render = (node) => {
    if (!node.childrenEl || !node.vChildren) return;
    const children = node.vChildren.children;
    const elements = [];
    if (node.pusherEl) {
      node.pusherEl.classList.add("two-column-pusher");
      marked.add(node.pusherEl);
      elements.push(node.pusherEl);
    }
    for (const child of children) {
      elements.push(child.el);
      child.coverEl?.style.removeProperty("margin-inline-start");
      child.coverEl?.style.removeProperty("padding-inline-start");
    }
    node.childrenEl.setChildrenInPlace(elements);
    node.childrenEl.style.minHeight = "";
    if (node.childrenEl.parentNode) {
      for (const child of children) {
        child.onRender?.();
        render(child);
      }
    }
  };
  const replace = (key, fn) => {
    originals.set(key, {
      descriptor: Object.getOwnPropertyDescriptor(scroll, key),
      fn,
    });
    scroll[key] = fn;
  };
  root.childrenEl.classList.add("two-column-root");
  replace("updateVirtualDisplay", () => render(root));
  replace("scrollIntoView", (node) => {
    render(root);
    (node.selfEl || node.el).scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  });
  render(root);
  return () => {
    root.childrenEl.classList.remove("two-column-root");
    for (const element of marked) element.classList.remove("two-column-pusher");
    for (const [key, { descriptor, fn }] of originals) {
      if (scroll[key] !== fn) continue;
      if (descriptor) Object.defineProperty(scroll, key, descriptor);
      else delete scroll[key];
    }
    scroll.invalidateAll?.();
  };
}

class Settings extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    this.containerEl.empty();
    new Setting(this.containerEl)
      .setName("Show full names on hover")
      .setDesc(
        "Instantly show the full name beside your pointer, following its movement.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showNamesOnHover)
          .onChange(async (value) => {
            this.plugin.settings.showNamesOnHover = value;
            this.plugin.refresh();
            await this.plugin.saveData(this.plugin.settings);
          }),
      );
    new Setting(this.containerEl)
      .setName("Show details below name")
      .setDesc(
        "Show folder counts or file modified/created times below the name after one second, replacing the native popup. Requires full names on hover.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showFolderCounts)
          .onChange(async (value) => {
            this.plugin.settings.showFolderCounts = value;
            for (const state of this.plugin.explorers.values()) {
              state.removeHover?.();
              state.removeHover = null;
            }
            this.plugin.refresh();
            await this.plugin.saveData(this.plugin.settings);
          }),
      );
    new Setting(this.containerEl)
      .setName("Hover label position")
      .setDesc(
        "Place the name to the left, centered above, or to the right of your cursor. Labels stay inside the window.",
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("left", "Left")
          .addOption("center", "Center")
          .addOption("right", "Right")
          .setValue(this.plugin.settings.hoverAlignment)
          .onChange(async (value) => {
            this.plugin.settings.hoverAlignment = value;
            await this.plugin.saveData(this.plugin.settings);
          }),
      );
  }
}
