import Component from "@ember/component";

export default Component.extend({
  // Properties initialized to null
  clickHandler: null,
  mouseUpHandler: null,
  inputHandler: null,
  keyDownHandler: null,
  preview: null,
  activeElementCSSStyleRule: null,
  clonedTextArea: null,
  textareaObserver: null,

  didInsertElement() {
    this._super(...arguments);
    this.waitForTextarea();
  },

  waitForTextarea() {
    const textArea = document.querySelector(".d-editor-textarea-wrapper textarea");
    
    if (textArea) {
      // Textarea is already in the DOM
      this.initializeClickToEdit(textArea);
      return;
    }

    // Wait for textarea to be added to DOM
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          const textArea = document.querySelector(".d-editor-textarea-wrapper textarea");
          if (textArea) {
            this.initializeClickToEdit(textArea);
            return;
          }
        }
      }
    });

    // Start observing the d-editor container for changes
    const editorContainer = document.querySelector(".d-editor-container");
    if (editorContainer) {
      observer.observe(editorContainer, {
        childList: true,
        subtree: true
      });
    }

    // Store observer reference for cleanup
    this.textareaObserver = observer;
  },

  initializeClickToEdit(textArea) {
    // Only initialize if we're using TextareaEditor (not rich editor)
    const prosemirrorEditor = document.querySelector(".d-editor-textarea-wrapper .ProseMirror");
    if (prosemirrorEditor) {
      return; // Rich editor is active, don't initialize
    }

    const previewWrapper = document.querySelector(".d-editor-preview-wrapper");
    const scrollParent = document.querySelector(".wmd-controls");
    this.preview = document.querySelector(".d-editor-preview");

    if (!previewWrapper) {
      return;
    }

    // Create and append a style element for active element styling
    this.activeElementCSSStyleRule = document.createElement("style");
    this.activeElementCSSStyleRule.type = "text/css";
    this.activeElementCSSStyleRule.id = "preview-highlight";
    document.head.appendChild(this.activeElementCSSStyleRule);

    // Event handler for click events
    this.clickHandler = (event) => {
      event.preventDefault();
      event.stopPropagation();

      const lineNumber = this.getLineNumber(event.target);
      this.scrollTextAreaToCorrectPosition(textArea, lineNumber);

      const previewElement = this.findElementByLineNumber(lineNumber, previewWrapper);
      if (previewElement) {
        this.updateActiveElementCSSStyleRule(previewElement);
      }
    };

    // Event handler for keydown events
    this.keyDownHandler = (event) => {
      // Check if the event key is an arrow key
      if (
        ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)
      ) {
        setTimeout(() => this.scrollPreviewWrapperToCorrectPosition(textArea, previewWrapper, scrollParent), 0);
      }
    };

    // Event handler for updating the preview wrapper's scroll position
    this.scrollPreviewWrapperToCorrectPosition = (ta, pw, sp) => {
      // This line is absolutely essential to prevent scrolling issues
      // in the lower parts of long posts; preventing collapse during redraw:
      if (this.preview) {
        this.preview.style.minHeight = `${this.preview.scrollHeight}px`;
      }

      const cursorPosition = ta.selectionStart;
      const textUpToCursor = ta.value.substring(0, cursorPosition);
      const lineNumber = textUpToCursor.split("\n").length - 1;

      const previewElement = this.findElementByLineNumber(lineNumber, pw);
      if (previewElement) {
        this.updateActiveElementCSSStyleRule(previewElement);
        pw.scrollTop = this.getOffsetTopUntil(previewElement, sp) - parseInt(pw.clientHeight / 2, 10);
      }
    };

    // Add event listeners
    previewWrapper.addEventListener("mousedown", this.clickHandler);
    textArea.addEventListener("mouseup", () => this.scrollPreviewWrapperToCorrectPosition(textArea, previewWrapper, scrollParent));
    textArea.addEventListener("input", () => this.scrollPreviewWrapperToCorrectPosition(textArea, previewWrapper, scrollParent));
    textArea.addEventListener("keydown", this.keyDownHandler);
  },

  scrollTextAreaToCorrectPosition(ta, lineIndex) {
    if (lineIndex === null) {
      return null;
    }
    
    const newlines = [-1]; // Index of imaginary \n before first line
    for (let i = 0; i < ta.value.length; ++i) {
      if (ta.value[i] === "\n") {
        newlines.push(i);
      }
    }

    const selStart = newlines[lineIndex] + 1;
    const selEnd = newlines[lineIndex + 1] || ta.value.length;

    if (this.isSafari()) {
      // Create the clone if it doesn't exist
      if (!this.clonedTextArea) {
        this.clonedTextArea = ta.cloneNode();
        this.clonedTextArea.style.visibility = "hidden";
        this.clonedTextArea.style.position = "absolute";
        this.clonedTextArea.style.left = "-9999px";
        this.clonedTextArea.style.top = "-9999px";
        document.body.appendChild(this.clonedTextArea);
      }

      // Update relevant styles to match the original textarea
      this.clonedTextArea.style.width = getComputedStyle(ta).width;
      this.clonedTextArea.style.height = "1px"; // Minimize the height of the clone
      this.clonedTextArea.style.fontSize = getComputedStyle(ta).fontSize;
      this.clonedTextArea.style.lineHeight = getComputedStyle(ta).lineHeight;
      this.clonedTextArea.style.fontFamily = getComputedStyle(ta).fontFamily;
      this.clonedTextArea.style.overflow = "hidden"; // Prevent scroll bars on the clone

      // Set the value of the clone up to the selection point
      this.clonedTextArea.value = ta.value.substring(0, selStart);

      // Measure the scrollTop of the clone
      const scrollTop = this.clonedTextArea.scrollHeight;

      // Calculate the vertical center position
      const lineHeight = parseInt(getComputedStyle(ta).lineHeight, 10);
      const textAreaHeight = ta.clientHeight;
      let verticalCenter = scrollTop - textAreaHeight / 2 + lineHeight / 2;

      // Ensure we never scroll to a negative location
      verticalCenter = Math.max(verticalCenter, 0);

      // If the line is near the top and we cannot center it, set scrollTop to 0
      if (scrollTop < textAreaHeight / 2) {
        verticalCenter = 0;
      }

      // Set the scrollTop on the original textarea to center the selected text vertically
      ta.scrollTop = verticalCenter;
    } else {
      // Normal browsers support this method

      // Needs collapsed selection (otherwise the blur/focus thing doesn't work)
      ta.selectionStart = ta.selectionEnd = selStart;

      // Then scrolls cursor into focus
      ta.blur();
      ta.focus();
    }
    // Then make the selection
    ta.selectionStart = selStart;
    ta.selectionEnd = selEnd;
  },

  // Update the CSS rule for the active element
  updateActiveElementCSSStyleRule(previewElement) {
    const highlightElements = document.querySelectorAll("#preview-highlight");
    for (let i = 0; i < highlightElements.length - 1; i++) {
      highlightElements[i].remove();
    }
    const selector = this.getUniqueCSSSelector(previewElement);
    this.activeElementCSSStyleRule.innerHTML = `${selector} { box-shadow: 0px 0px 0px 1px rgba(0,144,237,.5) !important; background-color: rgba(0, 144, 237, 0.35); z-index: 3; }`;
  },

  findElementByLineNumber(line, pane) {
    if (line === null) {
      return null;
    }
    
    const previewElements = pane.querySelectorAll(`[data-ln="${line}"]`);
    let previewElement = null;
    if (previewElements.length > 0) {
      previewElement = previewElements[previewElements.length - 1]; // Get the last element
    }
    if (previewElement) {
      return previewElement;
    } else if (line === 0) {
      return null;
    } else {
      return this.findElementByLineNumber(line - 1, pane);
    }
  },

  getLineNumber(target) {
    // Check if the current element has the attribute
    if (target.getAttribute("data-ln") !== null) {
      // If the attribute is found, return its value
      const lineNumber = parseInt(target.getAttribute("data-ln"), 10);
      return lineNumber;
    } else {
      // If the element is the document root, the attribute wasn't found
      if (target.nodeName === "HTML") {
        return null; // Attribute not found
      }
      // Move up to the parent element and check again
      return this.getLineNumber(target.parentElement);
    }
  },

  getOffsetTopUntil(elem, parent) {
    if (!(elem && parent)) {
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
    // get a unique selector (that can be used in a persistent CSS rule)
    const stack = [];
    while (el.parentNode !== null && el.nodeName.toLowerCase() !== "html") {
      let sibCount = 0;
      let sibIndex = 0;
      for (let i = 0; i < el.parentNode.childNodes.length; i++) {
        const sib = el.parentNode.childNodes[i];
        if (sib.nodeType === Node.ELEMENT_NODE && sib.nodeName === el.nodeName) {
          if (sib === el) {
            sibIndex = sibCount;
          }
          sibCount++;
        }
      }
      if (el.hasAttribute("id") && el.id !== "") {
        stack.unshift(el.nodeName.toLowerCase() + "#" + el.id);
      } else if (sibCount > 1) {
        stack.unshift(
          el.nodeName.toLowerCase() + ":nth-of-type(" + (sibIndex + 1) + ")"
        );
      } else {
        stack.unshift(el.nodeName.toLowerCase());
      }
      el = el.parentNode;
    }

    return stack.join(" > "); // join with " > " to create a valid CSS selector
  },

  isSafari() {
    const userAgent = navigator.userAgent;
    const isChrome = userAgent.indexOf("Chrome") > -1;
    const isSafari = userAgent.indexOf("Safari") > -1;

    // Chrome has both 'Chrome' and 'Safari' inside userAgent string.
    // Safari has only 'Safari'.
    return isSafari && !isChrome;
  },

  willDestroyElement() {
    this._super(...arguments);

    // Clean up: Remove event listeners and style element
    const textArea = document.querySelector(".d-editor-textarea-wrapper textarea");
    const previewWrapper = document.querySelector(".d-editor-preview-wrapper");

    if (textArea && previewWrapper && this.clickHandler) {
      previewWrapper.removeEventListener("mousedown", this.clickHandler);
      textArea.removeEventListener("mouseup", this.scrollPreviewWrapperToCorrectPosition);
      textArea.removeEventListener("input", this.scrollPreviewWrapperToCorrectPosition);
      textArea.removeEventListener("keydown", this.keyDownHandler);
    }

    if (this.activeElementCSSStyleRule) {
      document.head.removeChild(this.activeElementCSSStyleRule);
      this.activeElementCSSStyleRule = null;
    }

    if (this.clonedTextArea && this.clonedTextArea.parentNode) {
      this.clonedTextArea.parentNode.removeChild(this.clonedTextArea);
      this.clonedTextArea = null;
    }

    // Clean up observer if it exists
    if (this.textareaObserver) {
      this.textareaObserver.disconnect();
      this.textareaObserver = null;
    }
  },
});
