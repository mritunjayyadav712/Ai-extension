import { DOMObservation } from '../core/models';
import { PlatformAdapter } from './types';
import { ConversationAcquirer } from '../core/acquisition/ConversationAcquirer';
import { APIStrategy } from '../core/acquisition/strategies/APIStrategy';
import { VisibleDOMStrategy } from '../core/acquisition/strategies/VisibleDOMStrategy';
import { HydrationStrategy } from '../core/acquisition/strategies/HydrationStrategy';
import { ConversationReadyDetector } from './ConversationReadyDetector';
import { tagAllCandidateScrollContainers, inspectScrollContainer } from './utils';

function hashMessages(messages: { id: string; text: string }[]): string {
  let str = '';
  for (const m of messages) {
    str += m.id + m.text.length + m.text.slice(0, 50);
  }
  return str;
}

export class RobustDOMEngine {
  private observer: MutationObserver | null = null;
  private adapter: PlatformAdapter;
  private onObservation: (obs: DOMObservation) => void;
  private lastHash: string = '';
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private isChecking: boolean = false;
  private acquirer: ConversationAcquirer;
  private readyDetector: ConversationReadyDetector;
  private conversationReady: boolean = false;
  
  // Tracing State
  private wasStreaming = false;
  private lastUserMsgId = '';
  private lastAssistantMsgId = '';

  constructor(
    adapter: PlatformAdapter,
    onObservation: (obs: DOMObservation) => void
  ) {
    this.adapter = adapter;
    this.onObservation = onObservation;
    
    this.acquirer = new ConversationAcquirer([
      new APIStrategy(adapter),          // Try first (complete history from API)
      new HydrationStrategy(adapter),    // Try second (fallback: page hydration)
      new VisibleDOMStrategy(adapter)    // Try last (always succeeds: visible DOM)
    ])
    
    if (!this.acquirer) {
      throw new Error('[Engine Fatal] Dependency injection failed: ConversationAcquirer is undefined.');
    }

    this.readyDetector = new ConversationReadyDetector(adapter, () => {
      this.onConversationReady();
    });
    
    console.log(`[Engine] ConversationAcquirer created`);
    console.log(`[Engine] Registered strategies: API, Hydration, VisibleDOM`);
    console.log(`[Engine] RobustDOMEngine created`);
    console.log(`[Engine] Acquisition dependency injected: true`);
  }

  private onConversationReady(): void {
    this.conversationReady = true;

    // Attach MutationObserver now that conversation is ready
    this.observer = new MutationObserver(() => {
      this.scheduleUpdate('MutationObserver');
    });

    const MAX_OBSERVER_RETRIES = 20; // 20 × 50ms = 1s max
    let retryCount = 0;
    const startObserver = () => {
      const target = this.getObservationTarget();
      if (target) {
        this.observer?.observe(target, {
          childList: true,
          subtree: true,
          characterData: true,
        });
        console.log(`[Observer] Attached to ${target.tagName || 'Document'}`);
      } else if (retryCount < MAX_OBSERVER_RETRIES) {
        retryCount++;
        setTimeout(startObserver, 50);
      } else {
        console.warn(`[Observer] Failed to find observation target after ${MAX_OBSERVER_RETRIES} retries`);
      }
    };
    startObserver();

    // First acquisition run
    this.scheduleUpdate('ConversationReady');
  }

  public start() {
    console.log(`[Engine] Stateless telemetry observer started for ${this.adapter.id}.`);

    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    this.setupUrlListener();

    // Delegate to ConversationReadyDetector — no fixed delays
    this.readyDetector.start();
  }

