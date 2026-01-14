# Discourse Click-to-Edit (Updated)

> Forked from [thijsbrilleman/discourse-click-to-edit](https://github.com/thijsbrilleman/discourse-click-to-edit)

## What It Does

**Makes editing posts WAY easier!**

- Click anywhere in the **preview** → Editor jumps to that exact line
- Click/type in the **editor** → Preview scrolls to show what you're editing
- Works with **everything**: Markdown, BBCode, HTML, emojis, tables, images, polls, and more

## Quick Demo

```
YOU TYPE:                           PREVIEW SHOWS:
─────────────────────────────────────────────────────
**bold text**                    →  bold text (bold)
[b]bold text[/b]                 →  bold text (bold)

Click either side → jumps to the other!
```

## Supported Syntax (Everything!)

### Markdown

| Syntax | Example | Works? |
|--------|---------|--------|
| **Bold** | `**text**` | ✅ |
| *Italic* | `*text*` | ✅ |
| ~~Strikethrough~~ | `~~text~~` | ✅ |
| `Code` | `` `code` `` | ✅ |
| Code blocks | ` ``` ` | ✅ |
| # Headings | `# H1` to `###### H6` | ✅ |
| Links | `[text](url)` | ✅ |
| Images | `![alt](url)` | ✅ |
| Blockquotes | `> quote` | ✅ |
| Unordered lists | `* item` or `- item` | ✅ |
| Ordered lists | `1. item` | ✅ |
| Tables | `\| col \| col \|` | ✅ |
| Footnotes | `^[note]` | ✅ |
| Horizontal rule | `---` | ✅ |

### BBCode

| Syntax | Example | Works? |
|--------|---------|--------|
| Bold | `[b]text[/b]` | ✅ |
| Italic | `[i]text[/i]` | ✅ |
| Underline | `[u]text[/u]` | ✅ |
| Strikethrough | `[s]text[/s]` | ✅ |
| Code | `[code]text[/code]` | ✅ |
| Quote | `[quote]text[/quote]` | ✅ |
| URL | `[url=...]text[/url]` | ✅ |
| Image | `[img]url[/img]` | ✅ |
| Color | `[color=#ff0000]text[/color]` | ✅ |
| Size | `[size=4]text[/size]` | ✅ |
| Left/Center/Right | `[center]text[/center]` | ✅ |
| Float | `[floatl]text[/floatl]` | ✅ |
| Spoiler | `[spoiler]text[/spoiler]` | ✅ |
| Details | `[details="Title"]text[/details]` | ✅ |
| Lists | `[list][li]item[/li][/list]` | ✅ |

### Discourse Special Syntax

| Syntax | Example | Works? |
|--------|---------|--------|
| Emojis | `:grinning_face:` | ✅ |
| Mentions | `@username` | ✅ |
| Hashtags | `#category` | ✅ |
| Uploads | `upload://abc123` | ✅ |
| Date picker | `[date=2024-01-01]` | ✅ |
| Polls | `[poll]...[/poll]` | ✅ |
| Wrap | `[wrap=class]...[/wrap]` | ✅ |

### HTML Elements

| Syntax | Example | Works? |
|--------|---------|--------|
| Video | `<video>...</video>` | ✅ |
| Div | `<div>...</div>` | ✅ |
| Theme TOC | `<div data-theme-toc>` | ✅ |
| Theme scrollable | `<div data-theme-scrollable>` | ✅ |

## How To Use

### Desktop
1. **Hover** over any element in preview → Shows "✎ Edit" badge
2. **Click** → Editor jumps to that line and selects it
3. **Type** in editor → Preview automatically scrolls to match

### Mobile / Tablet
1. **Tap** any element in preview → Editor jumps to that line
2. Larger touch targets for easy selection
3. No hover needed - just tap!

## Settings

Go to **Admin → Settings → Plugins** and search for:

| Setting | Description |
|---------|-------------|
| `enable_discourse_click_to_edit` | Turn the plugin on/off |

## Changelog

### v0.14 (Latest)

**Complete syntax support:**
- Added support for ALL Discourse composer syntax
- Full Markdown support (bold, italic, code, headings, lists, tables, images, links, blockquotes, footnotes)
- Full BBCode support (40+ tags including floatl, justify, wrap, etc.)
- Discourse special syntax (emojis, mentions, hashtags, uploads, dates, polls)
- HTML elements (video, div, theme components)
- Smart element detection based on line content
- 3-pass matching: exact → contains → fuzzy
- Special handling for tables, images, videos, polls, dates, spoilers, code blocks

### v0.13
- BBCode support with content-based matching
- Works on `/review` page (site-wide initializer)
- Mobile/tablet responsive design
- "✎ Edit" tooltip badge on hover
- Smooth scroll animations

### v0.12
- Fixed deprecated `require()` calls
- Added debouncing for performance
- Cached DOM references
- Proper Ember lifecycle handling

## How It Works (Technical)

```
1. LINE NUMBER MODE (Markdown)
   ├── Markdown-it adds data-ln="X" to HTML elements
   ├── Click preview → read data-ln → scroll editor to line X
   └── Works instantly and accurately

2. CONTENT MATCHING MODE (BBCode, HTML, special syntax)
   ├── No data-ln attribute available
   ├── Strip all formatting syntax from both sides
   ├── Match by content using 3-pass algorithm:
   │   ├── Pass 1: Exact match
   │   ├── Pass 2: Contains match
   │   └── Pass 3: Fuzzy word-based match
   └── Find best matching element in preview

3. SPECIAL ELEMENT MODE (tables, images, polls, etc.)
   ├── Detect syntax type from line content
   ├── Find corresponding element by type
   └── Match by specific attributes (alt text, cell content, etc.)
```

## Files

```
plugin.rb                                         # Plugin manifest (v0.14)
assets/stylesheets/discourse-click-to-edit.scss   # Styles, tooltips, mobile
assets/javascripts/discourse/initializers/
  └── click-to-edit.js                            # Main logic (site-wide)
assets/javascripts/initializers/
  ├── disable-discourse-composer-scroll-sync.js   # Disables default sync
  └── add-data-ln-attribute-inside-code-blocks.js # Code block line numbers
assets/javascripts/lib/discourse-markdown/
  └── click-to-edit.js                            # Markdown-it integration
assets/vendor/javascripts/
  └── markdown-it-line-numbers.js                 # Line number generator
config/settings.yml                               # Plugin settings
```

## Requirements

- **Discourse 3.0+**
- Works with **standard markdown editor** (textarea)
- Does **NOT** work with rich/ProseMirror editor (automatically skipped)

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Not working at all | Check if `enable_discourse_click_to_edit` is ON in Admin settings |
| Not working on /review | Update to v0.13+ |
| BBCode not syncing | Update to v0.13+ |
| Tables not syncing | Update to v0.14+ |
| Polls/dates not syncing | Update to v0.14+ |
| Video/HTML not syncing | Update to v0.14+ |
| Tooltip not showing | Refresh page, check browser console |
| Mobile not working | Update to v0.13+ |

## Links

- [Original Plugin - Discourse Meta](https://meta.discourse.org/t/click-to-edit/321054)
- [Original Repo](https://github.com/thijsbrilleman/discourse-click-to-edit)
