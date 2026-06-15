# Quilltrace

A lightweight, static note-taking app with per-keystroke time travel. Built as a single HTML/CSS/JS bundle that runs entirely in the browser with no build step, no server, and no dependencies. Perfect for GitHub Pages hosting.

## Features

- **Per-keystroke snapshots**: Every single keystroke is captured as a snapshot. No debouncing, no delay. True granular time travel.
- **Inline replay controls**: Play, pause, and speed controls live directly in the top bar. No overlay panels, no blur effects. Watch your writing replay in real time while the editor stays visible.
- **Independent note titles**: Notes have their own editable titles, separate from the content. No auto-extraction from first sentences.
- **Trash with restore**: Deleted notes go to trash, not oblivion. Restore them anytime or permanently delete. Trash is included in exports.
- **Right-click context menus**: Right-click any note in the sidebar to rename, duplicate, or move to trash.
- **Import / Export**: Full JSON export and import with merge logic. Settings, notes, snapshots, and trash all travel together.
- **Custom replay speed**: Choose from preset speeds (2x, 1x, 0.5x, 0.2x) or enter any custom millisecond interval.
- **Canvas width control**: Adjust the editor content area width from 600px to full width.
- **Shadcn-inspired UI**: Clean, minimal interface with system/light/dark theme support.
- **Mobile responsive**: Collapsible sidebar, multi-line toolbar on small screens, and adaptive replay controls.
- **Storage tracking**: Live storage usage bar with visual indicator.

## Quick Start

1. Download the three files: `index.html`, `styles.css`, `app.js`
2. Place them in the same directory
3. Open `index.html` in any modern browser
4. Or push to GitHub Pages for instant hosting

No build tools, no npm install, no framework. Just open and write.

## File Structure

```
.
├── index.html      # App structure and layout
├── styles.css      # Shadcn-inspired design system
└── app.js          # All logic, storage, and UI
```

## Storage

Quilltrace uses `localStorage` for persistence. All data stays on your device. Nothing is sent to any server. Storage is scoped under the `Quilltrace_v1_` prefix.

Data stored:
- Note index (metadata)
- Individual notes with content and snapshots
- Trash contents
- User settings

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + S` | Save (snapshot is already automatic) |
| `Ctrl/Cmd + B` | Bold |
| `Ctrl/Cmd + I` | Italic |
| `Ctrl/Cmd + U` | Underline |
| `Tab` | Insert 4 spaces |

## Settings

Access settings via the gear icon in the top bar:

- **Canvas Width**: Editor content area width (600px, 800px, 1000px, 1200px, or full width)
- **Max Snapshots**: Limit snapshots per note to prevent storage bloat (50 to 1000)
- **Font Size**: Editor font size (14px to 20px)
- **Theme**: System, light, or dark mode
- **Clear All Data**: One-click wipe everything with confirmation

## Replay

The replay controls are always visible in the top bar when a note has snapshots:

- **Play**: Starts replaying snapshots from the beginning
- **Pause**: Stops replay at current position
- **Speed**: Preset speeds or custom millisecond interval

During replay, the editor content updates in real time. No blur, no overlay, no distraction.

## Context Menu

Right-click any note in the sidebar for:
- **Rename**: Edit the note title
- **Duplicate**: Create a copy with all snapshots
- **Move to Trash**: Soft delete with restore option

Right-click trash items for permanent deletion.

## Export Format

```json
{
  "version": 2,
  "exportedAt": 1234567890,
  "settings": { ... },
  "notes": [
    {
      "id": "note_...",
      "title": "My Note",
      "content": "<p>HTML content</p>",
      "createdAt": 1234567890,
      "updatedAt": 1234567890,
      "snapshots": [
        {
          "id": "snap_...",
          "content": "<p>...</p>",
          "timestamp": 1234567890,
          "hash": "abc123",
          "size": 1024
        }
      ]
    }
  ],
  "trash": [ ... ]
}
```

## Browser Support

Works in all modern browsers that support:
- `localStorage`
- `contenteditable`
- `document.execCommand`
- CSS Grid and Flexbox

## License

MIT. Do whatever you want.
