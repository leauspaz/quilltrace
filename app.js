/**
 * ChronoNote - Static Edition
 * Vanilla JS implementation with localStorage persistence
 * Features: Debounced snapshots, timeline replay, import/export, shadcn UI
 */

// ============================================
// Configuration & State
// ============================================
const CONFIG = {
    DB_NAME: 'ChronoNote_v2',
    DEFAULT_SETTINGS: {
        snapshotInterval: 500,    // ms
        maxSnapshots: 200,
        fontSize: 16,
        theme: 'system'
    },
    MAX_STORAGE_MB: 5,
    DEBOUNCE_WAIT: 500
};

let state = {
    notes: [],
    activeNoteId: null,
    snapshots: [],
    settings: { ...CONFIG.DEFAULT_SETTINGS },
    isReplaying: false,
    replayInterval: null,
    lastSnapshotHash: null,
    snapshotTimer: null,
    dirty: false
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
    breadcrumbCurrent: $('.breadcrumb-current'),
    sidebar: $('#sidebar'),
    sidebarToggle: $('#sidebarToggle'),
    mobileMenuBtn: $('#mobileMenuBtn'),
    newNoteBtn: $('#newNoteBtn'),
    timelineBtn: $('#timelineBtn'),
    timelinePanel: $('#timelinePanel'),
    timelineOverlay: $('#timelineOverlay'),
    closeTimeline: $('#closeTimeline'),
    timelineList: $('#timelineList'),
    timelinePlay: $('#timelinePlay'),
    timelinePause: $('#timelinePause'),
    replaySpeed: $('#replaySpeed'),
    timelineScrubber: $('#timelineScrubber'),
    scrubberCurrent: $('#scrubberCurrent'),
    scrubberTotal: $('#scrubberTotal'),
    settingsBtn: $('#settingsBtn'),
    settingsModal: $('#settingsModal'),
    closeSettings: $('#closeSettings'),
    snapshotInterval: $('#snapshotInterval'),
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
    toolbarBtns: $$('.toolbar-btn')
};

// ============================================
// Storage Layer (localStorage with size tracking)
// ============================================
const Storage = {
    getSize() {
        let total = 0;
        for (let key in localStorage) {
            if (localStorage.hasOwnProperty(key)) {
                total += localStorage[key].length * 2; // UTF-16 = 2 bytes per char
            }
        }
        return total;
    },

    get(key) {
        try {
            const raw = localStorage.getItem(`${CONFIG.DB_NAME}_${key}`);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            console.error('Storage get error:', e);
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
                // Try to clean up old snapshots
                cleanupOldSnapshots();
                return false;
            }
            console.error('Storage set error:', e);
            return false;
        }
    },

    remove(key) {
        localStorage.removeItem(`${CONFIG.DB_NAME}_${key}`);
    },

    clear() {
        const keys = Object.keys(localStorage).filter(k => k.startsWith(CONFIG.DB_NAME_));
        keys.forEach(k => localStorage.removeItem(k));
    }
};

// ============================================
// Hashing for deduplication
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
    const note = {
        id: `note_${now}_${Math.random().toString(36).slice(2, 8)}`,
        title: title || 'Untitled',
        content: content,
        createdAt: now,
        updatedAt: now,
        snapshots: []
    };
    return note;
}

function saveNote(note) {
    note.updatedAt = Date.now();
    Storage.set(`note_${note.id}`, note);
}

function loadNote(id) {
    return Storage.get(`note_${id}`);
}

function deleteNote(id) {
    Storage.remove(`note_${id}`);
    state.notes = state.notes.filter(n => n.id !== id);
    if (state.activeNoteId === id) {
        state.activeNoteId = state.notes.length > 0 ? state.notes[0].id : null;
        if (state.activeNoteId) {
            const note = loadNote(state.activeNoteId);
            loadNoteIntoEditor(note);
        } else {
            createNewNote();
        }
    }
    renderNotesList();
    updateStorageDisplay();
    showToast('Note deleted', 'info');
}

