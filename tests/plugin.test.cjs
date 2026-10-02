const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

async function setup(saved) {
  const observers = [];
  class ResizeObserver {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(element) { this.element = element; }
    disconnect() { this.disconnected = true; }
  }
  const classes = new Set();
  const element = {
    listeners: new Map(),
    addEventListener(name, fn) { this.listeners.set(name, fn); },
    removeEventListener(name) { this.listeners.delete(name); },
    contains() { return true; },
    clientWidth: 300,
    ownerDocument: {
      addEventListener() {}, removeEventListener() {},
      defaultView: { ResizeObserver, innerWidth: 800, innerHeight: 600,
        addEventListener() {}, removeEventListener() {} },
      body: { appendChild(el) { this.tooltip = el; } },
      createElement() { return { style: {}, setAttribute() {}, remove() { this.removed = true; },
        getBoundingClientRect() { return { width: 200, height: 40 }; } }; },
    },
    classList: {
      toggle(name, on) { if (on) classes.add(name); else classes.delete(name); },
      remove(name) { classes.delete(name); },
    },
  };
  const view = { containerEl: element };
  let leaves = [{ view }];
  let ready;
  class Plugin {
    app = { workspace: {
      on() { return {}; },
      onLayoutReady(fn) { ready = fn; },
      getLeavesOfType() { return leaves; },
    } };
    async loadData() { return saved; }
    async saveData(data) { this.saved = { ...data }; }
    addSettingTab() {}
    addCommand(command) { this.command = command; }
    registerEvent() {}
  }
  const context = { module: { exports: {} }, require: () => ({ Plugin, PluginSettingTab: class {} }) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8'), context);
  const plugin = new context.module.exports();
  await plugin.onload();
  return { plugin, view, element, observers, classes, ready: () => ready(), remove: () => { leaves = []; } };
}

test('layout remains two columns until plugin unload', async () => {
  const f = await setup(null);
  f.ready();
  assert.equal(f.classes.has('two-column-explorer'), true);
  f.element.clientWidth = 180;
  f.observers[0].callback();
  assert.equal(f.classes.size, 1);
  f.element.clientWidth = 260;
  f.observers[0].callback();
  assert.equal(f.classes.size, 1);
  f.plugin.onunload();
  assert.equal(f.classes.size, 0);
  assert.equal('enabled' in f.plugin.settings, false);
});

test('hover shows the full basename and restores prior titles when disabled', async () => {
  const f = await setup(null);
  f.ready();
  const attrs = new Map([['data-path', 'Folder/Full file name.md'], ['title', 'Existing tooltip']]);
  const row = {
    closest() { return this; }, contains() { return false; },
    getAttribute(name) { return attrs.get(name) ?? null; },
    hasAttribute(name) { return attrs.has(name); },
    getBoundingClientRect() { return { left: 10, top: 100, bottom: 120, width: 100 }; },
    setAttribute(name, value) { attrs.set(name, value); },
    removeAttribute(name) { attrs.delete(name); },
    querySelector() { return null; },
  };
  f.element.listeners.get('pointerover')({ target: row, clientX: 100, clientY: 120 });
  assert.equal(attrs.has('title'), false);
  const tip = f.element.ownerDocument.body.tooltip;
  assert.equal(tip.textContent, 'Full file name.md');
  assert.equal(tip.style.top, '78px');
  assert.equal(tip.style.left, '100px');
  f.element.listeners.get('pointermove')({ clientX: 200, clientY: 200 });
  assert.equal(tip.style.left, '200px');
  assert.equal(tip.style.top, '158px');
  f.element.listeners.get('pointermove')({ clientX: 790, clientY: 5 });
  assert.equal(tip.style.left, '592px');
  assert.equal(tip.style.top, '8px');
  f.plugin.settings.hoverAlignment = 'left';
  f.element.listeners.get('pointermove')({ clientX: 400, clientY: 200 });
  assert.equal(tip.style.left, '200px');
  f.plugin.settings.hoverAlignment = 'center';
  f.element.listeners.get('pointermove')({ clientX: 400, clientY: 200 });
  assert.equal(tip.style.left, '300px');
  f.plugin.settings.hoverAlignment = 'right';
  f.element.listeners.get('pointermove')({ clientX: 400, clientY: 200 });
  assert.equal(tip.style.left, '400px');
  f.element.listeners.get('pointerout')({ relatedTarget: null });
  assert.equal(attrs.get('title'), 'Existing tooltip');
  // Folder counts are delayed and their native suppression is temporary.
  const doc = f.element.ownerDocument;
  doc.head = { appendChild(el) { this.style = el; } };
  let pending;
  let cancelled = false;
  doc.defaultView.setTimeout = (fn, delay) => {
    assert.equal(delay, 1000);
    pending = fn;
    return 1;
  };
  doc.defaultView.clearTimeout = () => { cancelled = true; };
  row.classList = { contains: () => true };
  f.plugin.app.vault = { getAbstractFileByPath: () => ({ getFileCount: () => 8, getFolderCount: () => 0 }) };
  f.element.listeners.get('pointerover')({ target: row, clientX: 100, clientY: 120 });
  const folderTip = doc.body.tooltip;
  folderTip.appendChild = child => { folderTip.counts = child; };
  assert.equal(folderTip.counts, undefined);
  pending();
  assert.equal(folderTip.counts.textContent, '8 files, 0 folders');
  f.element.listeners.get('pointerout')({ relatedTarget: null });
  assert.equal(doc.head.style.removed, true);
  row.classList = { contains: name => name === 'nav-file-title' };
  f.plugin.app.vault.getAbstractFileByPath = () => ({ stat: { mtime: 1700000000000, ctime: 1600000000000 } });
  f.element.listeners.get('pointerover')({ target: row, clientX: 100, clientY: 120 });
  const fileTip = doc.body.tooltip;
  fileTip.appendChild = child => { fileTip.details = child; };
  assert.equal(fileTip.details, undefined);
  pending();
  assert.match(fileTip.details.textContent, /^Last modified: \d{4}-\d{2}-\d{2} \d{2}:\d{2}\nCreated: /);
  f.element.listeners.get('pointerout')({ relatedTarget: null });
  f.element.listeners.get('pointerover')({ target: row, clientX: 100, clientY: 120 });
  f.plugin.settings.showNamesOnHover = false;
  f.plugin.refresh();
  assert.equal(attrs.get('title'), 'Existing tooltip');
  assert.equal(f.element.listeners.size, 0);
  assert.equal(cancelled, true);
  f.plugin.settings.showNamesOnHover = true;
  f.plugin.refresh();
  f.plugin.onunload();
  assert.equal(f.element.listeners.size, 0);
});

test('removed panes and unload release observers and classes', async () => {
  const f = await setup({ breakpoint: 200 });
  f.ready();
  f.plugin.refresh();
  assert.equal(f.observers.length, 1);
  f.remove();
  f.plugin.refresh();
  assert.equal(f.observers[0].disconnected, true);
  assert.equal(f.classes.size, 0);
  const g = await setup(null);
  g.ready();
  g.plugin.onunload();
  g.ready();
  g.observers[0].callback();
  assert.equal(g.classes.size, 0);
  assert.equal(g.observers.length, 1);
  assert.equal(g.observers[0].disconnected, true);
});

test('obsolete enabled and width settings are ignored', async () => {
  const f = await setup({ enabled: false, breakpoint: 'invalid' });
  f.ready();
  assert.equal(f.classes.size, 1);
  assert.equal('enabled' in f.plugin.settings, false);
  assert.equal('breakpoint' in f.plugin.settings, false);
  const g = await setup({ breakpoint: 9999 });
  g.ready();
  assert.equal(g.classes.has('two-column-explorer'), true);
});

test('virtualized explorer renders both columns without dropping offscreen nodes and restores native methods', async () => {
  function element() {
    const classes = new Set();
    return {
      classes, parentNode: {}, style: { removeProperty() {} },
      classList: { add: c => classes.add(c), remove: c => classes.delete(c) },
      setChildrenInPlace(children) { this.children = children; },
      scrollIntoView() { this.scrolled = true; },
    };
  }
  const f = await setup(null);
  const children = Array.from({ length: 200 }, () => ({ el: element() }));
  const root = { childrenEl: element(), pusherEl: element(), vChildren: { children } };
  let invalidated = 0;
  const nativeUpdate = () => {};
  const nativeScroll = () => {};
  const scroll = Object.create({ updateVirtualDisplay: nativeUpdate, scrollIntoView: nativeScroll });
  scroll.rootEl = root;
  scroll.invalidateAll = () => invalidated++;
  f.view.tree = { infinityScroll: scroll };
  f.ready();
  assert.equal(root.childrenEl.classes.has('two-column-root'), true);
  assert.equal(root.childrenEl.children.length, 201);
  assert.equal(root.pusherEl.classes.has('two-column-pusher'), true);
  const added = { el: element() };
  children.push(added);
  scroll.updateVirtualDisplay();
  assert.equal(root.childrenEl.children.at(-1), added.el);
  scroll.scrollIntoView(added);
  assert.equal(added.el.scrolled, true);
  f.plugin.onunload();
  assert.equal(scroll.updateVirtualDisplay, nativeUpdate);
  assert.equal(scroll.scrollIntoView, nativeScroll);
  assert.equal(Object.hasOwn(scroll, 'updateVirtualDisplay'), false);
  assert.equal(root.childrenEl.classes.size, 0);
  assert.equal(root.pusherEl.classes.size, 0);
  assert.equal(invalidated, 1);
  f.plugin.refresh();
  assert.equal(scroll.updateVirtualDisplay, nativeUpdate);
  assert.equal(root.childrenEl.classes.size, 0);
});
