import { withPluginApi } from "discourse/lib/plugin-api";
import { cancel, debounce, schedule } from "@ember/runloop";

const SCROLL_DEBOUNCE_MS = 50;
const HIGHLIGHT_DEBOUNCE_MS = 100;

// Common BBCode tags that Discourse supports
const BBCODE_TAGS = [
  'b', 'i', 'u', 's', 'strike', 'code', 'pre', 'quote', 'img', 'url', 'link',
  'email', 'size', 'color', 'centre', 'center', 'right', 'left', 'indent',
  'list', 'ul', 'ol', 'li', 'table', 'tr', 'td', 'th', 'spoiler', 'details',
  'summary', 'poll', 'date', 'time', 'hide', 'blur'
];

// Regex to match BBCode opening tags
const BBCODE_REGEX = new RegExp(`\\[(${BBCODE_TAGS.join('|')})(?:=[^\\]]*)?\\]`, 'gi');

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

    // Try line number first (works for Markdown)
    const lineNumber = this.getLineNumber(target);
    if (lineNumber !== null) {
      this.scrollTextAreaToCorrectPosition(lineNumber);
      const previewElement = this.findElementByLineNumber(lineNumber);
      if (previewElement) {
        this.updateActiveElementCSSStyleRule(previewElement);
      }
      return;
    }

    // Fallback: content-based matching (works for BBCode)
    const matchedLine = this.findLineByContent(target);
    if (matchedLine !== null) {
      this.scrollTextAreaToCorrectPosition(matchedLine);
      this.updateActiveElementCSSStyleRule(target);
    }
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
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(event.key)) {
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

    // Try finding element by line number first (Markdown)
    let previewElement = this.findElementByLineNumber(lineNumber);

    // If not found, try content-based matching (BBCode)
    if (!previewElement && currentLineText) {
      previewElement = this.findElementByContent(currentLineText, lineNumber);
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
  // CONTENT-BASED MATCHING (for BBCode support)
  // =============================================

  findLineByContent(element) {
    if (!element || !this.textArea) return null;

    const elementText = element.textContent?.trim();
    if (!elementText || elementText.length < 2) return null;

    const lines = this.textArea.value.split("\n");

    // Normalize text for comparison
    const normalizedTarget = this.normalizeText(elementText);

    for (let i = 0; i < lines.length; i++) {
      const lineText = this.stripBBCodeTags(lines[i]);
      const normalizedLine = this.normalizeText(lineText);

      // Check if line contains substantial part of element text
      if (normalizedLine && normalizedTarget) {
        if (normalizedLine.includes(normalizedTarget) ||
            normalizedTarget.includes(normalizedLine) ||
            this.fuzzyMatch(normalizedLine, normalizedTarget)) {
          return i;
        }
      }
    }

    return null;
  }

  findElementByContent(lineText, lineNumber) {
    if (!lineText || !this.previewWrapper) return null;

    const strippedText = this.stripBBCodeTags(lineText);
    const normalizedLine = this.normalizeText(strippedText);

    if (!normalizedLine || normalizedLine.length < 2) return null;

    // Get all text-containing elements in preview
    const candidates = this.previewWrapper.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, td, th, blockquote, span, strong, em, code, pre');

    let bestMatch = null;
    let bestScore = 0;

    for (const candidate of candidates) {
      // Skip if element already has a matching data-ln
      const dataLn = candidate.getAttribute('data-ln');
      if (dataLn !== null) continue;

      const candidateText = this.normalizeText(candidate.textContent);
      if (!candidateText) continue;

      const score = this.getMatchScore(normalizedLine, candidateText);
      if (score > bestScore && score > 0.5) {
        bestScore = score;
        bestMatch = candidate;
      }
    }

    return bestMatch;
  }

  normalizeText(text) {
    if (!text) return '';
    return text
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s]/g, '')
      .trim();
  }

  stripBBCodeTags(text) {
    if (!text) return '';
    // Remove BBCode tags like [b], [/b], [url=...], etc.
    return text
      .replace(/\[\/?\w+(?:=[^\]]*)?]/g, '')
      .trim();
  }

  fuzzyMatch(str1, str2) {
    if (!str1 || !str2) return false;
    const shorter = str1.length < str2.length ? str1 : str2;
    const longer = str1.length < str2.length ? str2 : str1;

    // Check if shorter string is substantially contained in longer
    if (shorter.length < 5) return false;
    return longer.includes(shorter.substring(0, Math.min(20, shorter.length)));
  }

  getMatchScore(str1, str2) {
    if (!str1 || !str2) return 0;

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
        background-color: var(--tertiary-low, rgba(0, 144, 237, 0.2)) !important;
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
