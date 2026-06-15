/**
 * Quilltrace - Static Edition
 * Vanilla JS with per-keystroke snapshots, trash, context menus, inline replay
 */

// ============================================
// Configuration & State
// ============================================
const CONFIG = {
    DB_NAME: 'Quilltrace_v1',
    DEFAULT_SETTINGS: {
        maxSnapshots: 200,
        fontSize: 16,
        theme: 'system',
        canvasWidth: 800
    },
    MAX_STORAGE_MB: 5
};

let state = {
    notes: [],
    trash: [],
    activeNoteId: null,
    snapshots: [],
    settings: { ...CONFIG.DEFAULT_SETTINGS },
    isReplaying: false,
    replayInterval: null,
    lastSnapshotHash: null,
    dirty: false,
    contextMenuTarget: null,
    renameTargetId: null
};

// ============================================
// DOM Elements
// ============================================
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const els = {
    editor: $('#editor'),
    notesList: $('#notesList'),
    storageValue: $('#storageValue'),
    storageFill: $('#storageFill'),
    lastSaved: $('#lastSaved'),
    wordCount: $('#wordCount'),
    charCount: $('#charCount'),
    snapshotCount: $('#snapshotCount'),
    noteTitleInput: $('#noteTitleInput'),
    sidebar: $('#sidebar'),
    mobileMenuBtn: $('#mobileMenuBtn'),
    newNoteBtn: $('#newNoteBtn'),
    trashBtn: $('#trashBtn'),
    trashCount: $('#trashCount'),
    replayControls: $('#replayControls'),
    replayPlayBtn: $('#replayPlayBtn'),
    replayPauseBtn: $('#replayPauseBtn'),
    replaySpeed: $('#replaySpeed'),
    customSpeed: $('#customSpeed'),
    settingsBtn: $('#settingsBtn'),
    settingsModal: $('#settingsModal'),
    closeSettings: $('#closeSettings'),
    canvasWidth: $('#canvasWidth'),
    maxSnapshots: $('#maxSnapshots'),
    fontSize: $('#fontSize'),
    theme: $('#theme'),
    clearAllData: $('#clearAllData'),
    exportBtn: $('#exportBtn'),
    importBtn: $('#importBtn'),
    importModal: $('#importModal'),
    closeImport: $('#closeImport'),
    cancelImport: $('#cancelImport'),
    confirmImport: $('#confirmImport'),
    importDropzone: $('#importDropzone'),
    importFile: $('#importFile'),
    importPreview: $('#importPreview'),
    toastContainer: $('#toastContainer'),
    toolbarBtns: $$('.toolbar-btn'),
    contextMenu: $('#contextMenu'),
    trashModal: $('#trashModal'),
    closeTrash: $('#closeTrash'),
    trashList: $('#trashList'),
    emptyTrashBtn: $('#emptyTrashBtn'),
    renameModal: $('#renameModal'),
    closeRename: $('#closeRename'),
    cancelRename: $('#cancelRename'),
    confirmRename: $('#confirmRename'),
    renameInput: $('#renameInput')
};

// ============================================
// Storage Layer
// ============================================
const Storage = {
    getSize() {
        let total = 0;
        for (let key in localStorage) {
            if (localStorage.hasOwnProperty(key) && key.startsWith(CONFIG.DB_NAME)) {
                total += localStorage[key].length * 2;
            }
        }
        return total;
    },

    get(key) {
        try {
            const raw = localStorage.getItem(`${CONFIG.DB_NAME}_${key}`);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            return null;
        }
    },

    set(key, value) {
        try {
            localStorage.setItem(`${CONFIG.DB_NAME}_${key}`, JSON.stringify(value));
            return true;
        } catch (e) {
            if (e.name === 'QuotaExceededError') {
                showToast('Storage full! Delete old notes or clear data.', 'error');
                cleanupOldSnapshots();
                return false;
            }
            return false;
        }
    },

    remove(key) {
        localStorage.removeItem(`${CONFIG.DB_NAME}_${key}`);
    }
};

// ============================================
// Hashing
// ============================================
function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return hash.toString(36);
}