function createNewNote() {
    const note = createNote();
    state.notes.unshift(note);
    state.activeNoteId = note.id;
    saveNote(note);
    Storage.set('notes_index', state.notes.map(n => ({ id: n.id, title: n.title, updatedAt: n.updatedAt })));

    els.editor.innerHTML = '';
    els.breadcrumbCurrent.textContent = 'Untitled';
    updateCounts();
    renderNotesList();
    updateStorageDisplay();
    els.editor.focus();
    showToast('New note created', 'success');
}

function loadNoteIntoEditor(note) {
    if (!note) return;
    state.activeNoteId = note.id;
    state.snapshots = note.snapshots || [];
    state.lastSnapshotHash = null;

    els.editor.innerHTML = note.content || '';
    els.breadcrumbCurrent.textContent = note.title || 'Untitled';
    updateCounts();
    updateSnapshotCount();
    renderTimeline();
    renderNotesList();
    updateLastSaved(note.updatedAt);
}

function updateNoteTitle() {
    const text = els.editor.innerText.trim();
    const title = text.split('\n')[0].slice(0, 50) || 'Untitled';
    const note = loadNote(state.activeNoteId);
    if (note) {
        note.title = title;
        note.content = els.editor.innerHTML;
        note.updatedAt = Date.now();
        saveNote(note);

        // Update index
        const idx = state.notes.findIndex(n => n.id === state.activeNoteId);
        if (idx !== -1) {
            state.notes[idx].title = title;
            state.notes[idx].updatedAt = note.updatedAt;
        }
        Storage.set('notes_index', state.notes.map(n => ({ id: n.id, title: n.title, updatedAt: n.updatedAt })));

        els.breadcrumbCurrent.textContent = title;
        renderNotesList();
        updateLastSaved(note.updatedAt);
    }
}

