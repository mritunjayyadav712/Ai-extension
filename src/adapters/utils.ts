/**
 * A utility to debounce DOM mutations.
 * Returns a function that triggers the callback after `delay` ms of no invocations.
 */
export function debounce<T extends (...args: unknown[]) => void>(func: T, delay: number) {
  let timeoutId: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      func(...args);
    }, delay);
  };
}

/**
 * Extracts innerText from a list of DOM elements and joins them with newlines.
 */
export function extractTextFromElements(selectors: string): string {
  const elements = document.querySelectorAll(selectors);
  const textChunks: string[] = [];
  elements.forEach((el) => {
    const text = (el as HTMLElement).innerText;
    if (text) textChunks.push(text);
  });
  return textChunks.join('\n\n');
}

/**
 * Diagnostic Scroll Container Inspection Utilities
 */
export function getDOMPath(el: Element | null): string {
  if (!el) return 'null';
  const path: string[] = [];
  let current: Element | null = el;
  while (current && current.nodeType === Node.ELEMENT_NODE) {
    let selector = current.tagName.toLowerCase();
    if (current.id) {
      selector += `#${current.id}`;
    } else if (current.className && typeof current.className === 'string') {
      const classes = current.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
      if (classes) selector += `.${classes}`;
    }
    path.unshift(selector);
    current = current.parentElement;
  }
  return path.join(' > ');
}

export function getOrAssignElementId(el: Element | null): string {
  if (!el) return 'NULL_ELEMENT';
  if (!(el as any).__scroll_tracker_id) {
    const idCount = ((window as any).__scroll_tracker_counter = ((window as any).__scroll_tracker_counter || 0) + 1);
    const id = `SCROLL_NODE_${idCount}`;
    (el as any).__scroll_tracker_id = id;
    try {
      el.setAttribute('data-scroll-tracker-id', id);
    } catch (e) {
      // ignore in case element DOM is restricted
    }
  }
  return (el as any).__scroll_tracker_id;
}

export function tagAllCandidateScrollContainers(): void {
  const selectors = [
    'div[class*="react-scroll-to-bottom"]',
    'div[class*="react-scroll-to-bottom--css"]',
    'main div.overflow-y-auto',
    'div.overflow-y-auto',
    'main',
    '[role="main"]',
    'body',
    'html',
  ];
  selectors.forEach((sel) => {
    document.querySelectorAll(sel).forEach((el) => {
      getOrAssignElementId(el);
    });
  });
}

export function inspectScrollContainer(el: Element | null, componentName: string): void {
  if (!el) {
    console.log(`[ScrollContainerInvestigation][${componentName}] Element: NULL`);
    return;
  }
  const trackerId = getOrAssignElementId(el);
  const domPath = getDOMPath(el);
  const computedStyle = window.getComputedStyle(el);
  const rect = el.getBoundingClientRect();

  (window as any).__lastScrollContainers = (window as any).__lastScrollContainers || {};
  (window as any).__lastScrollContainers[componentName] = el;

  console.log(
    `[ScrollContainerInvestigation][${componentName}]\n` +
    `Element Tracker ID: ${trackerId}\n` +
    `DOM Path: ${domPath}\n` +
    `tagName: <${el.tagName.toLowerCase()}>\n` +
    `className: "${el.className || ''}"\n` +
    `overflow-y: ${computedStyle.overflowY}\n` +
    `scrollHeight: ${el.scrollHeight}\n` +
    `clientHeight: ${el.clientHeight}\n` +
    `scrollTop: ${el.scrollTop}\n` +
    `boundingClientRect: { top: ${Math.round(rect.top)}, left: ${Math.round(rect.left)}, width: ${Math.round(rect.width)}, height: ${Math.round(rect.height)} }`
  );

  const otherComponent = componentName === 'ConversationReadyDetector' ? 'processDOM' : 'ConversationReadyDetector';
  const otherEl = (window as any).__lastScrollContainers[otherComponent];
  if (otherEl) {
    const sameInstance = el === otherEl;
    console.log(
      `[ScrollContainerComparison] ${componentName} vs ${otherComponent}\n` +
      `Same Element Instance (===): ${sameInstance ? 'YES (TRUE)' : 'NO (FALSE)'}\n` +
      `Current (${componentName}): ${trackerId} [${el.scrollHeight}px / ${el.clientHeight}px]\n` +
      `Other (${otherComponent}): ${getOrAssignElementId(otherEl)} [${otherEl.scrollHeight}px / ${otherEl.clientHeight}px]`
    );
    if (!sameInstance) {
      console.warn(
        `[ScrollContainerDiscrepancyReport] Component Discrepancy Found!\n` +
        `ConversationReadyDetector Element: ${getOrAssignElementId((window as any).__lastScrollContainers.ConversationReadyDetector)} ` +
        `Path: "${getDOMPath((window as any).__lastScrollContainers.ConversationReadyDetector)}" ` +
        `[scrollHeight=${(window as any).__lastScrollContainers.ConversationReadyDetector?.scrollHeight}, clientHeight=${(window as any).__lastScrollContainers.ConversationReadyDetector?.clientHeight}]\n` +
        `processDOM Element: ${getOrAssignElementId((window as any).__lastScrollContainers.processDOM)} ` +
        `Path: "${getDOMPath((window as any).__lastScrollContainers.processDOM)}" ` +
        `[scrollHeight=${(window as any).__lastScrollContainers.processDOM?.scrollHeight}, clientHeight=${(window as any).__lastScrollContainers.processDOM?.clientHeight}]\n` +
        `REPORT: ConversationReadyDetector and processDOM reference DIFFERENT elements!`
      );
    }
  }
}