function getContentHash(html) {
    return hashString(html.trim());
}

// ============================================
// Note Management
// ============================================
function createNote(title = 'Untitled', content = '') {
    const now = Date.now();
    return {
        id: `note_${now}_${Math.random().toString(36).slice(2, 8)}`,
        title: title || 'Untitled',
        content: content,
        createdAt: now,
        updatedAt: now,
        snapshots: []
    };
}

function saveNote(note) {
    note.updatedAt = Date.now();
    Storage.set(`note_${note.id}`, note);
}

function loadNote(id) {
    return Storage.get(`note_${id}`);
}

function deleteNote(id) {
    const note = loadNote(id);
    if (!note) return;

    const trashed = { ...note, trashedAt: Date.now() };
    state.trash.push(trashed);
    Storage.set('trash', state.trash);

    Storage.remove(`note_${id}`);
    state.notes = state.notes.filter(n => n.id !== id);

    if (state.activeNoteId === id) {
        state.activeNoteId = state.notes.length > 0 ? state.notes[0].id : null;
        if (state.activeNoteId) {
            const next = loadNote(state.activeNoteId);
            if (next) loadNoteIntoEditor(next);
        } else {
            createNewNote();
        }
    }

    saveIndex();
    renderNotesList();
    updateTrashCount();
    updateStorageDisplay();
    showToast('Note moved to trash', 'info');
}

function restoreNote(trashedNote) {
    state.trash = state.trash.filter(n => n.id !== trashedNote.id);
    Storage.set('trash', state.trash);

    const restored = { ...trashedNote };
    delete restored.trashedAt;
    restored.updatedAt = Date.now();
    saveNote(restored);

    state.notes.push({ id: restored.id, title: restored.title, updatedAt: restored.updatedAt });
    saveIndex();

    renderNotesList();
    updateTrashCount();
    updateStorageDisplay();
    showToast('Note restored', 'success');
}

function permanentlyDelete(trashedNote) {
    state.trash = state.trash.filter(n => n.id !== trashedNote.id);
    Storage.set('trash', state.trash);
    updateTrashCount();
    updateStorageDisplay();
    renderTrashList();
    showToast('Note permanently deleted', 'warning');
}

function emptyTrash() {
    if (!confirm('Permanently delete all items in trash?')) return;
    state.trash = [];
    Storage.set('trash', []);
    updateTrashCount();
    updateStorageDisplay();
    renderTrashList();
    showToast('Trash emptied', 'warning');
}

function createNewNote() {
    // CRITICAL: Reset snapshots and hash to prevent cross-contamination
    state.snapshots = [];
    state.lastSnapshotHash = null;
    state.isReplaying = false;
    stopReplay();

    const note = createNote();
    state.notes.unshift({ id: note.id, title: note.title, updatedAt: note.updatedAt });
    state.activeNoteId = note.id;
    saveNote(note);
    saveIndex();

    els.editor.innerHTML = '';
    els.noteTitleInput.value = 'Untitled';
    updateCounts();
    updateSnapshotCount();
    renderNotesList();
    updateStorageDisplay();
    els.editor.focus();
    showToast('New note created', 'success');
}

function loadNoteIntoEditor(note) {
    if (!note) return;

    // CRITICAL: Reset replay state and snapshots
    state.activeNoteId = note.id;
    state.snapshots = note.snapshots || [];
    state.lastSnapshotHash = null;
    state.isReplaying = false;
    stopReplay();

    els.editor.innerHTML = note.content || '';
    els.noteTitleInput.value = note.title || 'Untitled';
    updateCounts();
    updateSnapshotCount();
    updateLastSaved(note.updatedAt);
    renderNotesList();
}

function updateNoteTitle() {
    const title = els.noteTitleInput.value.trim() || 'Untitled';
    const note = loadNote(state.activeNoteId);
    if (note) {
        note.title = title;
        note.updatedAt = Date.now();
        saveNote(note);

        const idx = state.notes.findIndex(n => n.id === state.activeNoteId);
        if (idx !== -1) {
            state.notes[idx].title = title;
            state.notes[idx].updatedAt = note.updatedAt;
        }
        saveIndex();
        renderNotesList();
    }
}