  public stop() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.readyDetector.stop();
    this.conversationReady = false;
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
  }

  private getObservationTarget(): Element | null {
    if (this.adapter.observeSelector) {
      const target = document.querySelector(this.adapter.observeSelector);
      if (target) return target;
    }
    return (
      document.querySelector('[role="log"]') ||
      document.querySelector('main') ||
      document.querySelector('[role="main"]') ||
      document.body
    );
  }

  private handleVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      this.observer?.disconnect();
    } else {
      const target = this.getObservationTarget();
      if (target) {
        this.observer?.observe(target, {
          childList: true,
          subtree: true,
          characterData: true,
        });
        this.scheduleUpdate();
      }
    }
  };

  private setupUrlListener() {
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function (...args) {
      originalPushState.apply(this, args);
      window.dispatchEvent(new Event('locationchange'));
    };
    history.replaceState = function (...args) {
      originalReplaceState.apply(this, args);
      window.dispatchEvent(new Event('locationchange'));
    };
    window.addEventListener('popstate', () => window.dispatchEvent(new Event('locationchange')));

    window.addEventListener('locationchange', () => {
      // Reset readiness state on navigation — no fixed delays
      this.lastHash = '';
      this.conversationReady = false;

      // Disconnect old observer
      if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
      }

      // Re-enter the readiness gate
      this.readyDetector.reset();
    });
  }

  private scheduleUpdate(reason: string = 'Unknown') {
    if (document.visibilityState === 'hidden') return;
    if (this.debounceTimer) {
      console.log(`[Engine] Skip Emission: debounce active`);
      return;
    }

    this.debounceTimer = setTimeout(() => {
      this.processDOM(reason);
      this.debounceTimer = null;
    }, 250);
  }

  private async processDOM(reason: string = 'Unknown') {
    const timestamp = new Date().toISOString();
    console.log(`\n--- processDOM Executed ---`);
    console.log(`Timestamp: ${timestamp}`);
    console.log(`Mutation reason: ${reason}`);

    if (!this.conversationReady) {
      console.log(`[Engine] Skip: conversation not ready yet`);
      return;
    }


    const getScrollContainer = () => {
      tagAllCandidateScrollContainers();
      const selectors = [
        'div[class*="react-scroll-to-bottom"]',
        'div[class*="react-scroll-to-bottom--css"]',
        'main div.overflow-y-auto',
        'div.overflow-y-auto',
        'main',
        '[role="main"]',
      ];
      for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (el && el.scrollHeight > el.clientHeight) {
          console.log(`[Investigation 3 - Scroll container identity]
Component: processDOM (Selected Option)
tagName: ${el.tagName}
className: ${el.className}
id: ${el.id}
overflowY: ${window.getComputedStyle(el).overflowY}
scrollTop: ${el.scrollTop}
scrollHeight: ${el.scrollHeight}
clientHeight: ${el.clientHeight}
boundingClientRect: ${JSON.stringify(el.getBoundingClientRect())}`);
          inspectScrollContainer(el, 'processDOM');
          return el;
        }
      }
      const fallback = document.documentElement || document.body;
      console.log(`[Investigation 3 - Scroll container identity]
Component: processDOM (Fallback)
tagName: ${fallback.tagName}
className: ${fallback.className}
id: ${fallback.id}
overflowY: ${window.getComputedStyle(fallback).overflowY}
scrollTop: ${fallback.scrollTop}
scrollHeight: ${fallback.scrollHeight}
clientHeight: ${fallback.clientHeight}
boundingClientRect: ${JSON.stringify(fallback.getBoundingClientRect())}`);
      inspectScrollContainer(fallback, 'processDOM');
      return fallback;
    };

    const scrollContainer = getScrollContainer();
    const scrollTop = scrollContainer ? scrollContainer.scrollTop : 0;
    const scrollHeight = scrollContainer ? scrollContainer.scrollHeight : 0;
    const clientHeight = scrollContainer ? scrollContainer.clientHeight : 0;
    const scrollRatio = clientHeight > 0 ? scrollHeight / clientHeight : 0;


    // Find first visible message node position
    const selectors = this.adapter.domSelectors || ['[data-message-author-role]', 'article', '.prose'];
    let firstNode: Element | null = null;
    for (const selector of selectors) {
      const match = document.querySelector(selector);
      if (match) {
        firstNode = match;
        break;
      }
    }
    let firstNodePosStr = 'N/A';
    if (firstNode && scrollContainer) {
      const containerRect = scrollContainer.getBoundingClientRect();
      const nodeRect = firstNode.getBoundingClientRect();
      const topPos = nodeRect.top - containerRect.top;
      firstNodePosStr = `${Math.round(topPos)}px from viewport top`;
    }

    const estimatedHiddenViewportAbove = clientHeight > 0 ? scrollTop / clientHeight : 0;
    const estimatedHiddenViewportBelow = clientHeight > 0 ? Math.max(0, scrollHeight - scrollTop - clientHeight) / clientHeight : 0;

    console.log(
      `[Scroll] top=${scrollTop} height=${scrollHeight} client=${clientHeight} ` +
      `ratio=${scrollRatio.toFixed(2)} firstNode=${firstNodePosStr} ` +
      `hiddenAbove=${estimatedHiddenViewportAbove.toFixed(2)} hiddenBelow=${estimatedHiddenViewportBelow.toFixed(2)}`
    );
    
    if (this.isChecking) {
      console.log(`[Engine] Skip Emission: extraction error / isChecking lock active`);
      return;
    }
    
    this.isChecking = true;

    try {
      const threadId = this.adapter.getThreadId ? this.adapter.getThreadId() : null;
      const result = await this.acquirer.acquire(threadId || 'unknown', this.adapter.id);
      const visibleMessages = result.messages;
      
      console.log(`[Investigation 1 - Identity Check]
window.location.href: ${window.location.href}
URL thread ID: ${threadId}
ConversationAcquirer thread ID: ${threadId || 'unknown'}
DOM visible messages: ${visibleMessages.length}
scrollTop: ${scrollTop}
scrollHeight: ${scrollHeight}
clientHeight: ${clientHeight}`);

      // Investigation 4 - API Availability Check
      if (this.adapter.id === 'chatgpt' && threadId) {
        console.log(`[Investigation 4 - API Fetch] Request attempted for threadId: ${threadId}`);
        fetch('/backend-api/conversation/' + threadId)
          .then(async res => {
            console.log(`[Investigation 4] HTTP status: ${res.status}`);
            console.log(`[Investigation 4] content-type: ${res.headers.get('content-type')}`);
            if (res.ok) {
              const data = await res.json();
              const strData = JSON.stringify(data);
              console.log(`[Investigation 4] response size: ${strData.length} bytes`);
              console.log(`[Investigation 4] top-level JSON keys: ${Object.keys(data).join(', ')}`);
              const mappingExists = 'mapping' in data;
              console.log(`[Investigation 4] mapping exists: ${mappingExists}`);
              if (mappingExists && data.mapping) {
                const nodes = Object.keys(data.mapping).length;
                console.log(`[Investigation 4] mapping node count: ${nodes}`);
                
                // Count actual messages (skipping system/tool depending on payload, roughly nodes is upper bound)
                let msgCount = 0;
                let firstMsgId = null;
                let lastMsgId = null;
                for (const key of Object.keys(data.mapping)) {
                  const node = data.mapping[key];
                  if (node.message) {
                    msgCount++;
                    if (!firstMsgId) firstMsgId = node.message.id;
                    lastMsgId = node.message.id;
                  }
                }
                console.log(`[Investigation 4] normalized message count: ${msgCount}`);
                console.log(`[Investigation 4] first message ID: ${firstMsgId}`);
                console.log(`[Investigation 4] last message ID: ${lastMsgId}`);
                if (nodes > visibleMessages.length) {
                  console.log(`[Investigation 4] DIRECT CONVERSATION FETCH IS VIABLE`);
                }
                
                console.log(`[Investigation 5 - Diagnostic Table]
Source              Count
--------------------------
Visible DOM           ${visibleMessages.length}
API                   ${msgCount}
IndexedDB             ??? (Checked via background)
Estimated             ??? (Checked via background)
`);
              }
            } else {
              if (res.status === 401 || res.status === 403) {
                 console.log(`[Investigation 4] AUTH FAILURE`);
              } else if (res.status === 404) {
                 console.log(`[Investigation 4] NOT FOUND`);
              }
            }
          })
          .catch(err => {
            console.error(`[Investigation 4] CORS / network failure:`, err);
          });
      }

      const currentHash = hashMessages(visibleMessages);
      
      const isStreaming = this.adapter.isStreaming ? this.adapter.isStreaming() : false;
      
      console.log(`Current DOM message count: ${visibleMessages.length}`);
      
      if (visibleMessages.length === 0) {
        console.log(`[Engine] Skip Emission: no messages`);
        this.isChecking = false;
        return;
      }
      
      const lastMsg = visibleMessages[visibleMessages.length - 1];
      console.log(`Last visible message ID: ${lastMsg.id}`);
      console.log(`Last visible message role: ${lastMsg.role}`);
      console.log(`Last visible message first 100 chars: ${lastMsg.text.substring(0, 100).replace(/\n/g, ' ')}`);
      console.log(`Current extraction hash: ${currentHash}`);
      console.log(`Previous extraction hash: ${this.lastHash}`);

      // Streaming Tracing Logic
      if (lastMsg.role === 'user' && lastMsg.id !== this.lastUserMsgId) {
        console.log(`[Trace] NEW USER PROMPT SUBMITTED: First appeared in DOM (ID: ${lastMsg.id})`);
        this.lastUserMsgId = lastMsg.id;
      }
      
      if (lastMsg.role === 'ai' && lastMsg.id !== this.lastAssistantMsgId) {
        console.log(`[Trace] ASSISTANT PLACEHOLDER APPEARED (ID: ${lastMsg.id})`);
        this.lastAssistantMsgId = lastMsg.id;
      }
      
      if (isStreaming && !this.wasStreaming) {
        console.log(`[Trace] STREAMING BEGINS`);
        this.wasStreaming = true;
      } else if (!isStreaming && this.wasStreaming) {
        console.log(`[Trace] STREAMING ENDS`);
        this.wasStreaming = false;
      }

      let willEmit = false;
      if (isStreaming) {
        willEmit = true;
      } else if (currentHash !== this.lastHash) {
        willEmit = true;
      }
      
      console.log(`Whether emission occurred: ${willEmit ? 'YES' : 'NO'}`);

      if (willEmit) {
        this.lastHash = currentHash;
        
        const observation: DOMObservation = {
          platform: this.adapter.id,
          threadId,
          url: window.location.href,
          pageTitle: document.title,
          messages: visibleMessages,
          isStreaming: isStreaming,
          scrollTop,
          scrollHeight,
          clientHeight
        };

        if (!isStreaming && !this.wasStreaming) {
          console.log(`[Trace] FINAL CONTENT_MUTATION EMITTED (Streaming Complete / Steady State)`);
        }

        this.onObservation(observation);
      } else {
        if (!isStreaming && currentHash === this.lastHash) {
          console.log(`[Engine] Skip Emission: identical hash`);
        }
      }
    } catch (err) {
      console.log(`[Engine] Skip Emission: extraction error`);
      console.error('[Engine] Extraction error:', err);
    } finally {
      this.isChecking = false;
    }
  }
}
