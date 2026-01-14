# Discourse Click-to-Edit (Updated)

> Forked from [thijsbrilleman/discourse-click-to-edit](https://github.com/thijsbrilleman/discourse-click-to-edit)

## What It Does

Syncs composer preview and editor: click preview to jump to source line, type in editor to scroll preview.

## Features

- **Click Preview**: Click any element in preview → jumps to that line in editor
- **Auto-scroll Preview**: Typing/navigating in editor → preview scrolls to match
- **Line Highlighting**: Shows blue highlight on active element in preview
- **Bi-directional Sync**: Works both ways (preview ↔ editor)
- **Safari Support**: Special handling for Safari scroll behavior

## Settings

| Setting | Description |
|---------|-------------|
| `enable_discourse_click_to_edit` | Master on/off switch |

## Changes from Original

- **FIX**: Replaced deprecated `require()` with `withPluginApi` + `modifyClass`
- **PERF**: Added 50ms debounce on scroll updates (reduces typing lag)
- **PERF**: Added 100ms debounce on highlight updates
- **PERF**: Cached DOM element references (no repeated lookups)
- **FIX**: Added multiple fallback selectors for review page compatibility
- **FIX**: Proper Ember runloop lifecycle (schedule/debounce/cancel)
- **FIX**: Added isDestroying/isDestroyed checks to prevent cleanup errors

## How It Works

```
1. Markdown-it plugin adds data-ln="X" attributes to rendered HTML elements
2. User clicks element in preview → reads data-ln → scrolls editor to line X
3. User types in editor → calculates current line → finds element with data-ln → scrolls preview
4. Disables Discourse's default scroll sync (this plugin does it better)
```

## Files

```
plugin.rb                                                    # Plugin manifest
assets/javascripts/discourse/connectors/.../click-to-edit.js # Main component
assets/javascripts/initializers/disable-...scroll-sync.js    # Disables default sync
assets/javascripts/initializers/add-data-ln-attribute...js   # Adds line numbers to code blocks
assets/javascripts/lib/discourse-markdown/click-to-edit.js   # Markdown-it integration
assets/vendor/javascripts/markdown-it-line-numbers.js        # Line number generator
config/settings.yml                                          # Plugin settings
```

## Requirements

- Works with standard markdown editor (textarea)
- Does NOT work with rich/ProseMirror editor
- Automatically skips if rich editor detected

## Original Docs

[Click-to-Edit - Discourse Meta](https://meta.discourse.org/t/click-to-edit/321054)
