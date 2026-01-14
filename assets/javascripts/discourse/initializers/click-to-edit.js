import { withPluginApi } from "discourse/lib/plugin-api";
import { cancel, debounce, schedule } from "@ember/runloop";

const SCROLL_DEBOUNCE_MS = 50;
const HIGHLIGHT_DEBOUNCE_MS = 100;

// =============================================
// SUPPORTED SYNTAX PATTERNS
// =============================================

// BBCode tags (case-insensitive)
const BBCODE_TAGS = [
  // Text formatting
  'b', 'i', 'u', 's', 'strike', 'sub', 'sup',
  // Code
  'code', 'pre', 'mono',
  // Quotes & references
  'quote', 'blockquote',
  // Links & media
  'img', 'url', 'link', 'email', 'video', 'audio',
  // Alignment & layout
  'size', 'color', 'font', 'highlight',
  'center', 'centre', 'left', 'right', 'justify',
  'indent', 'float', 'floatl', 'floatr',
  // Lists
  'list', 'ul', 'ol', 'li',
  // Tables
  'table', 'tr', 'td', 'th', 'thead', 'tbody',
  // Special Discourse BBCode
  'spoiler', 'blur', 'hide', 'nsfw',
  'details', 'summary',
  'poll', 'date', 'time',
  'wrap', 'rawblock',
  // Media embeds
  'youtube', 'vimeo', 'dailymotion',
  // Other
  'hr', 'br', 'clear'
];

