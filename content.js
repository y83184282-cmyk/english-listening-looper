(() => {
  if (window.__englishListeningLooperLoaded) return;
  window.__englishListeningLooperLoaded = true;

  const STORAGE_PREFIX = "ell:";
  const SHORTCUTS_KEY = `${STORAGE_PREFIX}shortcuts`;
  const UI_SETTINGS_KEY = `${STORAGE_PREFIX}ui`;
  const SEEK_BACK_SECONDS = 0.25;
  const END_FALLBACK_SECONDS = 4;
  const DEFAULT_SHORTCUTS = {
    addNode: { key: "F8", altKey: false, ctrlKey: false, shiftKey: false, metaKey: false },
    replayNode: { key: "F9", altKey: false, ctrlKey: false, shiftKey: false, metaKey: false },
    setEnd: { key: "F10", altKey: false, ctrlKey: false, shiftKey: false, metaKey: false },
    previousNode: { key: "ArrowLeft", altKey: true, ctrlKey: false, shiftKey: false, metaKey: false },
    nextNode: { key: "ArrowRight", altKey: true, ctrlKey: false, shiftKey: false, metaKey: false },
    toggleOverlay: { key: "L", altKey: false, ctrlKey: true, shiftKey: true, metaKey: false }
  };
  const MODIFIER_KEYS = new Set(["Alt", "Control", "Meta", "Shift"]);
  const KEY_LABELS = {
    " ": "Space",
    Spacebar: "Space",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    ArrowUp: "Up",
    ArrowDown: "Down",
    Escape: "Esc"
  };

  const cloneShortcut = (shortcut) => ({ ...shortcut });

  const cloneDefaultShortcuts = () => {
    return Object.fromEntries(
      Object.entries(DEFAULT_SHORTCUTS).map(([id, shortcut]) => [id, cloneShortcut(shortcut)])
    );
  };

  const state = {
    video: null,
    nodes: [],
    activeNodeId: null,
    keepPrevious: true,
    loopEnabled: false,
    minimized: false,
    saveTimer: null,
    uiSaveTimer: null,
    shortcuts: cloneDefaultShortcuts(),
    shortcutsCollapsed: false,
    panelSize: null,
    resizeObserver: null,
    pageStorageIdentity: "",
    pageStorageKey: "",
    capturingShortcut: null,
    shortcutMessage: "",
    uiReady: false,
    ui: {}
  };

  const shortcutActionMeta = [
    { id: "addNode", label: "Add node" },
    { id: "replayNode", label: "Replay" },
    { id: "setEnd", label: "Set end" },
    { id: "previousNode", label: "Previous" },
    { id: "nextNode", label: "Next" },
    { id: "toggleOverlay", label: "Show/hide" }
  ];

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const normalizePanelSize = (panelSize) => {
    if (!panelSize || typeof panelSize !== "object") return null;
    const width = Number(panelSize.width);
    const height = Number(panelSize.height);
    if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
    return {
      width: clamp(Math.round(width), 340, 1200),
      height: clamp(Math.round(height), 260, 900)
    };
  };

  const applyPanelSize = () => {
    if (!state.uiReady || !state.panelSize) return;
    const maxWidth = Math.max(340, window.innerWidth - 28);
    const maxHeight = Math.max(260, window.innerHeight - 28);
    state.ui.root.style.width = `${clamp(state.panelSize.width, 340, maxWidth)}px`;
    state.ui.root.style.height = `${clamp(state.panelSize.height, 260, maxHeight)}px`;
  };

  const readPanelSize = () => {
    if (!state.uiReady || state.minimized) return null;
    const rect = state.ui.root.getBoundingClientRect();
    return normalizePanelSize({ width: rect.width, height: rect.height });
  };

  const saveUiSettings = () => {
    clearTimeout(state.uiSaveTimer);
    state.uiSaveTimer = setTimeout(() => {
      chrome.storage.local.set({
        [UI_SETTINGS_KEY]: {
          shortcutsCollapsed: state.shortcutsCollapsed,
          panelSize: state.panelSize
        }
      });
    }, 120);
  };

  const updateMinimizeControl = () => {
    if (!state.uiReady) return;
    state.ui.root.classList.toggle("is-minimized", state.minimized);
    state.ui.minimize.textContent = state.minimized ? "Show" : "Hide";
    state.ui.minimize.setAttribute("aria-label", state.minimized ? "Show the listening controls" : "Hide as a small restore button");
    state.ui.minimize.title = state.minimized ? "Show the listening controls" : "Hide as a small restore button";
  };

  const observePanelSize = () => {
    if (!globalThis.ResizeObserver || state.resizeObserver) return;
    let lastSize = "";
    state.resizeObserver = new ResizeObserver(() => {
      const panelSize = readPanelSize();
      if (!panelSize) return;
      const nextSize = `${panelSize.width}x${panelSize.height}`;
      if (nextSize === lastSize) return;
      lastSize = nextSize;
      state.panelSize = panelSize;
      saveUiSettings();
    });
    state.resizeObserver.observe(state.ui.root);
  };

  const getVideo = () => {
    const videos = [...document.querySelectorAll("video")].filter((video) => {
      const rect = video.getBoundingClientRect();
      return rect.width > 80 && rect.height > 45 && Number.isFinite(video.duration);
    });

    return videos.sort((a, b) => {
      const aRect = a.getBoundingClientRect();
      const bRect = b.getBoundingClientRect();
      return bRect.width * bRect.height - aRect.width * aRect.height;
    })[0] || document.querySelector("video");
  };

  const pageIdentity = () => {
    const url = new URL(location.href);
    url.hash = "";
    return `${url.origin}${url.pathname}${url.search}`;
  };

  const hashText = async (value) => {
    if (globalThis.crypto?.subtle && globalThis.TextEncoder) {
      const bytes = new TextEncoder().encode(value);
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      return `sha256-${[...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("")}`;
    }

    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
  };

  const pageStorageKey = async () => {
    const identity = pageIdentity();
    if (state.pageStorageKey && state.pageStorageIdentity === identity) {
      return state.pageStorageKey;
    }
    state.pageStorageIdentity = identity;
    state.pageStorageKey = `${STORAGE_PREFIX}page:${await hashText(identity)}`;
    return state.pageStorageKey;
  };

  const formatTime = (seconds) => {
    if (!Number.isFinite(seconds)) return "--:--";
    const total = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    }
    return `${minutes}:${String(secs).padStart(2, "0")}`;
  };

  const createId = () => {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `node-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  };

  const byTime = (a, b) => a.start - b.start;

  const activeIndex = () => state.nodes.findIndex((node) => node.id === state.activeNodeId);

  const activeNode = () => state.nodes[activeIndex()] || null;

  const normalizeKey = (key) => {
    if (key === " " || key === "Spacebar") return "Space";
    if (key === "Esc") return "Escape";
    if (key.length === 1) return key.toUpperCase();
    return key;
  };

  const normalizeShortcut = (shortcut) => {
    if (!shortcut || typeof shortcut.key !== "string") return null;
    const key = normalizeKey(shortcut.key);
    if (!key || MODIFIER_KEYS.has(key)) return null;
    return {
      key,
      altKey: shortcut.altKey === true,
      ctrlKey: shortcut.ctrlKey === true,
      shiftKey: shortcut.shiftKey === true,
      metaKey: shortcut.metaKey === true
    };
  };

  const normalizeShortcuts = (savedShortcuts) => {
    const shortcuts = cloneDefaultShortcuts();
    if (!savedShortcuts || typeof savedShortcuts !== "object") return shortcuts;
    shortcutActionMeta.forEach(({ id }) => {
      const normalized = normalizeShortcut(savedShortcuts[id]);
      if (normalized) shortcuts[id] = normalized;
    });
    return shortcuts;
  };

  const eventToShortcut = (event) => {
    const key = normalizeKey(event.key);
    if (!key || MODIFIER_KEYS.has(key)) return null;
    return {
      key,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      metaKey: event.metaKey
    };
  };

  const shortcutMatches = (event, shortcut) => {
    if (!shortcut) return false;
    return normalizeKey(event.key) === shortcut.key
      && event.altKey === shortcut.altKey
      && event.ctrlKey === shortcut.ctrlKey
      && event.shiftKey === shortcut.shiftKey
      && event.metaKey === shortcut.metaKey;
  };

  const shortcutsEqual = (first, second) => {
    return first?.key === second?.key
      && first?.altKey === second?.altKey
      && first?.ctrlKey === second?.ctrlKey
      && first?.shiftKey === second?.shiftKey
      && first?.metaKey === second?.metaKey;
  };

  const shortcutToText = (shortcut) => {
    if (!shortcut) return "Unset";
    const parts = [];
    if (shortcut.ctrlKey) parts.push("Ctrl");
    if (shortcut.altKey) parts.push("Alt");
    if (shortcut.shiftKey) parts.push("Shift");
    if (shortcut.metaKey) parts.push("Meta");
    parts.push(KEY_LABELS[shortcut.key] || shortcut.key);
    return parts.join("+");
  };

  const getActionLabel = (id) => shortcutActionMeta.find((action) => action.id === id)?.label || id;

  const normalizeNodes = (nodes) => {
    return nodes
      .filter((node) => Number.isFinite(node.start))
      .map((node, index) => ({
        id: node.id || createId(),
        start: Math.max(0, Number(node.start)),
        end: Number.isFinite(node.end) && node.end > node.start ? Number(node.end) : null,
        label: node.label || `Node ${index + 1}`
      }))
      .sort(byTime)
      .map((node, index) => ({
        ...node,
        label: node.label && !/^Node \d+$/.test(node.label) ? node.label : `Node ${index + 1}`
      }));
  };

  const loadState = async () => {
    const key = await pageStorageKey();
    const data = await chrome.storage.local.get([key, SHORTCUTS_KEY, UI_SETTINGS_KEY]);
    const saved = data[key] || {};
    const savedUi = data[UI_SETTINGS_KEY] || {};
    state.nodes = normalizeNodes(saved.nodes || []);
    state.keepPrevious = saved.keepPrevious !== false;
    state.loopEnabled = saved.loopEnabled === true;
    state.minimized = saved.minimized === true;
    state.activeNodeId = saved.activeNodeId || state.nodes[0]?.id || null;
    state.shortcuts = normalizeShortcuts(data[SHORTCUTS_KEY]);
    state.shortcutsCollapsed = savedUi.shortcutsCollapsed === true;
    state.panelSize = normalizePanelSize(savedUi.panelSize);
    applyPanelSize();
  };

  const saveState = () => {
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(async () => {
      const key = await pageStorageKey();
      chrome.storage.local.set({
        [key]: {
          duration: state.video?.duration || null,
          keepPrevious: state.keepPrevious,
          loopEnabled: state.loopEnabled,
          minimized: state.minimized,
          activeNodeId: state.activeNodeId,
          nodes: state.nodes
        }
      });
    }, 120);
  };

  const saveShortcuts = () => {
    chrome.storage.local.set({ [SHORTCUTS_KEY]: state.shortcuts });
  };

  const renderNodes = () => {
    if (!state.uiReady) return;
    const { list } = state.ui;
    list.innerHTML = "";

    if (state.nodes.length === 0) {
      const empty = document.createElement("div");
      empty.className = "ell-empty";
      empty.textContent = `No sentence nodes yet. Press ${shortcutToText(state.shortcuts.addNode)} to add the current sentence start.`;
      list.append(empty);
      return;
    }

    state.nodes.forEach((node, index) => {
      const row = document.createElement("button");
      row.className = `ell-node${node.id === state.activeNodeId ? " is-active" : ""}`;
      row.type = "button";
      row.title = `Jump to ${formatTime(node.start)}`;
      row.addEventListener("click", () => {
        state.activeNodeId = node.id;
        seekToNode(node);
        render();
        saveState();
      });

      const time = document.createElement("span");
      time.className = "ell-node-time";
      time.textContent = formatTime(node.start);

      const label = document.createElement("span");
      label.className = "ell-node-label";
      label.textContent = node.end
        ? `Sentence ${index + 1} - ends at ${formatTime(node.end)}`
        : `Sentence ${index + 1}`;

      const deleteButton = document.createElement("button");
      deleteButton.className = "ell-icon-button";
      deleteButton.type = "button";
      deleteButton.title = "Delete node";
      deleteButton.textContent = "x";
      deleteButton.addEventListener("click", (event) => {
        event.stopPropagation();
        deleteNode(node.id);
      });

      row.append(time, label, deleteButton);
      list.append(row);
    });
  };

  const renderMarkers = () => {
    if (!state.uiReady) return;
    const { progress } = state.ui;
    progress.querySelectorAll(".ell-marker").forEach((marker) => marker.remove());
    const duration = state.video?.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;

    state.nodes.forEach((node) => {
      const marker = document.createElement("button");
      marker.className = `ell-marker${node.id === state.activeNodeId ? " is-active" : ""}`;
      marker.type = "button";
      marker.style.left = `${Math.min(100, Math.max(0, (node.start / duration) * 100))}%`;
      marker.title = `Node ${formatTime(node.start)}`;
      marker.addEventListener("click", (event) => {
        event.stopPropagation();
        state.activeNodeId = node.id;
        seekToNode(node);
        render();
        saveState();
      });
      progress.append(marker);
    });
  };

  const renderShortcuts = () => {
    if (!state.uiReady) return;
    const { shortcutButtons, help, shortcutNote, shortcuts, shortcutToggle } = state.ui;
    shortcutActionMeta.forEach(({ id, label }) => {
      const buttonElement = shortcutButtons[id];
      if (!buttonElement) return;
      const isCapturing = state.capturingShortcut === id;
      buttonElement.textContent = isCapturing ? "Press keys..." : shortcutToText(state.shortcuts[id]);
      buttonElement.title = `Change shortcut for ${label}`;
      buttonElement.classList.toggle("is-capturing", isCapturing);
    });
    shortcuts.classList.toggle("is-collapsed", state.shortcutsCollapsed);
    shortcutToggle.textContent = state.shortcutsCollapsed ? "Show" : "Hide";
    shortcutToggle.setAttribute("aria-expanded", String(!state.shortcutsCollapsed));
    help.textContent = `${shortcutToText(state.shortcuts.addNode)} add/replace start - ${shortcutToText(state.shortcuts.replayNode)} replay - ${shortcutToText(state.shortcuts.setEnd)} set end`;
    shortcutNote.textContent = state.shortcutMessage || "Click a shortcut, then press a new key combination. Escape cancels.";
  };

  const renderStatus = () => {
    if (!state.uiReady) return;
    const { status, fill, keepPrevious, loop, deleteCurrent, replay, prev, next, title } = state.ui;
    const current = state.video?.currentTime || 0;
    const duration = state.video?.duration || 0;
    title.textContent = document.title || "English Listening Looper";
    status.textContent = `${formatTime(current)} / ${formatTime(duration)}`;
    fill.style.width = duration > 0 ? `${Math.min(100, (current / duration) * 100)}%` : "0%";
    keepPrevious.checked = state.keepPrevious;
    loop.checked = state.loopEnabled;
    const hasNodes = state.nodes.length > 0;
    deleteCurrent.disabled = !hasNodes;
    replay.disabled = !hasNodes;
    prev.disabled = !hasNodes;
    next.disabled = !hasNodes;
  };

  const render = () => {
    renderStatus();
    renderNodes();
    renderMarkers();
    renderShortcuts();
  };

  const seekTo = (seconds) => {
    if (!state.video || !Number.isFinite(seconds)) return;
    state.video.currentTime = Math.max(0, seconds - SEEK_BACK_SECONDS);
    state.video.play().catch(() => {});
  };

  const seekToNode = (node) => {
    if (!node) return;
    seekTo(node.start);
  };

  const addOrReplaceNode = () => {
    if (!state.video) return;
    const start = Math.max(0, state.video.currentTime);
    const currentIndex = activeIndex();
    const node = {
      id: createId(),
      start,
      end: null,
      label: ""
    };

    if (state.keepPrevious || state.nodes.length === 0) {
      state.nodes.push(node);
      state.activeNodeId = node.id;
    } else {
      const replaceIndex = currentIndex >= 0 ? currentIndex : state.nodes.length - 1;
      state.nodes.splice(replaceIndex, 1, node);
      state.activeNodeId = node.id;
    }

    state.nodes = normalizeNodes(state.nodes);
    render();
    saveState();
  };

  const setEndForActiveNode = () => {
    const node = activeNode();
    if (!node || !state.video) return;
    const end = Math.max(state.video.currentTime, node.start + 0.1);
    node.end = end;
    render();
    saveState();
  };

  const deleteNode = (nodeId = state.activeNodeId) => {
    const index = state.nodes.findIndex((node) => node.id === nodeId);
    if (index < 0) return;
    state.nodes.splice(index, 1);
    state.activeNodeId = state.nodes[Math.min(index, state.nodes.length - 1)]?.id || null;
    render();
    saveState();
  };

  const moveNode = (step) => {
    if (state.nodes.length === 0) return;
    let index = activeIndex();
    if (index < 0) index = 0;
    index = (index + step + state.nodes.length) % state.nodes.length;
    state.activeNodeId = state.nodes[index].id;
    seekToNode(state.nodes[index]);
    render();
    saveState();
  };

  const replayCurrent = () => {
    const node = activeNode();
    if (!node) return;
    seekToNode(node);
  };

  const handleLoop = () => {
    if (!state.loopEnabled || !state.video) return;
    const node = activeNode();
    if (!node) return;
    const currentIndex = activeIndex();
    const nextStart = state.nodes[currentIndex + 1]?.start;
    const end = node.end || nextStart || node.start + END_FALLBACK_SECONDS;
    if (state.video.currentTime >= end) {
      seekToNode(node);
    }
  };

  const handleProgressClick = (event) => {
    const duration = state.video?.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;
    const rect = state.ui.progress.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    state.video.currentTime = ratio * duration;
  };

  const toggleMinimized = () => {
    if (!state.minimized) {
      state.panelSize = readPanelSize() || state.panelSize;
      saveUiSettings();
    }
    state.minimized = !state.minimized;
    updateMinimizeControl();
    if (!state.minimized) applyPanelSize();
    saveState();
  };

  const toggleShortcutsCollapsed = () => {
    state.shortcutsCollapsed = !state.shortcutsCollapsed;
    state.shortcutMessage = "";
    saveUiSettings();
    renderShortcuts();
  };

  const shortcutActions = [
    { id: "addNode", run: addOrReplaceNode },
    { id: "replayNode", run: replayCurrent },
    { id: "setEnd", run: setEndForActiveNode },
    { id: "previousNode", run: () => moveNode(-1) },
    { id: "nextNode", run: () => moveNode(1) },
    { id: "toggleOverlay", run: toggleMinimized }
  ];

  const startShortcutCapture = (actionId) => {
    state.capturingShortcut = actionId;
    state.shortcutMessage = `Press a new shortcut for ${getActionLabel(actionId)}.`;
    renderShortcuts();
  };

  const resetShortcuts = () => {
    state.shortcuts = cloneDefaultShortcuts();
    state.capturingShortcut = null;
    state.shortcutMessage = "Shortcuts reset to defaults.";
    saveShortcuts();
    render();
  };

  const captureShortcut = (event) => {
    event.preventDefault();
    event.stopPropagation();

    if (event.key === "Escape") {
      state.shortcutMessage = "Shortcut change cancelled.";
      state.capturingShortcut = null;
      renderShortcuts();
      return;
    }

    const shortcut = eventToShortcut(event);
    if (!shortcut) {
      state.shortcutMessage = "Use a letter, number, function key, or arrow key. Modifiers alone are not shortcuts.";
      renderShortcuts();
      return;
    }

    const duplicate = shortcutActionMeta.find(({ id }) => (
      id !== state.capturingShortcut && shortcutsEqual(state.shortcuts[id], shortcut)
    ));
    if (duplicate) {
      state.shortcutMessage = `${shortcutToText(shortcut)} is already used by ${duplicate.label}.`;
      renderShortcuts();
      return;
    }

    const actionId = state.capturingShortcut;
    state.shortcuts[actionId] = shortcut;
    state.capturingShortcut = null;
    state.shortcutMessage = `Saved ${getActionLabel(actionId)} as ${shortcutToText(shortcut)}.`;
    saveShortcuts();
    render();
  };

  const handleKeys = (event) => {
    if (state.capturingShortcut) {
      captureShortcut(event);
      return;
    }

    const target = event.target;
    const isTyping = target && (
      ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable
    );
    if (isTyping) return;

    const action = shortcutActions.find(({ id }) => shortcutMatches(event, state.shortcuts[id]));
    if (!action) return;

    event.preventDefault();
    event.stopPropagation();
    action.run();
  };

  const button = (text, title, onClick, className = "") => {
    const element = document.createElement("button");
    element.className = `ell-button ${className}`.trim();
    element.type = "button";
    element.textContent = text;
    element.title = title;
    element.addEventListener("click", onClick);
    return element;
  };

  const buildShortcutControls = (root) => {
    const shortcutGrid = root.querySelector(".ell-shortcut-grid");
    const shortcutButtons = {};

    shortcutActionMeta.forEach(({ id, label }) => {
      const row = document.createElement("div");
      row.className = "ell-shortcut-row";

      const name = document.createElement("span");
      name.className = "ell-shortcut-name";
      name.textContent = label;

      const shortcutButton = button("", `Change shortcut for ${label}`, () => startShortcutCapture(id), "ell-shortcut-button");
      shortcutButtons[id] = shortcutButton;

      row.append(name, shortcutButton);
      shortcutGrid.append(row);
    });

    root.querySelector(".ell-shortcut-toggle").addEventListener("click", toggleShortcutsCollapsed);
    root.querySelector(".ell-shortcut-reset").addEventListener("click", resetShortcuts);
    return shortcutButtons;
  };

  const buildUi = () => {
    const root = document.createElement("div");
    root.className = "ell-root";
    root.innerHTML = `
      <div class="ell-panel">
        <div class="ell-topbar">
          <div class="ell-title"></div>
          <div class="ell-status"></div>
        </div>
        <div class="ell-progress" title="Click to seek">
          <div class="ell-track"><div class="ell-fill"></div></div>
        </div>
        <div class="ell-controls"></div>
        <div class="ell-node-list"></div>
        <div class="ell-shortcuts">
          <div class="ell-shortcuts-head">
            <div class="ell-shortcuts-title">Shortcuts</div>
            <div class="ell-shortcuts-actions">
              <button class="ell-shortcut-toggle" type="button" aria-expanded="true">Hide</button>
              <button class="ell-shortcut-reset" type="button">Reset</button>
            </div>
          </div>
          <div class="ell-shortcut-grid"></div>
          <div class="ell-shortcut-note"></div>
        </div>
        <div class="ell-help"></div>
      </div>
    `;

    document.documentElement.append(root);
    state.uiReady = true;

    const controls = root.querySelector(".ell-controls");
    const keepLabel = document.createElement("label");
    keepLabel.className = "ell-toggle";
    keepLabel.innerHTML = `<input type="checkbox">Keep previous node`;

    const loopLabel = document.createElement("label");
    loopLabel.className = "ell-toggle";
    loopLabel.innerHTML = `<input type="checkbox">Loop`;

    const add = button("Add", "Add the current playback time as a node. If Keep previous node is off, replace the active node.", addOrReplaceNode, "is-primary");
    const replay = button("Replay", "Replay from the active node.", replayCurrent);
    const setEnd = button("Set end", "Use the current playback time as the active node end point.", setEndForActiveNode);
    const prev = button("<", "Previous node", () => moveNode(-1));
    const next = button(">", "Next node", () => moveNode(1));
    const deleteCurrent = button("Delete", "Delete the active node.", () => deleteNode(), "is-danger");
    const minimize = button("Hide", "Hide as a small restore button.", toggleMinimized);
    minimize.classList.add("ell-minimize-button");

    keepLabel.querySelector("input").addEventListener("change", (event) => {
      state.keepPrevious = event.target.checked;
      saveState();
    });

    loopLabel.querySelector("input").addEventListener("change", (event) => {
      state.loopEnabled = event.target.checked;
      saveState();
      render();
    });

    controls.append(add, replay, setEnd, prev, next, deleteCurrent, keepLabel, loopLabel, minimize);

    const shortcutButtons = buildShortcutControls(root);

    state.ui = {
      root,
      title: root.querySelector(".ell-title"),
      status: root.querySelector(".ell-status"),
      progress: root.querySelector(".ell-progress"),
      fill: root.querySelector(".ell-fill"),
      list: root.querySelector(".ell-node-list"),
      keepPrevious: keepLabel.querySelector("input"),
      loop: loopLabel.querySelector("input"),
      deleteCurrent,
      replay,
      prev,
      next,
      minimize,
      help: root.querySelector(".ell-help"),
      shortcuts: root.querySelector(".ell-shortcuts"),
      shortcutToggle: root.querySelector(".ell-shortcut-toggle"),
      shortcutButtons,
      shortcutNote: root.querySelector(".ell-shortcut-note")
    };

    state.ui.progress.addEventListener("click", handleProgressClick);
    applyPanelSize();
    updateMinimizeControl();
    observePanelSize();
    renderShortcuts();
  };

  const attachVideo = async () => {
    const video = getVideo();
    if (!video || video === state.video) return;

    if (!state.uiReady) buildUi();

    state.video?.removeEventListener("timeupdate", renderStatus);
    state.video?.removeEventListener("timeupdate", handleLoop);
    state.video?.removeEventListener("loadedmetadata", render);

    state.video = video;
    await loadState();

    video.addEventListener("timeupdate", renderStatus);
    video.addEventListener("timeupdate", handleLoop);
    video.addEventListener("loadedmetadata", render);
    render();
  };

  const init = async () => {
    document.addEventListener("keydown", handleKeys, true);
    await attachVideo();
    setInterval(attachVideo, 1500);
    setInterval(renderStatus, 500);
  };

  init();
})();