function saveIndex() {
    Storage.set('notes_index', state.notes.map(n => ({ id: n.id, title: n.title, updatedAt: n.updatedAt })));
}

// ============================================
// Per-Keystroke Snapshot System
// ============================================
function takeSnapshot() {
    const content = els.editor.innerHTML;
    const hash = getContentHash(content);

    // Skip if content hasn't changed
    if (hash === state.lastSnapshotHash) return;

    state.lastSnapshotHash = hash;

    const snapshot = {
        id: `snap_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        content: content,
        timestamp: Date.now(),
        hash: hash,
        size: new TextEncoder().encode(content).length
    };

    state.snapshots.push(snapshot);

    // Enforce max snapshots
    const max = parseInt(state.settings.maxSnapshots);
    if (state.snapshots.length > max) {
        state.snapshots = state.snapshots.slice(-max);
    }

    // Save to note
    const note = loadNote(state.activeNoteId);
    if (note) {
        note.snapshots = state.snapshots;
        note.content = content;
        note.updatedAt = Date.now();
        saveNote(note);
        updateLastSaved(note.updatedAt);
    }

    updateSnapshotCount();
    updateStorageDisplay();
    state.dirty = true;
}

// ============================================
// Replay (inline, no blur overlay)
// ============================================
function startReplay() {
    if (state.isReplaying || state.snapshots.length === 0) return;

    state.isReplaying = true;
    els.replayPlayBtn.disabled = true;
    els.replayPauseBtn.disabled = false;

    let index = 0;
    const speed = getReplaySpeed();

    // Show first snapshot
    els.editor.innerHTML = state.snapshots[0].content;
    updateCounts();

    state.replayInterval = setInterval(() => {
        index++;
        if (index >= state.snapshots.length) {
            stopReplay();
            showToast('Replay finished', 'success');
            return;
        }
        els.editor.innerHTML = state.snapshots[index].content;
        updateCounts();
    }, speed);
}

function stopReplay() {
    state.isReplaying = false;
    clearInterval(state.replayInterval);
    state.replayInterval = null;
    els.replayPlayBtn.disabled = false;
    els.replayPauseBtn.disabled = true;
}

function getReplaySpeed() {
    const val = els.replaySpeed.value;
    if (val === 'custom') {
        const custom = parseInt(els.customSpeed.value);
        return isNaN(custom) || custom < 10 ? 100 : custom;
    }
    return parseInt(val);
}

// ============================================
// Import / Export
// ============================================
function exportData() {
    const data = {
        version: 2,
        exportedAt: Date.now(),
        settings: state.settings,
        notes: [],
        trash: state.trash
    };

    state.notes.forEach(item => {
        const note = loadNote(item.id);
        if (note) data.notes.push(note);
    });

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `quilltrace_export_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast(`Exported ${data.notes.length} notes`, 'success');
}

let importData = null;

function handleImportFile(file) {
    if (!file || (!file.type.includes('json') && !file.name.endsWith('.json'))) {
        showToast('Please select a JSON file', 'error');
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if (!data.notes || !Array.isArray(data.notes)) {
                throw new Error('Invalid format: missing notes array');
            }
            importData = data;

            const trashCount = data.trash ? data.trash.length : 0;
            els.importPreview.innerHTML = `
                <strong>${data.notes.length} notes</strong> found${trashCount > 0 ? `, ${trashCount} in trash` : ''}<br>
                <small>Exported: ${new Date(data.exportedAt).toLocaleString()}</small>
            `;
            els.importPreview.classList.add('show');
            els.confirmImport.disabled = false;
        } catch (err) {
            showToast('Invalid JSON: ' + err.message, 'error');
            els.importPreview.classList.remove('show');
            els.confirmImport.disabled = true;
        }
    };
    reader.readAsText(file);
}