// Regex patterns for different syntax types
const PATTERNS = {
  // BBCode: [tag], [tag=value], [/tag]
  bbcode: /\[\/?[\w-]+(?:=[^\]]*)?]/gi,

  // Markdown formatting
  mdBold: /\*\*([^*]+)\*\*/g,
  mdItalic: /\*([^*]+)\*/g,
  mdStrike: /~~([^~]+)~~/g,
  mdCode: /`([^`]+)`/g,
  mdCodeBlock: /```[\s\S]*?```/g,

  // Markdown links & images
  mdLink: /\[([^\]]*)\]\([^)]+\)/g,
  mdImage: /!\[([^\]]*)\]\([^)]+\)/g,
  mdImageUpload: /!\[[^\]]*\]\(upload:\/\/[^)]+\)/g,

  // Markdown headings
  mdHeading: /^#{1,6}\s+/gm,

  // Markdown quotes
  mdQuote: /^>\s*/gm,

  // Markdown lists
  mdUnorderedList: /^[\*\-\+]\s+/gm,
  mdOrderedList: /^\d+\.\s+/gm,

  // Markdown tables
  mdTableRow: /^\|.*\|$/gm,
  mdTableSeparator: /^\|[\s\-:|]+\|$/gm,

  // Markdown footnotes
  mdFootnote: /\^\[([^\]]+)\]/g,

  // Discourse special syntax
  discourseEmoji: /:[\w_+-]+:/g,
  discourseUpload: /upload:\/\/[\w.]+/g,
  discourseMention: /@[\w_-]+/g,
  discourseHashtag: /#[\w_-]+/g,

  // HTML elements
  htmlTag: /<\/?[\w-]+(?:\s+[^>]*)?\/?>/gi,
  htmlVideo: /<video[\s\S]*?<\/video>/gi,
  htmlDiv: /<div[^>]*>[\s\S]*?<\/div>/gi,

  // Date/time picker
  discourseDate: /\[date=[^\]]+\]/gi,

  // Poll syntax
  discoursePoll: /\[poll[^\]]*\][\s\S]*?\[\/poll\]/gi,

  // Details syntax - capture the title
  detailsOpen: /\[details="([^"]+)"\]/i,
  detailsClose: /\[\/details\]/i
};

class ClickToEditHandler {
  constructor() {
    this.clickHandler = null;
    this.scrollHandler = null;
    this.inputHandler = null;
    this.keyDownHandler = null;
    this.editorClickHandler = null;
    this.preview = null;
    this.previewWrapper = null;
    this.scrollParent = null;
    this.textArea = null;
    this.activeElementCSSStyleRule = null;
    this.clonedTextArea = null;
    this.isInitialized = false;
    this._scrollDebounceTimer = null;
    this._highlightDebounceTimer = null;
    this._destroyed = false;
    this._lastHighlightedElement = null;
  }

  initialize(textArea, previewWrapper) {
    if (this.isInitialized || this._destroyed) {
      return;
    }

    // Skip if rich editor (ProseMirror) is active
    const prosemirrorEditor = document.querySelector(".d-editor-textarea-wrapper .ProseMirror");
    if (prosemirrorEditor) {
      return;
    }

    this.textArea = textArea;
    this.previewWrapper = previewWrapper;
    this.scrollParent = previewWrapper.closest(".wmd-controls") ||
                        previewWrapper.closest(".d-editor-container") ||
                        previewWrapper.parentElement;
    this.preview = previewWrapper.querySelector(".d-editor-preview") ||
                   document.querySelector(".d-editor-preview");

    if (!this.previewWrapper || !this.textArea) {
      return;
    }

    this.isInitialized = true;

    // Create style element for highlighting
    this.activeElementCSSStyleRule = document.createElement("style");
    this.activeElementCSSStyleRule.type = "text/css";
    this.activeElementCSSStyleRule.id = "preview-highlight-" + Date.now();
    document.head.appendChild(this.activeElementCSSStyleRule);

    // Bind handlers with proper context
    this.clickHandler = this._handlePreviewClick.bind(this);
    this.scrollHandler = this._handleEditorScroll.bind(this);
    this.inputHandler = this._handleEditorInput.bind(this);
    this.keyDownHandler = this._handleEditorKeyDown.bind(this);
    this.editorClickHandler = this._handleEditorClick.bind(this);

    // Add event listeners
    // Preview → Editor
    this.previewWrapper.addEventListener("mousedown", this.clickHandler);

    // Editor → Preview
    this.textArea.addEventListener("mouseup", this.scrollHandler);
    this.textArea.addEventListener("click", this.editorClickHandler);
    this.textArea.addEventListener("input", this.inputHandler);
    this.textArea.addEventListener("keydown", this.keyDownHandler);
    this.textArea.addEventListener("keyup", this._handleEditorKeyUp.bind(this));
  }

  // =============================================
  // PREVIEW → EDITOR (clicking preview scrolls to editor)
  // =============================================

  _handlePreviewClick(event) {
    event.preventDefault();
    event.stopPropagation();

    const target = event.target;

    // Special handling for details/summary elements
    const detailsMatch = this._handleDetailsClick(target);
    if (detailsMatch !== null) {
      this.scrollTextAreaToCorrectPosition(detailsMatch.line);
      if (detailsMatch.element) {
        this.updateActiveElementCSSStyleRule(detailsMatch.element);
      }
      return;
    }

    // Special handling for video elements
    const videoMatch = this._handleVideoClick(target);
    if (videoMatch !== null) {
      this.scrollTextAreaToCorrectPosition(videoMatch);
      this.updateActiveElementCSSStyleRule(target.closest('video') || target);
      return;
    }

    // Try line number first (works for Markdown with data-ln)
    const lineNumber = this.getLineNumber(target);
    if (lineNumber !== null) {
      this.scrollTextAreaToCorrectPosition(lineNumber);
      const previewElement = this.findElementByLineNumber(lineNumber);
      if (previewElement) {
        this.updateActiveElementCSSStyleRule(previewElement);
      }
      return;
    }

    // Fallback: content-based matching (works for BBCode, HTML, special syntax)
    const matchedLine = this.findLineByContent(target);
    if (matchedLine !== null) {
      this.scrollTextAreaToCorrectPosition(matchedLine);
      this.updateActiveElementCSSStyleRule(target);
    }
  }

  // =============================================
  // DETAILS/SUMMARY SPECIAL HANDLING
  // =============================================

  _handleDetailsClick(target) {
    if (!this.textArea) return null;

    // Check if clicked on summary element (the clickable title)
    const summary = target.closest('summary');
    if (summary) {
      const details = summary.closest('details');
      // Find the [details="..."] line that matches this summary
      return this._findDetailsOpeningLine(summary.textContent?.trim(), details);
    }

    // Check if clicked inside a details element (but not summary)
    const details = target.closest('details');
    if (details && !target.closest('summary')) {
      // Find the content line or the closing tag
      const contentLine = this._findDetailsContentLine(target, details);
      if (contentLine !== null) {
        return { line: contentLine, element: target };
      }
    }

    return null;
  }

  _findDetailsOpeningLine(summaryText, detailsElement) {
    const lines = this.textArea.value.split("\n");

    // Find [details="..."] line
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(PATTERNS.detailsOpen);
      if (match) {
        // Found a details opening tag
        // If we have multiple details, try to match by title
        if (summaryText) {
          const titleInTag = match[1];
          const normalizedTitle = this.normalizeText(titleInTag);
          const normalizedSummary = this.normalizeText(summaryText);
          if (normalizedTitle === normalizedSummary ||
              normalizedTitle.includes(normalizedSummary) ||
              normalizedSummary.includes(normalizedTitle)) {
            return { line: i, element: detailsElement };
          }
        }
        // If no summary text or no match yet, return first found
        if (!summaryText) {
          return { line: i, element: detailsElement };
        }
      }
    }

    // Fallback: return first details line found
    for (let i = 0; i < lines.length; i++) {
      if (PATTERNS.detailsOpen.test(lines[i])) {
        return { line: i, element: detailsElement };
      }
    }

    return null;
  }

  _findDetailsContentLine(target, detailsElement) {
    const lines = this.textArea.value.split("\n");
    const targetText = target.textContent?.trim();

    if (!targetText) return null;

    // Find the details block boundaries
    let detailsStart = -1;
    let detailsEnd = -1;

    for (let i = 0; i < lines.length; i++) {
      if (PATTERNS.detailsOpen.test(lines[i])) {
        detailsStart = i;
      }
      if (detailsStart >= 0 && PATTERNS.detailsClose.test(lines[i])) {
        detailsEnd = i;
        break;
      }
    }

    if (detailsStart < 0) return null;

    // Search within the details block for matching content
    const normalizedTarget = this.normalizeText(targetText);
    for (let i = detailsStart + 1; i < (detailsEnd > 0 ? detailsEnd : lines.length); i++) {
      const strippedLine = this.stripAllSyntax(lines[i]);
      const normalizedLine = this.normalizeText(strippedLine);

      if (normalizedLine && normalizedTarget) {
        if (normalizedLine === normalizedTarget ||
            normalizedLine.includes(normalizedTarget) ||
            normalizedTarget.includes(normalizedLine)) {
          return i;
        }
      }
    }

    // If clicking near end, return the [/details] line
    return detailsEnd > 0 ? detailsEnd : null;
  }

  _findDetailsClosingLine() {
    const lines = this.textArea.value.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      if (PATTERNS.detailsClose.test(lines[i])) {
        return i;
      }
    }
    return null;
  }

  // =============================================
  // VIDEO SPECIAL HANDLING
  // =============================================

  _handleVideoClick(target) {
    // Check if clicked on video or inside video container
    const video = target.closest('video');
    const videoContainer = target.closest('.video-container, .video-placeholder-container, .onebox-video');

    if (!video && !videoContainer) return null;

    const lines = this.textArea.value.split("\n");

    // Look for video-related syntax
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // HTML video tag
      if (/<video/i.test(line)) {
        return i;
      }
      // BBCode video
      if (/\[video\]/i.test(line)) {
        return i;
      }
      // Video URL patterns
      if (/\.(mp4|webm|ogg|mov)/i.test(line)) {
        return i;
      }
      // YouTube/Vimeo embeds
      if (/youtube\.com|youtu\.be|vimeo\.com/i.test(line)) {
        return i;
      }
    }

    return null;
  }

  // =============================================
  // EDITOR → PREVIEW (clicking/typing in editor scrolls preview)
  // =============================================

  _handleEditorClick(event) {
    // Small delay to let selection settle
    setTimeout(() => this._syncEditorToPreview(), 10);
  }

  _handleEditorScroll() {
    this._debouncedScrollPreview();
  }

  _handleEditorInput() {
    this._debouncedScrollPreview();
  }

  _handleEditorKeyDown(event) {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", "Enter", "Backspace", "Delete"].includes(event.key)) {
      this._debouncedScrollPreview();
    }
  }

  _handleEditorKeyUp(event) {
    // Also sync on key up for better responsiveness
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(event.key)) {
      this._syncEditorToPreview();
    }
  }

  _debouncedScrollPreview() {
    if (this._destroyed) {
      return;
    }

    this._scrollDebounceTimer = debounce(
      this,
      this._syncEditorToPreview,
      SCROLL_DEBOUNCE_MS
    );
  }

  _syncEditorToPreview() {
    if (this._destroyed || !this.textArea || !this.previewWrapper) {
      return;
    }

    // Prevent collapse during redraw
    if (this.preview && this.preview.scrollHeight > 0) {
      this.preview.style.minHeight = `${this.preview.scrollHeight}px`;
    }

    const cursorPosition = this.textArea.selectionStart;
    const textUpToCursor = this.textArea.value.substring(0, cursorPosition);
    const lineNumber = textUpToCursor.split("\n").length - 1;
    const currentLineText = this.getLineText(lineNumber);

    // Special handling for details syntax in editor
    let previewElement = this._findPreviewElementForDetailsSyntax(currentLineText, lineNumber);

    // Try finding element by line number first (Markdown with data-ln)
    if (!previewElement) {
      previewElement = this.findElementByLineNumber(lineNumber);
    }

    // If not found, try content-based matching
    if (!previewElement && currentLineText) {
      previewElement = this.findElementByContent(currentLineText, lineNumber);
    }

    // Special handling for specific element types
    if (!previewElement) {
      previewElement = this.findElementBySpecialSyntax(currentLineText, lineNumber);
    }

    if (previewElement) {
      this._highlightDebounceTimer = debounce(
        this,
        () => this.updateActiveElementCSSStyleRule(previewElement),
        HIGHLIGHT_DEBOUNCE_MS
      );

      // Scroll preview to show the element
      this.scrollPreviewToElement(previewElement);
    }
  }

  _findPreviewElementForDetailsSyntax(lineText, lineNumber) {
    if (!this.previewWrapper) return null;

    // Check if on [details="..."] line
    const detailsOpenMatch = lineText.match(PATTERNS.detailsOpen);
    if (detailsOpenMatch) {
      const title = detailsOpenMatch[1];
      const normalizedTitle = this.normalizeText(title);

      // Find the details element with matching summary
      const allDetails = this.previewWrapper.querySelectorAll('details');
      for (const details of allDetails) {
        const summary = details.querySelector('summary');
        if (summary) {
          const summaryText = this.normalizeText(summary.textContent);
          if (summaryText === normalizedTitle ||
              summaryText.includes(normalizedTitle) ||
              normalizedTitle.includes(summaryText)) {
            return details;
          }
        }
      }
      // Return first details if no match
      if (allDetails.length > 0) return allDetails[0];
    }

    // Check if on [/details] line
    if (PATTERNS.detailsClose.test(lineText)) {
      // Find content just before [/details]
      const lines = this.textArea.value.split("\n");
      // Look backwards for content
      for (let i = lineNumber - 1; i >= 0; i--) {
        const prevLine = lines[i].trim();
        if (prevLine && !PATTERNS.detailsOpen.test(prevLine) && !PATTERNS.detailsClose.test(prevLine)) {
          // Find this content in preview
          const normalizedPrev = this.normalizeText(this.stripAllSyntax(prevLine));
          if (normalizedPrev) {
            // Look inside details elements
            const allDetails = this.previewWrapper.querySelectorAll('details');
            for (const details of allDetails) {
              const content = details.textContent;
              if (this.normalizeText(content).includes(normalizedPrev)) {
                return details;
              }
            }
          }
          break;
        }
      }
      // Fallback: return last details element
      const allDetails = this.previewWrapper.querySelectorAll('details');
      if (allDetails.length > 0) return allDetails[allDetails.length - 1];
    }

    return null;
  }

  scrollPreviewToElement(element) {
    if (!element || !this.previewWrapper) return;

    const offset = this.getOffsetTopUntil(element, this.scrollParent);
    const targetScroll = offset - parseInt(this.previewWrapper.clientHeight / 2, 10);

    // Smooth scroll
    this.previewWrapper.scrollTo({
      top: Math.max(0, targetScroll),
      behavior: 'smooth'
    });
  }

  // =============================================
  // CONTENT-BASED MATCHING (for all syntax types)
  // =============================================

  findLineByContent(element) {
    if (!element || !this.textArea) return null;

    const elementText = element.textContent?.trim();
    if (!elementText || elementText.length < 1) return null;

    const lines = this.textArea.value.split("\n");
    const normalizedTarget = this.normalizeText(elementText);

    // First pass: exact match
    for (let i = 0; i < lines.length; i++) {
      const strippedLine = this.stripAllSyntax(lines[i]);
      const normalizedLine = this.normalizeText(strippedLine);

      if (normalizedLine && normalizedTarget) {
        // Exact match
        if (normalizedLine === normalizedTarget) {
          return i;
        }
      }
    }

    // Second pass: contains match
    for (let i = 0; i < lines.length; i++) {
      const strippedLine = this.stripAllSyntax(lines[i]);
      const normalizedLine = this.normalizeText(strippedLine);

      if (normalizedLine && normalizedTarget) {
        if (normalizedLine.includes(normalizedTarget) ||
            normalizedTarget.includes(normalizedLine)) {
          return i;
        }
      }
    }

    // Third pass: fuzzy match
    for (let i = 0; i < lines.length; i++) {
      const strippedLine = this.stripAllSyntax(lines[i]);
      const normalizedLine = this.normalizeText(strippedLine);

      if (normalizedLine && normalizedTarget && this.fuzzyMatch(normalizedLine, normalizedTarget)) {
        return i;
      }
    }

    return null;
  }

  findElementByContent(lineText, lineNumber) {
    if (!lineText || !this.previewWrapper) return null;

    const strippedText = this.stripAllSyntax(lineText);
    const normalizedLine = this.normalizeText(strippedText);

    if (!normalizedLine || normalizedLine.length < 1) return null;

    // Determine what type of element to look for based on line content
    const elementTypes = this.getExpectedElementTypes(lineText);

    // Get candidate elements
    const selector = elementTypes.join(', ');
    const candidates = this.previewWrapper.querySelectorAll(selector);

    let bestMatch = null;
    let bestScore = 0;

    for (const candidate of candidates) {
      // Skip if element already has a matching data-ln
      const dataLn = candidate.getAttribute('data-ln');
      if (dataLn !== null && parseInt(dataLn, 10) !== lineNumber) continue;

      const candidateText = this.normalizeText(candidate.textContent);
      if (!candidateText) continue;

      const score = this.getMatchScore(normalizedLine, candidateText);
      if (score > bestScore && score > 0.3) {
        bestScore = score;
        bestMatch = candidate;
      }
    }

    return bestMatch;
  }

  findElementBySpecialSyntax(lineText, lineNumber) {
    if (!lineText || !this.previewWrapper) return null;

    // Check for specific patterns and find corresponding elements

    // Tables
    if (lineText.includes('|') && PATTERNS.mdTableRow.test(lineText)) {
      const tables = this.previewWrapper.querySelectorAll('table');
      if (tables.length > 0) {
        // Find the row that matches
        const cells = lineText.split('|').filter(c => c.trim()).map(c => this.normalizeText(c.trim()));
        for (const table of tables) {
          const rows = table.querySelectorAll('tr');
          for (const row of rows) {
            const rowCells = Array.from(row.querySelectorAll('td, th')).map(c => this.normalizeText(c.textContent));
            if (cells.some(c => rowCells.some(rc => rc.includes(c) || c.includes(rc)))) {
              return row;
            }
          }
        }
        return tables[0];
      }
    }

    // Images
    if (lineText.includes('![') || /\[img\]/i.test(lineText)) {
      const images = this.previewWrapper.querySelectorAll('img');
      if (images.length > 0) {
        // Try to match by alt text or filename
        const altMatch = lineText.match(/!\[([^\]]*)\]/);
        if (altMatch) {
          const altText = this.normalizeText(altMatch[1]);
          for (const img of images) {
            if (this.normalizeText(img.alt).includes(altText)) {
              return img.parentElement || img;
            }
          }
        }
        return images[0].parentElement || images[0];
      }
    }

    // Videos - enhanced handling
    if (lineText.includes('<video') || /\[video\]/i.test(lineText) ||
        /\.(mp4|webm|ogg|mov)/i.test(lineText) ||
        /youtube\.com|youtu\.be|vimeo\.com/i.test(lineText)) {
      const videos = this.previewWrapper.querySelectorAll('video, .video-container, .onebox, .onebox-video, iframe[src*="youtube"], iframe[src*="vimeo"]');
      if (videos.length > 0) return videos[0];
    }

    // Polls
    if (/\[poll/i.test(lineText)) {
      const polls = this.previewWrapper.querySelectorAll('.poll, [data-poll-name]');
      if (polls.length > 0) return polls[0];
    }

    // Dates
    if (/\[date=/i.test(lineText)) {
      const dates = this.previewWrapper.querySelectorAll('.discourse-local-date, [data-date]');
      if (dates.length > 0) return dates[0];
    }

    // Details/spoilers - use enhanced handling
    if (PATTERNS.detailsOpen.test(lineText)) {
      const match = lineText.match(PATTERNS.detailsOpen);
      if (match) {
        const title = match[1];
        const normalizedTitle = this.normalizeText(title);
        const allDetails = this.previewWrapper.querySelectorAll('details');
        for (const details of allDetails) {
          const summary = details.querySelector('summary');
          if (summary) {
            const summaryText = this.normalizeText(summary.textContent);
            if (summaryText.includes(normalizedTitle) || normalizedTitle.includes(summaryText)) {
              return details;
            }
          }
        }
        if (allDetails.length > 0) return allDetails[0];
      }
    }

    if (PATTERNS.detailsClose.test(lineText)) {
      const allDetails = this.previewWrapper.querySelectorAll('details');
      if (allDetails.length > 0) return allDetails[allDetails.length - 1];
    }

    if (/\[spoiler\]/i.test(lineText)) {
      const spoilers = this.previewWrapper.querySelectorAll('.spoiler, .spoiled, .spoiler-blurred');
      if (spoilers.length > 0) return spoilers[0];
    }

    // Code blocks
    if (lineText.startsWith('```') || /\[code\]/i.test(lineText)) {
      const codeBlocks = this.previewWrapper.querySelectorAll('pre, code');
      if (codeBlocks.length > 0) return codeBlocks[0];
    }

    // Blockquotes
    if (lineText.startsWith('>') || /\[quote/i.test(lineText)) {
      const quotes = this.previewWrapper.querySelectorAll('blockquote, .quote');
      if (quotes.length > 0) return quotes[0];
    }

    // Headings
    const headingMatch = lineText.match(/^(#{1,6})\s/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const headings = this.previewWrapper.querySelectorAll(`h${level}`);
      if (headings.length > 0) {
        const headingText = this.normalizeText(lineText.replace(/^#+\s*/, ''));
        for (const h of headings) {
          if (this.normalizeText(h.textContent).includes(headingText)) {
            return h;
          }
        }
        return headings[0];
      }
    }

    // Emojis
    if (PATTERNS.discourseEmoji.test(lineText)) {
      const emojis = this.previewWrapper.querySelectorAll('img.emoji, .emoji');
      if (emojis.length > 0) return emojis[0].closest('p') || emojis[0];
    }

    return null;
  }

  getExpectedElementTypes(lineText) {
    const types = new Set(['p', 'li', 'span', 'div']);

    // Headings
    if (/^#{1,6}\s/.test(lineText)) {
      const level = (lineText.match(/^(#+)/) || ['', '#'])[1].length;
      types.add(`h${level}`);
    }

    // Lists
    if (/^[\*\-\+]\s/.test(lineText) || /^\d+\.\s/.test(lineText) || /\[li\]/i.test(lineText)) {
      types.add('li');
      types.add('ul');
      types.add('ol');
    }

    // Tables
    if (lineText.includes('|')) {
      types.add('table');
      types.add('tr');
      types.add('td');
      types.add('th');
    }

    // Blockquotes
    if (lineText.startsWith('>') || /\[quote/i.test(lineText)) {
      types.add('blockquote');
      types.add('.quote');
    }

    // Code
    if (lineText.includes('`') || /\[code\]/i.test(lineText)) {
      types.add('code');
      types.add('pre');
    }

    // Links
    if (/\[.*\]\(.*\)/.test(lineText) || /\[url/i.test(lineText)) {
      types.add('a');
    }

    // Images
    if (/!\[.*\]/.test(lineText) || /\[img\]/i.test(lineText)) {
      types.add('img');
      types.add('.lightbox-wrapper');
    }

    // Videos
    if (/<video/i.test(lineText) || /\[video\]/i.test(lineText) || /\.(mp4|webm|ogg)/i.test(lineText)) {
      types.add('video');
      types.add('.video-container');
      types.add('.onebox');
    }

    // Bold/italic/formatting
    if (/\*\*.*\*\*/.test(lineText) || /\[b\]/i.test(lineText)) {
      types.add('strong');
      types.add('b');
    }
    if (/\*[^*]+\*/.test(lineText) || /\[i\]/i.test(lineText)) {
      types.add('em');
      types.add('i');
    }

    // Special elements
    if (/\[details/i.test(lineText)) {
      types.add('details');
      types.add('summary');
    }
    if (/\[spoiler/i.test(lineText)) types.add('.spoiler');
    if (/\[poll/i.test(lineText)) types.add('.poll');
    if (/\[date/i.test(lineText)) types.add('.discourse-local-date');

    return Array.from(types);
  }

  // =============================================
  // TEXT PROCESSING
  // =============================================

  stripAllSyntax(text) {
    if (!text) return '';

    let result = text;

    // Strip BBCode tags
    result = result.replace(PATTERNS.bbcode, '');

    // Strip Markdown formatting
    result = result.replace(PATTERNS.mdBold, '$1');
    result = result.replace(PATTERNS.mdItalic, '$1');
    result = result.replace(PATTERNS.mdStrike, '$1');
    result = result.replace(PATTERNS.mdCode, '$1');
    result = result.replace(PATTERNS.mdLink, '$1');
    result = result.replace(PATTERNS.mdImage, '$1');
    result = result.replace(PATTERNS.mdHeading, '');
    result = result.replace(PATTERNS.mdQuote, '');
    result = result.replace(PATTERNS.mdUnorderedList, '');
    result = result.replace(PATTERNS.mdOrderedList, '');
    result = result.replace(PATTERNS.mdFootnote, '$1');

    // Strip HTML tags
    result = result.replace(PATTERNS.htmlTag, '');

    // Strip Discourse special syntax
    result = result.replace(PATTERNS.discourseUpload, '');
    result = result.replace(PATTERNS.discourseDate, '');

    // Clean up table syntax
    result = result.replace(/^\||\|$/g, '');
    result = result.replace(/\|/g, ' ');

    return result.trim();
  }

  normalizeText(text) {
    if (!text) return '';
    return text
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s\u00C0-\u024F\u1E00-\u1EFF]/g, '') // Keep unicode letters
      .trim();
  }

  fuzzyMatch(str1, str2) {
    if (!str1 || !str2) return false;
    const shorter = str1.length < str2.length ? str1 : str2;
    const longer = str1.length < str2.length ? str2 : str1;

    if (shorter.length < 3) return shorter === longer;

    // Check word overlap
    const words1 = shorter.split(' ').filter(w => w.length > 2);
    const words2 = longer.split(' ').filter(w => w.length > 2);

    if (words1.length === 0) return false;

    let matches = 0;
    for (const word of words1) {
      if (words2.some(w => w.includes(word) || word.includes(w))) {
        matches++;
      }
    }

    return matches / words1.length >= 0.5;
  }

  getMatchScore(str1, str2) {
    if (!str1 || !str2) return 0;

    // Exact match
    if (str1 === str2) return 1;

    // Contains match
    if (str1.includes(str2) || str2.includes(str1)) {
      const shorter = Math.min(str1.length, str2.length);
      const longer = Math.max(str1.length, str2.length);
      return shorter / longer;
    }

    // Word-based matching
    const words1 = str1.split(' ').filter(w => w.length > 2);
    const words2 = str2.split(' ').filter(w => w.length > 2);

    if (words1.length === 0 || words2.length === 0) return 0;

    let matches = 0;
    for (const word of words1) {
      if (words2.some(w => w.includes(word) || word.includes(w))) {
        matches++;
      }
    }

    return matches / Math.max(words1.length, words2.length);
  }

  getLineText(lineNumber) {
    if (!this.textArea) return '';
    const lines = this.textArea.value.split("\n");
    return lines[lineNumber] || '';
  }

  // =============================================
  // LINE NUMBER BASED MATCHING (for Markdown)
  // =============================================

  findElementByLineNumber(line) {
    if (line === null || !this.previewWrapper) {
      return null;
    }

    const previewElements = this.previewWrapper.querySelectorAll(`[data-ln="${line}"]`);
    if (previewElements.length > 0) {
      return previewElements[previewElements.length - 1];
    }

    if (line === 0) {
      return null;
    }

    return this.findElementByLineNumber(line - 1);
  }

  getLineNumber(target) {
    if (!target || target.nodeName === "HTML") {
      return null;
    }

    const ln = target.getAttribute?.("data-ln");
    if (ln !== null) {
      return parseInt(ln, 10);
    }

    return this.getLineNumber(target.parentElement);
  }

  // =============================================
  // SCROLL & HIGHLIGHT HELPERS
  // =============================================

  scrollTextAreaToCorrectPosition(lineIndex) {
    if (lineIndex === null || !this.textArea) {
      return;
    }

    const ta = this.textArea;
    const newlines = [-1];
    for (let i = 0; i < ta.value.length; ++i) {
      if (ta.value[i] === "\n") {
        newlines.push(i);
      }
    }

    const selStart = newlines[lineIndex] + 1;
    const selEnd = newlines[lineIndex + 1] || ta.value.length;

    if (this.isSafari()) {
      this._scrollSafari(ta, selStart);
    } else {
      ta.selectionStart = ta.selectionEnd = selStart;
      ta.blur();
      ta.focus();
    }

    ta.selectionStart = selStart;
    ta.selectionEnd = selEnd;
  }

  _scrollSafari(ta, selStart) {
    if (!this.clonedTextArea) {
      this.clonedTextArea = ta.cloneNode();
      this.clonedTextArea.style.cssText =
        "visibility:hidden;position:absolute;left:-9999px;top:-9999px;height:1px;overflow:hidden";
      document.body.appendChild(this.clonedTextArea);
    }

    const computedStyle = getComputedStyle(ta);
    this.clonedTextArea.style.width = computedStyle.width;
    this.clonedTextArea.style.fontSize = computedStyle.fontSize;
    this.clonedTextArea.style.lineHeight = computedStyle.lineHeight;
    this.clonedTextArea.style.fontFamily = computedStyle.fontFamily;
    this.clonedTextArea.value = ta.value.substring(0, selStart);

    const scrollTop = this.clonedTextArea.scrollHeight;
    const lineHeight = parseInt(computedStyle.lineHeight, 10);
    const textAreaHeight = ta.clientHeight;
    let verticalCenter = Math.max(0, scrollTop - textAreaHeight / 2 + lineHeight / 2);

    if (scrollTop < textAreaHeight / 2) {
      verticalCenter = 0;
    }

    ta.scrollTop = verticalCenter;
  }

  updateActiveElementCSSStyleRule(previewElement) {
    if (!this.activeElementCSSStyleRule || this._destroyed || !previewElement) {
      return;
    }

    // Skip if same element
    if (this._lastHighlightedElement === previewElement) {
      return;
    }
    this._lastHighlightedElement = previewElement;

    // Clean up duplicate highlight styles
    const highlightElements = document.querySelectorAll("[id^='preview-highlight-']");
    for (let i = 0; i < highlightElements.length - 1; i++) {
      highlightElements[i].remove();
    }

    const selector = this.getUniqueCSSSelector(previewElement);
    this.activeElementCSSStyleRule.innerHTML = `
      ${selector} {
        box-shadow: 0px 0px 0px 2px var(--tertiary, rgba(0,144,237,.7)) !important;
        background-color: var(--tertiary-low, rgba(0, 144, 237, 0.15)) !important;
        border-radius: 3px;
        z-index: 3;
        transition: box-shadow 0.2s ease, background-color 0.2s ease;
      }
    `;
  }

  getOffsetTopUntil(elem, parent) {
    if (!elem || !parent) {
      return 0;
    }

    const offsetParent = elem.offsetParent;
    const offsetTop = elem.offsetTop;

    if (offsetParent === parent) {
      return offsetTop;
    }

    return offsetTop + this.getOffsetTopUntil(offsetParent, parent);
  }

  getUniqueCSSSelector(el) {
    const stack = [];
    while (el && el.parentNode && el.nodeName.toLowerCase() !== "html") {
      let sibCount = 0;
      let sibIndex = 0;
      const siblings = el.parentNode.childNodes;

      for (let i = 0; i < siblings.length; i++) {
        const sib = siblings[i];
        if (sib.nodeType === Node.ELEMENT_NODE && sib.nodeName === el.nodeName) {
          if (sib === el) {
            sibIndex = sibCount;
          }
          sibCount++;
        }
      }

      if (el.id) {
        stack.unshift(el.nodeName.toLowerCase() + "#" + el.id);
      } else if (sibCount > 1) {
        stack.unshift(el.nodeName.toLowerCase() + ":nth-of-type(" + (sibIndex + 1) + ")");
      } else {
        stack.unshift(el.nodeName.toLowerCase());
      }

      el = el.parentNode;
    }

    return stack.join(" > ");
  }

  isSafari() {
    const ua = navigator.userAgent;
    return ua.indexOf("Safari") > -1 && ua.indexOf("Chrome") === -1;
  }

  // =============================================
  // CLEANUP
  // =============================================

  destroy() {
    this._destroyed = true;

    if (this._scrollDebounceTimer) {
      cancel(this._scrollDebounceTimer);
    }
    if (this._highlightDebounceTimer) {
      cancel(this._highlightDebounceTimer);
    }

    if (this.previewWrapper && this.clickHandler) {
      this.previewWrapper.removeEventListener("mousedown", this.clickHandler);
    }
    if (this.textArea) {
      if (this.scrollHandler) {
        this.textArea.removeEventListener("mouseup", this.scrollHandler);
      }
      if (this.editorClickHandler) {
        this.textArea.removeEventListener("click", this.editorClickHandler);
      }
      if (this.inputHandler) {
        this.textArea.removeEventListener("input", this.inputHandler);
      }
      if (this.keyDownHandler) {
        this.textArea.removeEventListener("keydown", this.keyDownHandler);
      }
    }

    if (this.activeElementCSSStyleRule && this.activeElementCSSStyleRule.parentNode) {
      this.activeElementCSSStyleRule.parentNode.removeChild(this.activeElementCSSStyleRule);
    }

    if (this.clonedTextArea && this.clonedTextArea.parentNode) {
      this.clonedTextArea.parentNode.removeChild(this.clonedTextArea);
    }

    this.clickHandler = null;
    this.scrollHandler = null;
    this.inputHandler = null;
    this.keyDownHandler = null;
    this.editorClickHandler = null;
    this.preview = null;
    this.previewWrapper = null;
    this.scrollParent = null;
    this.textArea = null;
    this.activeElementCSSStyleRule = null;
    this.clonedTextArea = null;
    this._lastHighlightedElement = null;
    this.isInitialized = false;
  }
}

// Track active handlers by textarea element
const activeHandlers = new WeakMap();

function initializeClickToEdit(textArea) {
  if (!textArea || activeHandlers.has(textArea)) {
    return;
  }

  const previewWrapper = document.querySelector(".d-editor-preview-wrapper");
  if (!previewWrapper) {
    return;
  }

  const handler = new ClickToEditHandler();
  handler.initialize(textArea, previewWrapper);
  activeHandlers.set(textArea, handler);

  // Clean up when textarea is removed from DOM
  const observer = new MutationObserver((mutations) => {
    if (!document.body.contains(textArea)) {
      handler.destroy();
      activeHandlers.delete(textArea);
      observer.disconnect();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

function checkForEditors() {
  // Find all textareas in d-editor components
  const textareas = document.querySelectorAll(".d-editor-textarea-wrapper textarea");
  textareas.forEach((textarea) => {
    if (!activeHandlers.has(textarea)) {
      // Wait a bit for preview to be ready
      schedule("afterRender", null, () => initializeClickToEdit(textarea));
    }
  });
}

export default {
  name: "click-to-edit-site-wide",

  initialize(container) {
    withPluginApi("1.0.0", (api) => {
      // Check on route changes
      api.onPageChange(() => {
        schedule("afterRender", null, checkForEditors);
      });

      // Also observe DOM for dynamically added editors
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
            for (const node of mutation.addedNodes) {
              if (node.nodeType === Node.ELEMENT_NODE) {
                if (node.matches?.(".d-editor-textarea-wrapper textarea") ||
                    node.querySelector?.(".d-editor-textarea-wrapper textarea")) {
                  schedule("afterRender", null, checkForEditors);
                  return;
                }
              }
            }
          }
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });

      // Initial check
      schedule("afterRender", null, checkForEditors);
    });
  }
};