// ============================================
// Snapshot System (Debounced + Deduplicated)
// ============================================
function takeSnapshot(force = false) {
    const content = els.editor.innerHTML;
    const hash = getContentHash(content);

    // Skip if content hasn't changed
    if (!force && hash === state.lastSnapshotHash) return;

    state.lastSnapshotHash = hash;

    const snapshot = {
        id: `snap_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        content: content,
        timestamp: Date.now(),
        hash: hash,
        size: new TextEncoder().encode(content).length
    };

    state.snapshots.push(snapshot);

    // Enforce max snapshots limit
    const max = parseInt(state.settings.maxSnapshots);
    if (state.snapshots.length > max) {
        state.snapshots = state.snapshots.slice(-max);
    }

    // Save to note
    const note = loadNote(state.activeNoteId);
    if (note) {
        note.snapshots = state.snapshots;
        saveNote(note);
    }

    updateSnapshotCount();
    updateStorageDisplay();
    renderTimeline();
    state.dirty = true;
}

function debouncedSnapshot() {
    clearTimeout(state.snapshotTimer);
    state.snapshotTimer = setTimeout(() => {
        takeSnapshot();
    }, parseInt(state.settings.snapshotInterval));
}

// ============================================
// Timeline / Replay
// ============================================
function renderTimeline() {
    const list = els.timelineList;
    list.innerHTML = '';

    if (state.snapshots.length === 0) {
        list.innerHTML = '<div class="timeline-item" style="justify-content:center;color:var(--muted-foreground)">No snapshots yet</div>';
        els.timelineScrubber.max = 0;
        els.timelineScrubber.value = 0;
        els.scrubberCurrent.textContent = 'Start';
        els.scrubberTotal.textContent = 'End';
        return;
    }

    els.timelineScrubber.max = state.snapshots.length - 1;

    state.snapshots.forEach((snap, i) => {
        const item = document.createElement('div');
        item.className = 'timeline-item';
        item.dataset.index = i;

        const date = new Date(snap.timestamp);
        const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const preview = stripHtml(snap.content).slice(0, 40) || '(empty)';
        const size = formatBytes(snap.size);

        item.innerHTML = `
            <div class="timeline-dot"></div>
            <div class="timeline-info">
                <div class="timeline-time">${timeStr}</div>
                <div class="timeline-preview">${escapeHtml(preview)}</div>
            </div>
            <div class="timeline-size">${size}</div>
        `;

        item.addEventListener('click', () => {
            jumpToSnapshot(i);
        });

        list.appendChild(item);
    });

    els.scrubberTotal.textContent = state.snapshots.length + ' snaps';
}

function jumpToSnapshot(index) {
    if (index < 0 || index >= state.snapshots.length) return;

    const snap = state.snapshots[index];
    els.editor.innerHTML = snap.content;
    els.timelineScrubber.value = index;

    const date = new Date(snap.timestamp);
    els.scrubberCurrent.textContent = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    // Highlight active
    $$('.timeline-item').forEach((item, i) => {
        item.classList.toggle('active', i === index);
    });

    updateCounts();
}

function startReplay() {
    if (state.isReplaying || state.snapshots.length === 0) return;

    state.isReplaying = true;
    els.timelinePlay.disabled = true;
    els.timelinePause.disabled = false;

    let index = 0;
    const speed = parseInt(els.replaySpeed.value);

    jumpToSnapshot(0);

    state.replayInterval = setInterval(() => {
        index++;
        if (index >= state.snapshots.length) {
            stopReplay();
            showToast('Replay finished', 'success');
            return;
        }
        jumpToSnapshot(index);
    }, speed);
}

function stopReplay() {
    state.isReplaying = false;
    clearInterval(state.replayInterval);
    state.replayInterval = null;
    els.timelinePlay.disabled = false;
    els.timelinePause.disabled = true;
}

// ============================================
// Import / Export
// ============================================
function exportData() {
    const data = {
        version: 2,
        exportedAt: Date.now(),
        settings: state.settings,
        notes: []
    };

    // Load all notes
    const index = Storage.get('notes_index') || [];
    index.forEach(item => {
        const note = loadNote(item.id);
        if (note) data.notes.push(note);
    });

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chrononote_export_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast(`Exported ${data.notes.length} notes`, 'success');
}

let importData = null;

function handleImportFile(file) {
    if (!file || file.type !== 'application/json' && !file.name.endsWith('.json')) {
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

            els.importPreview.innerHTML = `
                <strong>${data.notes.length} notes</strong> found<br>
                <small>Exported: ${new Date(data.exportedAt).toLocaleString()}</small>
            `;
            els.importPreview.classList.add('show');
            els.confirmImport.disabled = false;

        } catch (err) {
            showToast('Invalid JSON file: ' + err.message, 'error');
            els.importPreview.classList.remove('show');
            els.confirmImport.disabled = true;
        }
    };
    reader.readAsText(file);
}

function confirmImport() {
    if (!importData) return;

    // Merge or replace
    const existingIds = new Set(state.notes.map(n => n.id));
    let imported = 0;
    let merged = 0;

    importData.notes.forEach(note => {
        if (existingIds.has(note.id)) {
            // Update existing
            const existing = loadNote(note.id);
            if (existing && note.updatedAt > existing.updatedAt) {
                saveNote(note);
                merged++;
            }
        } else {
            // New note
            saveNote(note);
            state.notes.push({ id: note.id, title: note.title, updatedAt: note.updatedAt });
            imported++;
        }
    });

    // Update index
    Storage.set('notes_index', state.notes.map(n => ({ id: n.id, title: n.title, updatedAt: n.updatedAt })));

    // Apply settings if present
    if (importData.settings) {
        Object.assign(state.settings, importData.settings);
        applySettings();
    }

    renderNotesList();
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
    state.settings.snapshotInterval = els.snapshotInterval.value;
    state.settings.maxSnapshots = els.maxSnapshots.value;
    state.settings.fontSize = els.fontSize.value;
    state.settings.theme = els.theme.value;

    Storage.set('settings', state.settings);
    applySettings();
    showToast('Settings saved', 'success');
}

function applySettings() {
    els.snapshotInterval.value = state.settings.snapshotInterval;
    els.maxSnapshots.value = state.settings.maxSnapshots;
    els.fontSize.value = state.settings.fontSize;
    els.theme.value = state.settings.theme;

    // Font size
    document.documentElement.style.setProperty('--editor-font-size', `${state.settings.fontSize}px`);

    // Theme
    document.documentElement.removeAttribute('data-theme');
    if (state.settings.theme !== 'system') {
        document.documentElement.setAttribute('data-theme', state.settings.theme);
    }
}

function clearAllData() {
    if (!confirm('Are you sure? This will delete ALL notes and snapshots permanently.')) return;

    Storage.clear();
    state.notes = [];
    state.activeNoteId = null;
    state.snapshots = [];

    createNewNote();
    updateStorageDisplay();
    closeModal(els.settingsModal);
    showToast('All data cleared', 'warning');
}

function cleanupOldSnapshots() {
    // Emergency cleanup: keep only last 50 snapshots per note
    state.notes.forEach(noteRef => {
        const note = loadNote(noteRef.id);
        if (note && note.snapshots && note.snapshots.length > 50) {
            note.snapshots = note.snapshots.slice(-50);
            saveNote(note);
        }
    });
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

    // Sort by updatedAt desc
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
            <button class="note-delete" title="Delete" data-id="${note.id}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
            </button>
        `;

        li.addEventListener('click', (e) => {
            if (e.target.closest('.note-delete')) {
                e.stopPropagation();
                deleteNote(note.id);
                return;
            }
            const loaded = loadNote(note.id);
            if (loaded) loadNoteIntoEditor(loaded);
        });

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
    // Editor input
    els.editor.addEventListener('input', () => {
        updateCounts();
        debouncedSnapshot();
        state.dirty = true;
    });

    els.editor.addEventListener('keyup', () => {
        updateToolbarState();
    });

    els.editor.addEventListener('mouseup', () => {
        updateToolbarState();
    });

    // Keyboard shortcuts
    els.editor.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
            e.preventDefault();
            execCmd('insertText', '    ');
        }

        // Save shortcut
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            takeSnapshot(true);
            updateNoteTitle();
            showToast('Saved', 'success');
        }
    });

    // Toolbar buttons
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

    // Sidebar
    els.sidebarToggle.addEventListener('click', () => {
        els.sidebar.classList.toggle('collapsed');
    });

    els.mobileMenuBtn.addEventListener('click', () => {
        els.sidebar.classList.toggle('open');
    });

    els.newNoteBtn.addEventListener('click', createNewNote);

    // Timeline
    els.timelineBtn.addEventListener('click', () => {
        els.timelinePanel.classList.add('open');
        els.timelineOverlay.classList.add('open');
        renderTimeline();
    });

    els.closeTimeline.addEventListener('click', () => {
        els.timelinePanel.classList.remove('open');
        els.timelineOverlay.classList.remove('open');
        stopReplay();
    });

    els.timelineOverlay.addEventListener('click', () => {
        els.timelinePanel.classList.remove('open');
        els.timelineOverlay.classList.remove('open');
        stopReplay();
    });

    els.timelinePlay.addEventListener('click', startReplay);
    els.timelinePause.addEventListener('click', stopReplay);

    els.timelineScrubber.addEventListener('input', (e) => {
        jumpToSnapshot(parseInt(e.target.value));
        if (state.isReplaying) stopReplay();
    });

    // Settings
    els.settingsBtn.addEventListener('click', () => openModal(els.settingsModal));
    els.closeSettings.addEventListener('click', () => closeModal(els.settingsModal));
    els.settingsModal.querySelector('.modal-backdrop').addEventListener('click', () => closeModal(els.settingsModal));

    [els.snapshotInterval, els.maxSnapshots, els.fontSize, els.theme].forEach(el => {
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

    // Auto-save on window blur / before unload
    window.addEventListener('beforeunload', () => {
        if (state.dirty && state.activeNoteId) {
            takeSnapshot(true);
            updateNoteTitle();
        }
    });

    // Periodic storage update
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

    // Focus editor
    setTimeout(() => els.editor.focus(), 100);

    console.log('ChronoNote initialized');
}

// Start
document.addEventListener('DOMContentLoaded', init);
