# Discourse Click-to-Edit (Updated)

> Forked from [thijsbrilleman/discourse-click-to-edit](https://github.com/thijsbrilleman/discourse-click-to-edit)

## What It Does

**Makes editing posts easier!** Click anywhere in the preview to jump to that line in the editor. Works the other way too - click in the editor and the preview scrolls to show you what you're editing.

![Demo](https://meta.discourse.org/uploads/default/original/3X/a/5/a5f14c6a3e3cde0c0a4d2e0e0e0e0e0e0e0e0e0e.gif)

## Features

| Feature | What It Does |
|---------|--------------|
| **Click Preview → Edit** | Click any text in preview, editor jumps to that line and selects it |
| **Type → Preview Scrolls** | As you type or move cursor, preview automatically scrolls to match |
| **Visual Highlight** | Blue box shows which element you're currently editing |
| **Works Both Ways** | Preview ↔ Editor sync in both directions |
| **BBCode Support** | Works with BBCode tags like `[b]`, `[url]`, `[quote]`, etc. |
| **Markdown Support** | Full markdown support with line-number tracking |
| **Mobile Friendly** | Touch-optimized with larger tap targets |
| **Review Page Support** | Works on `/review` page, not just main composer |

## How To Use

### On Desktop
1. **Preview → Editor**: Hover over text in preview (shows "✎ Edit" badge), click to jump to that line
2. **Editor → Preview**: Click or type anywhere in editor, preview scrolls automatically

### On Mobile/Tablet
1. **Tap** any element in preview to jump to editor
2. Larger touch targets for easier selection

## Settings

Go to **Admin → Settings → Plugins** and search for:

| Setting | Description |
|---------|-------------|
| `enable_discourse_click_to_edit` | Turn the plugin on/off |

## Changelog

### v0.13 (Latest)
- **NEW**: BBCode support - works with `[b]`, `[i]`, `[url]`, `[quote]`, `[spoiler]`, etc.
- **NEW**: Content-based matching fallback for elements without line numbers
- **NEW**: Works on `/review` page (converted from connector to site-wide initializer)
- **NEW**: Mobile/tablet responsive design with touch-friendly UI
- **NEW**: "✎ Edit" tooltip badge on hover (bottom-right, never hidden)
- **NEW**: Smooth scroll animations
- **NEW**: Better keyboard navigation (Home, End, PageUp, PageDown)
- **FIX**: Bidirectional sync now works reliably in both directions
- **FIX**: Touch devices get proper tap feedback (no broken hover states)

### v0.12
- **FIX**: Replaced deprecated `require()` with `withPluginApi` + `modifyClass`
- **PERF**: Added 50ms debounce on scroll updates (reduces typing lag)
- **PERF**: Added 100ms debounce on highlight updates
- **PERF**: Cached DOM element references (no repeated lookups)
- **FIX**: Added multiple fallback selectors for review page compatibility
- **FIX**: Proper Ember runloop lifecycle (schedule/debounce/cancel)
- **FIX**: Added isDestroying/isDestroyed checks to prevent cleanup errors

## How It Works (Technical)

```
MARKDOWN MODE:
1. Markdown-it plugin adds data-ln="X" to rendered HTML elements
2. Click preview element → read data-ln → scroll editor to line X
3. Type in editor → calculate line number → find element → scroll preview

BBCODE MODE (Fallback):
1. No data-ln attribute on BBCode elements
2. Click preview element → extract text content → fuzzy match to editor line
3. Type in editor → strip BBCode tags → fuzzy match to preview element
```

## Files

```
plugin.rb                                                    # Plugin manifest
assets/stylesheets/discourse-click-to-edit.scss              # Hover effects, tooltips, mobile styles
assets/javascripts/discourse/initializers/click-to-edit.js   # Main logic (site-wide)
assets/javascripts/initializers/disable-...scroll-sync.js    # Disables default sync
assets/javascripts/initializers/add-data-ln-attribute...js   # Code block line numbers
assets/javascripts/lib/discourse-markdown/click-to-edit.js   # Markdown-it integration
assets/vendor/javascripts/markdown-it-line-numbers.js        # Line number generator
config/settings.yml                                          # Plugin settings
```

## Requirements

- Discourse 3.0+
- Works with **standard markdown editor** (textarea)
- Does **NOT** work with rich/ProseMirror editor (automatically skips)

## Supported BBCode Tags

`b`, `i`, `u`, `s`, `strike`, `code`, `pre`, `quote`, `img`, `url`, `link`, `email`, `size`, `color`, `center`, `right`, `left`, `indent`, `list`, `ul`, `ol`, `li`, `table`, `tr`, `td`, `th`, `spoiler`, `details`, `summary`, `poll`, `date`, `time`, `hide`, `blur`

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Not working at all | Check if `enable_discourse_click_to_edit` is ON in settings |
| Not working on /review | Update to latest version (v0.13+) |
| BBCode not syncing | Make sure you have v0.13+ installed |
| Tooltip not showing | Try refreshing the page, check browser console for errors |
| Works on desktop, not mobile | Update to v0.13+ for mobile support |

## Links

- [Original Plugin - Discourse Meta](https://meta.discourse.org/t/click-to-edit/321054)
- [Original Repo](https://github.com/thijsbrilleman/discourse-click-to-edit)
