import Component from "@ember/component";
import { cancel, debounce, schedule } from "@ember/runloop";

const SCROLL_DEBOUNCE_MS = 50;
const HIGHLIGHT_DEBOUNCE_MS = 100;

export default Component.extend({
  // Properties initialized to null
  clickHandler: null,
  scrollHandler: null,
  inputHandler: null,
  keyDownHandler: null,
  preview: null,
  previewWrapper: null,
  scrollParent: null,
  textArea: null,
  activeElementCSSStyleRule: null,
  clonedTextArea: null,
  textareaObserver: null,
  isInitialized: false,

  // Debounce handlers for cleanup
  _scrollDebounceTimer: null,
  _highlightDebounceTimer: null,

  didInsertElement() {
    this._super(...arguments);
    // Use schedule to ensure DOM is ready
    schedule("afterRender", this, this.waitForTextarea);
  },

  waitForTextarea() {
    if (this.isDestroying || this.isDestroyed) {
      return;
    }

    const textArea = document.querySelector(".d-editor-textarea-wrapper textarea");

    if (textArea) {
      this.initializeClickToEdit(textArea);
      return;
    }

    // Wait for textarea to be added to DOM
    const observer = new MutationObserver((mutations) => {
      if (this.isDestroying || this.isDestroyed) {
        observer.disconnect();
        return;
      }

      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          const ta = document.querySelector(".d-editor-textarea-wrapper textarea");
          if (ta) {
            observer.disconnect();
            this.initializeClickToEdit(ta);
            return;
          }
        }
      }
    });

    // Start observing the composer area for changes
    const editorContainer = document.querySelector(".d-editor-container") ||
                           document.querySelector(".reply-area") ||
                           document.querySelector("#reply-control");
    if (editorContainer) {
      observer.observe(editorContainer, {
        childList: true,
        subtree: true
      });
    }

    this.textareaObserver = observer;
  },

  initializeClickToEdit(textArea) {
    if (this.isInitialized || this.isDestroying || this.isDestroyed) {
      return;
    }

    // Skip if rich editor (ProseMirror) is active
    const prosemirrorEditor = document.querySelector(".d-editor-textarea-wrapper .ProseMirror");
    if (prosemirrorEditor) {
      return;
    }

    // Cache DOM references
    this.textArea = textArea;
    this.previewWrapper = document.querySelector(".d-editor-preview-wrapper");
    this.scrollParent = document.querySelector(".wmd-controls");
    this.preview = document.querySelector(".d-editor-preview");

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
    this.clickHandler = this._handleClick.bind(this);
    this.scrollHandler = this._handleScroll.bind(this);
    this.inputHandler = this._handleInput.bind(this);
    this.keyDownHandler = this._handleKeyDown.bind(this);

    // Add event listeners
    this.previewWrapper.addEventListener("mousedown", this.clickHandler);
    this.textArea.addEventListener("mouseup", this.scrollHandler);
    this.textArea.addEventListener("input", this.inputHandler);
    this.textArea.addEventListener("keydown", this.keyDownHandler);
  },

  _handleClick(event) {
    event.preventDefault();
    event.stopPropagation();

    const lineNumber = this.getLineNumber(event.target);
    if (lineNumber === null) {
      return;
    }

    this.scrollTextAreaToCorrectPosition(lineNumber);

    const previewElement = this.findElementByLineNumber(lineNumber);
    if (previewElement) {
      this.updateActiveElementCSSStyleRule(previewElement);
    }
  },

  _handleScroll() {
    this._debouncedScrollPreview();
  },

  _handleInput() {
    this._debouncedScrollPreview();
  },

  _handleKeyDown(event) {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
      // Use debounce for arrow key navigation
      this._debouncedScrollPreview();
    }
  },

  _debouncedScrollPreview() {
    if (this.isDestroying || this.isDestroyed) {
      return;
    }

    this._scrollDebounceTimer = debounce(
      this,
      this.scrollPreviewWrapperToCorrectPosition,
      SCROLL_DEBOUNCE_MS
    );
  },

  scrollPreviewWrapperToCorrectPosition() {
    if (this.isDestroying || this.isDestroyed || !this.textArea || !this.previewWrapper) {
      return;
    }

    // Prevent collapse during redraw
    if (this.preview && this.preview.scrollHeight > 0) {
      this.preview.style.minHeight = `${this.preview.scrollHeight}px`;
    }

    const cursorPosition = this.textArea.selectionStart;
    const textUpToCursor = this.textArea.value.substring(0, cursorPosition);
    const lineNumber = textUpToCursor.split("\n").length - 1;

    const previewElement = this.findElementByLineNumber(lineNumber);
    if (previewElement) {
      // Debounce the highlight update separately
      this._highlightDebounceTimer = debounce(
        this,
        () => this.updateActiveElementCSSStyleRule(previewElement),
        HIGHLIGHT_DEBOUNCE_MS
      );

      const offset = this.getOffsetTopUntil(previewElement, this.scrollParent);
      this.previewWrapper.scrollTop = offset - parseInt(this.previewWrapper.clientHeight / 2, 10);
    }
  },

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
      // Standard browsers
      ta.selectionStart = ta.selectionEnd = selStart;
      ta.blur();
      ta.focus();
    }

    ta.selectionStart = selStart;
    ta.selectionEnd = selEnd;
  },

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
  },

  updateActiveElementCSSStyleRule(previewElement) {
    if (!this.activeElementCSSStyleRule || this.isDestroying || this.isDestroyed) {
      return;
    }

    // Clean up duplicate highlight styles
    const highlightElements = document.querySelectorAll("[id^='preview-highlight-']");
    for (let i = 0; i < highlightElements.length - 1; i++) {
      highlightElements[i].remove();
    }

    const selector = this.getUniqueCSSSelector(previewElement);
    this.activeElementCSSStyleRule.innerHTML =
      `${selector} { box-shadow: 0px 0px 0px 1px rgba(0,144,237,.5) !important; background-color: rgba(0, 144, 237, 0.35); z-index: 3; }`;
  },

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
  },

  getLineNumber(target) {
    if (!target || target.nodeName === "HTML") {
      return null;
    }

    const ln = target.getAttribute("data-ln");
    if (ln !== null) {
      return parseInt(ln, 10);
    }

    return this.getLineNumber(target.parentElement);
  },

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
  },

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
  },

  isSafari() {
    const ua = navigator.userAgent;
    return ua.indexOf("Safari") > -1 && ua.indexOf("Chrome") === -1;
  },

  willDestroyElement() {
    this._super(...arguments);
    this._cleanup();
  },

  _cleanup() {
    // Cancel pending debounce timers
    if (this._scrollDebounceTimer) {
      cancel(this._scrollDebounceTimer);
    }
    if (this._highlightDebounceTimer) {
      cancel(this._highlightDebounceTimer);
    }

    // Remove event listeners
    if (this.previewWrapper && this.clickHandler) {
      this.previewWrapper.removeEventListener("mousedown", this.clickHandler);
    }
    if (this.textArea) {
      if (this.scrollHandler) {
        this.textArea.removeEventListener("mouseup", this.scrollHandler);
      }
      if (this.inputHandler) {
        this.textArea.removeEventListener("input", this.inputHandler);
      }
      if (this.keyDownHandler) {
        this.textArea.removeEventListener("keydown", this.keyDownHandler);
      }
    }

    // Remove style element
    if (this.activeElementCSSStyleRule && this.activeElementCSSStyleRule.parentNode) {
      this.activeElementCSSStyleRule.parentNode.removeChild(this.activeElementCSSStyleRule);
    }

    // Remove cloned textarea
    if (this.clonedTextArea && this.clonedTextArea.parentNode) {
      this.clonedTextArea.parentNode.removeChild(this.clonedTextArea);
    }

    // Disconnect observer
    if (this.textareaObserver) {
      this.textareaObserver.disconnect();
    }

    // Clear references
    this.clickHandler = null;
    this.scrollHandler = null;
    this.inputHandler = null;
    this.keyDownHandler = null;
    this.preview = null;
    this.previewWrapper = null;
    this.scrollParent = null;
    this.textArea = null;
    this.activeElementCSSStyleRule = null;
    this.clonedTextArea = null;
    this.textareaObserver = null;
    this.isInitialized = false;
  },
});
