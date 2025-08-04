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

  didInsertElement() {
    this._super(...arguments);

    // Select DOM elements
    const textArea = document.querySelector(
      ".d-editor-textarea-wrapper textarea"
    );
    const previewWrapper = document.querySelector(".d-editor-preview-wrapper");
    const scrollParent = document.querySelector(".wmd-controls");
    this.preview = document.querySelector(".d-editor-preview");

    // Create and append a style element for active element styling
    this.activeElementCSSStyleRule = document.createElement("style");
    this.activeElementCSSStyleRule.type = "text/css";
    document.head.appendChild(this.activeElementCSSStyleRule);

    // Event handler for click events
    this.clickHandler = (event) => {
      event.preventDefault();
      event.stopPropagation();

      const lineNumber = getLineNumber(event.target);
      this.scrollTextAreaToCorrectPosition(textArea, lineNumber);

      let previewElement = findElementByLineNumber(lineNumber, previewWrapper);
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
        setTimeout(() => this.scrollPreviewWrapperToCorrectPosition(event), 0);
      }
    };

    // Event handler for updating the preview wrapper's scroll position
    this.scrollPreviewWrapperToCorrectPosition = (event) => {
      // This line is absolutely essential to prevent scrolling issues
      // in the lower parts of long posts; preventing collapse during redraw:
      this.preview.style.minHeight = `${this.preview.scrollHeight}px`;

      const cursorPosition = textArea.selectionStart;
      const textUpToCursor = textArea.value.substring(0, cursorPosition);
      const lineNumber = textUpToCursor.split("\n").length - 1;

      let previewElement = findElementByLineNumber(lineNumber, previewWrapper);
      if (previewElement) {
        this.updateActiveElementCSSStyleRule(previewElement);
        previewWrapper.scrollTop =
          getOffsetTopUntil(previewElement, scrollParent) -
          parseInt(previewWrapper.clientHeight / 2);
      }
    };

    this.scrollTextAreaToCorrectPosition = (ta, lineIndex) => {
      if (lineIndex === null) return null;
      const newlines = [-1]; // Index of imaginary \n before first line
      for (let i = 0; i < ta.value.length; ++i) {
        if (ta.value[i] === "\n") newlines.push(i);
      }

      const selStart = newlines[lineIndex] + 1;
      const selEnd = newlines[lineIndex + 1] || ta.value.length;

      if (isSafari()) {
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
        let scrollTop = this.clonedTextArea.scrollHeight;

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
    };

    // Update the CSS rule for the active element
    this.updateActiveElementCSSStyleRule = (previewElement) => {
      const selector = getUniqueCSSSelector(previewElement);
      this.activeElementCSSStyleRule.innerHTML = `${selector} { box-shadow: 0px 0px 0px 4px rgba(0,144,237,.7) !important; background-color: rgba(0, 144, 237, 0.35); z-index: 3; }`;
    };

    // Add event listeners
    previewWrapper.addEventListener("mousedown", this.clickHandler);
    textArea.addEventListener(
      "mouseup",
      this.scrollPreviewWrapperToCorrectPosition
    );
    textArea.addEventListener(
      "input",
      this.scrollPreviewWrapperToCorrectPosition
    );
    textArea.addEventListener("keydown", this.keyDownHandler); // Only for arrow keys
  },

  willDestroyElement() {
    this._super(...arguments);

    // Clean up: Remove event listeners and style element
    const textArea = document.querySelector(
      ".d-editor-textarea-wrapper textarea"
    );
    const previewWrapper = document.querySelector(".d-editor-preview-wrapper");

    previewWrapper.removeEventListener("click", this.clickHandler);
    textArea.removeEventListener(
      "mouseup",
      this.scrollPreviewWrapperToCorrectPosition
    );
    textArea.removeEventListener(
      "input",
      this.scrollPreviewWrapperToCorrectPosition
    );
    textArea.removeEventListener("keydown", this.keyDownHandler);

    if (this.activeElementCSSStyleRule) {
      document.head.removeChild(this.activeElementCSSStyleRule);
      this.activeElementCSSStyleRule = null;
    }
  },
});

function findElementByLineNumber(line, pane) {
  if (line === null) return null;
  let previewElements = pane.querySelectorAll(`[data-ln="${line}"]`);
  let previewElement = null;
  if (previewElements.length > 0) {
    previewElement = previewElements[previewElements.length - 1]; // Get the last element
  }
  if (previewElement) {
    return previewElement;
  } else if (line == 0) {
    return null;
  } else {
    return findElementByLineNumber(line - 1, pane);
  }
}

function getLineNumber(target) {
  // Check if the current element has the attribute
  if (target.getAttribute("data-ln") !== null) {
    // If the attribute is found, return its value
    let lineNumber = parseInt(target.getAttribute("data-ln"));
    return lineNumber;
  } else {
    // If the element is the document root, the attribute wasn't found
    if (target.nodeName === "HTML") {
      return null; // Attribute not found
    }
    // Move up to the parent element and check again
    return getLineNumber(target.parentElement);
  }
}

function getOffsetTopUntil(elem, parent) {
  if (!(elem && parent)) return 0;
  const offsetParent = elem.offsetParent;
  const offsetTop = elem.offsetTop;
  if (offsetParent == parent) return offsetTop;
  return offsetTop + getOffsetTopUntil(offsetParent, parent);
}

function getUniqueCSSSelector(el) {
  // get a unique selector (that can be used in a persistent CSS rule)
  var stack = [];
  while (el.parentNode != null && el.nodeName.toLowerCase() !== "html") {
    var sibCount = 0;
    var sibIndex = 0;
    for (var i = 0; i < el.parentNode.childNodes.length; i++) {
      var sib = el.parentNode.childNodes[i];
      if (sib.nodeType === Node.ELEMENT_NODE && sib.nodeName === el.nodeName) {
        if (sib === el) {
          sibIndex = sibCount;
        }
        sibCount++;
      }
    }
    if (el.hasAttribute("id") && el.id != "") {
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
}

function isSafari() {
  const userAgent = navigator.userAgent;
  const isChrome = userAgent.indexOf("Chrome") > -1;
  const isSafari = userAgent.indexOf("Safari") > -1;

  // Chrome has both 'Chrome' and 'Safari' inside userAgent string.
  // Safari has only 'Safari'.
  return isSafari && !isChrome;
}