function confirmImport() {
    if (!importData) return;

    const existingIds = new Set(state.notes.map(n => n.id));
    let imported = 0, merged = 0;

    importData.notes.forEach(note => {
        if (existingIds.has(note.id)) {
            const existing = loadNote(note.id);
            if (existing && note.updatedAt > existing.updatedAt) {
                saveNote(note);
                merged++;
            }
        } else {
            saveNote(note);
            state.notes.push({ id: note.id, title: note.title, updatedAt: note.updatedAt });
            imported++;
        }
    });

    if (importData.trash && Array.isArray(importData.trash)) {
        const trashIds = new Set(state.trash.map(n => n.id));
        importData.trash.forEach(item => {
            if (!trashIds.has(item.id)) {
                state.trash.push(item);
            }
        });
        Storage.set('trash', state.trash);
    }

    saveIndex();

    if (importData.settings) {
        Object.assign(state.settings, importData.settings);
        applySettings();
    }

    renderNotesList();
    updateTrashCount();
    updateStorageDisplay();
    closeModal(els.importModal);

    showToast(`Imported ${imported} new, merged ${merged} existing`, 'success');
    importData = null;
}

// ============================================
// Settings
// ============================================
function loadSettings() {
    const saved = Storage.get('settings');
    if (saved) {
        state.settings = { ...CONFIG.DEFAULT_SETTINGS, ...saved };
    }
    applySettings();
}

function saveSettings() {
    state.settings.canvasWidth = els.canvasWidth.value;
    state.settings.maxSnapshots = els.maxSnapshots.value;
    state.settings.fontSize = els.fontSize.value;
    state.settings.theme = els.theme.value;
    Storage.set('settings', state.settings);
    applySettings();
    showToast('Settings saved', 'success');
}

function applySettings() {
    els.canvasWidth.value = state.settings.canvasWidth;
    els.maxSnapshots.value = state.settings.maxSnapshots;
    els.fontSize.value = state.settings.fontSize;
    els.theme.value = state.settings.theme;

    document.documentElement.style.setProperty('--editor-font-size', `${state.settings.fontSize}px`);

    const width = state.settings.canvasWidth === 'none' ? 'none' : `${state.settings.canvasWidth}px`;
    document.documentElement.style.setProperty('--editor-max-width', width);

    document.documentElement.removeAttribute('data-theme');
    if (state.settings.theme !== 'system') {
        document.documentElement.setAttribute('data-theme', state.settings.theme);
    }
}

function clearAllData() {
    if (!confirm('Are you sure? This will delete ALL notes, snapshots, and trash permanently.')) return;

    const keys = Object.keys(localStorage).filter(k => k.startsWith(CONFIG.DB_NAME + '_'));
    keys.forEach(k => localStorage.removeItem(k));

    state.notes = [];
    state.trash = [];
    state.activeNoteId = null;
    state.snapshots = [];

    createNewNote();
    updateStorageDisplay();
    updateTrashCount();
    closeModal(els.settingsModal);
    showToast('All data cleared', 'warning');
}

function cleanupOldSnapshots() {
    state.notes.forEach(noteRef => {
        const note = loadNote(noteRef.id);
        if (note && note.snapshots && note.snapshots.length > 50) {
            note.snapshots = note.snapshots.slice(-50);
            saveNote(note);
        }
    });
}

// ============================================
// Context Menu
// ============================================
function showContextMenu(e, noteId) {
    e.preventDefault();
    state.contextMenuTarget = noteId;

    const menu = els.contextMenu;
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;
    menu.classList.add('open');
}

function hideContextMenu() {
    els.contextMenu.classList.remove('open');
    state.contextMenuTarget = null;
}

function handleContextAction(action) {
    const noteId = state.contextMenuTarget;
    if (!noteId) return;

    const note = loadNote(noteId);
    if (!note) return;

    switch (action) {
        case 'rename':
            // CRITICAL FIX: Store target ID in dedicated variable
            state.renameTargetId = noteId;
            els.renameInput.value = note.title || 'Untitled';
            openModal(els.renameModal);
            setTimeout(() => els.renameInput.focus(), 100);
            break;
        case 'duplicate':
            const dup = createNote(note.title + ' (copy)', note.content);
            dup.snapshots = note.snapshots ? [...note.snapshots] : [];
            saveNote(dup);
            state.notes.unshift({ id: dup.id, title: dup.title, updatedAt: dup.updatedAt });
            saveIndex();
            renderNotesList();
            updateStorageDisplay();
            showToast('Note duplicated', 'success');
            break;
        case 'delete':
            deleteNote(noteId);
            break;
    }
    hideContextMenu();
}

function confirmRename() {
    // CRITICAL FIX: Use dedicated renameTargetId instead of contextMenuTarget
    const noteId = state.renameTargetId;
    if (!noteId) return;

    const newTitle = els.renameInput.value.trim() || 'Untitled';
    const note = loadNote(noteId);
    if (note) {
        note.title = newTitle;
        note.updatedAt = Date.now();
        saveNote(note);

        const idx = state.notes.findIndex(n => n.id === noteId);
        if (idx !== -1) {
            state.notes[idx].title = newTitle;
            state.notes[idx].updatedAt = note.updatedAt;
        }
        saveIndex();

        if (state.activeNoteId === noteId) {
            els.noteTitleInput.value = newTitle;
        }
        renderNotesList();
    }

    state.renameTargetId = null;
    closeModal(els.renameModal);
}

// ============================================
// Trash Modal
// ============================================
function renderTrashList() {
    const list = els.trashList;
    list.innerHTML = '';

    if (state.trash.length === 0) {
        list.innerHTML = '<div style="text-align:center;color:var(--muted-foreground);padding:2rem">Trash is empty</div>';
        return;
    }

    state.trash.forEach(note => {
        const item = document.createElement('div');
        item.className = 'trash-item';

        const time = new Date(note.trashedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

        item.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.5;flex-shrink:0">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
            </svg>
            <span class="trash-title">${escapeHtml(note.title || 'Untitled')}</span>
            <span class="trash-time">${time}</span>
            <div class="trash-actions">
                <button class="restore" title="Restore">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="1 4 1 10 7 10"/>
                        <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
                    </svg>
                </button>
                <button class="delete-forever" title="Delete permanently">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                </button>
            </div>
        `;

        item.querySelector('.restore').addEventListener('click', () => restoreNote(note));
        item.querySelector('.delete-forever').addEventListener('click', () => {
            if (confirm('Permanently delete this note?')) permanentlyDelete(note);
        });

        list.appendChild(item);
    });
}

function updateTrashCount() {
    els.trashCount.textContent = state.trash.length;
    els.trashCount.style.display = state.trash.length > 0 ? 'inline-block' : 'none';
}

// ============================================
// UI Helpers
// ============================================
function updateCounts() {
    const text = els.editor.innerText || '';
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const chars = text.length;

    els.wordCount.textContent = `${words} word${words !== 1 ? 's' : ''}`;
    els.charCount.textContent = `${chars} char${chars !== 1 ? 's' : ''}`;
}

function updateSnapshotCount() {
    els.snapshotCount.textContent = `${state.snapshots.length} snapshot${state.snapshots.length !== 1 ? 's' : ''}`;
}

function updateStorageDisplay() {
    const bytes = Storage.getSize();
    const kb = bytes / 1024;
    const mb = kb / 1024;

    els.storageValue.textContent = mb > 1 ? `${mb.toFixed(2)} MB` : `${kb.toFixed(1)} KB`;

    const pct = Math.min((mb / CONFIG.MAX_STORAGE_MB) * 100, 100);
    els.storageFill.style.width = `${pct}%`;
}

function updateLastSaved(timestamp) {
    if (!timestamp) {
        els.lastSaved.textContent = 'Unsaved';
        return;
    }
    const diff = Date.now() - timestamp;
    if (diff < 60000) {
        els.lastSaved.textContent = 'Just now';
    } else if (diff < 3600000) {
        els.lastSaved.textContent = `${Math.floor(diff / 60000)}m ago`;
    } else {
        els.lastSaved.textContent = new Date(timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    }
}

function renderNotesList() {
    els.notesList.innerHTML = '';

    const sorted = [...state.notes].sort((a, b) => b.updatedAt - a.updatedAt);

    sorted.forEach(note => {
        const li = document.createElement('li');
        li.className = 'note-item';
        if (note.id === state.activeNoteId) li.classList.add('active');

        const time = new Date(note.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

        li.innerHTML = `
            <svg class="note-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10 9 9 9 8 9"/>
            </svg>
            <span class="note-title">${escapeHtml(note.title || 'Untitled')}</span>
            <span class="note-time">${time}</span>
        `;

        li.addEventListener('click', () => {
            const loaded = loadNote(note.id);
            if (loaded) loadNoteIntoEditor(loaded);
        });

        li.addEventListener('contextmenu', (e) => showContextMenu(e, note.id));

        els.notesList.appendChild(li);
    });
}

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const icons = {
        success: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
        error: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
        warning: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#eab308" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
        info: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
    };

    toast.innerHTML = `${icons[type] || icons.info}<span>${escapeHtml(message)}</span>`;
    els.toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('toast-out');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function stripHtml(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function openModal(modal) {
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
}

function closeModal(modal) {
    modal.classList.remove('open');
    document.body.style.overflow = '';
}

// ============================================
// Editor Toolbar Actions
// ============================================
function execCmd(command, value = null) {
    document.execCommand(command, false, value);
    els.editor.focus();
    updateToolbarState();
}

function updateToolbarState() {
    els.toolbarBtns.forEach(btn => {
        const action = btn.dataset.action;
        let isActive = false;

        switch (action) {
            case 'bold': isActive = document.queryCommandState('bold'); break;
            case 'italic': isActive = document.queryCommandState('italic'); break;
            case 'underline': isActive = document.queryCommandState('underline'); break;
            case 'strike': isActive = document.queryCommandState('strikeThrough'); break;
            case 'ul': isActive = document.queryCommandState('insertUnorderedList'); break;
            case 'ol': isActive = document.queryCommandState('insertOrderedList'); break;
            case 'blockquote': isActive = document.queryCommandState('formatBlock') && document.queryCommandValue('formatBlock') === 'blockquote'; break;
        }

        btn.classList.toggle('active', isActive);
    });
}

// ============================================
// Event Listeners
// ============================================
function initEventListeners() {
    // Editor input - PER KEYSTROKE SNAPSHOT
    els.editor.addEventListener('input', () => {
        updateCounts();
        takeSnapshot();
        state.dirty = true;
    });

    els.editor.addEventListener('keyup', () => updateToolbarState());
    els.editor.addEventListener('mouseup', () => updateToolbarState());

    els.editor.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
            e.preventDefault();
            execCmd('insertText', '    ');
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            showToast('Auto-saved on every keystroke', 'info');
        }
    });

    // Toolbar
    els.toolbarBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.dataset.action;
            switch (action) {
                case 'bold': execCmd('bold'); break;
                case 'italic': execCmd('italic'); break;
                case 'underline': execCmd('underline'); break;
                case 'strike': execCmd('strikeThrough'); break;
                case 'h1': execCmd('formatBlock', 'H1'); break;
                case 'h2': execCmd('formatBlock', 'H2'); break;
                case 'ul': execCmd('insertUnorderedList'); break;
                case 'ol': execCmd('insertOrderedList'); break;
                case 'blockquote': execCmd('formatBlock', 'blockquote'); break;
                case 'undo': execCmd('undo'); break;
                case 'redo': execCmd('redo'); break;
            }
        });
    });

    // Mobile menu toggle
    els.mobileMenuBtn.addEventListener('click', () => {
        els.sidebar.classList.toggle('open');
    });

    els.newNoteBtn.addEventListener('click', createNewNote);

    // Trash
    els.trashBtn.addEventListener('click', () => {
        renderTrashList();
        openModal(els.trashModal);
    });
    els.closeTrash.addEventListener('click', () => closeModal(els.trashModal));
    els.trashModal.querySelector('.modal-backdrop').addEventListener('click', () => closeModal(els.trashModal));
    els.emptyTrashBtn.addEventListener('click', emptyTrash);

    // Replay
    els.replayPlayBtn.addEventListener('click', startReplay);
    els.replayPauseBtn.addEventListener('click', stopReplay);
    els.replaySpeed.addEventListener('change', () => {
        const isCustom = els.replaySpeed.value === 'custom';
        els.customSpeed.style.display = isCustom ? 'inline-block' : 'none';
    });

    // Title input
    els.noteTitleInput.addEventListener('change', updateNoteTitle);
    els.noteTitleInput.addEventListener('blur', updateNoteTitle);
    els.noteTitleInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            els.noteTitleInput.blur();
            updateNoteTitle();
            els.editor.focus();
        }
    });

    // Settings
    els.settingsBtn.addEventListener('click', () => openModal(els.settingsModal));
    els.closeSettings.addEventListener('click', () => closeModal(els.settingsModal));
    els.settingsModal.querySelector('.modal-backdrop').addEventListener('click', () => closeModal(els.settingsModal));
    [els.canvasWidth, els.maxSnapshots, els.fontSize, els.theme].forEach(el => {
        el.addEventListener('change', saveSettings);
    });
    els.clearAllData.addEventListener('click', clearAllData);

    // Export / Import
    els.exportBtn.addEventListener('click', exportData);
    els.importBtn.addEventListener('click', () => openModal(els.importModal));
    els.closeImport.addEventListener('click', () => closeModal(els.importModal));
    els.cancelImport.addEventListener('click', () => closeModal(els.importModal));
    els.importModal.querySelector('.modal-backdrop').addEventListener('click', () => closeModal(els.importModal));
    els.confirmImport.addEventListener('click', confirmImport);

    // Import dropzone
    els.importDropzone.addEventListener('click', () => els.importFile.click());
    els.importDropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        els.importDropzone.classList.add('dragover');
    });
    els.importDropzone.addEventListener('dragleave', () => {
        els.importDropzone.classList.remove('dragover');
    });
    els.importDropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        els.importDropzone.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file) handleImportFile(file);
    });
    els.importFile.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) handleImportFile(file);
    });

    // Context menu
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.context-menu')) hideContextMenu();
    });

    els.contextMenu.querySelectorAll('.context-item').forEach(item => {
        item.addEventListener('click', () => handleContextAction(item.dataset.action));
    });

    // Rename modal
    els.closeRename.addEventListener('click', () => closeModal(els.renameModal));
    els.cancelRename.addEventListener('click', () => closeModal(els.renameModal));
    els.renameModal.querySelector('.modal-backdrop').addEventListener('click', () => closeModal(els.renameModal));
    els.confirmRename.addEventListener('click', confirmRename);
    els.renameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') confirmRename();
        if (e.key === 'Escape') closeModal(els.renameModal);
    });

    // Auto-save on blur
    window.addEventListener('beforeunload', () => {
        if (state.dirty && state.activeNoteId) {
            const note = loadNote(state.activeNoteId);
            if (note) {
                note.content = els.editor.innerHTML;
                note.updatedAt = Date.now();
                saveNote(note);
            }
        }
    });

    // Periodic updates
    setInterval(() => {
        updateStorageDisplay();
        if (state.activeNoteId) {
            const note = loadNote(state.activeNoteId);
            if (note) updateLastSaved(note.updatedAt);
        }
    }, 5000);
}

// ============================================
// Initialization
// ============================================
function init() {
    loadSettings();

    // Load trash
    const trash = Storage.get('trash');
    if (trash) state.trash = trash;
    updateTrashCount();

    // Load notes index
    const index = Storage.get('notes_index');
    if (index && index.length > 0) {
        state.notes = index;
        const firstNote = loadNote(state.notes[0].id);
        if (firstNote) {
            loadNoteIntoEditor(firstNote);
        } else {
            createNewNote();
        }
    } else {
        createNewNote();
    }

    initEventListeners();
    updateStorageDisplay();
    updateToolbarState();

    setTimeout(() => els.editor.focus(), 100);

    console.log('Quilltrace initialized');
}

document.addEventListener('DOMContentLoaded', init);
