import { PlatformAdapter } from './types';
import { tagAllCandidateScrollContainers, inspectScrollContainer } from './utils';

export type ReadyState =
  | 'STARTING'
  | 'WAITING_FOR_DOCUMENT'
  | 'WAITING_FOR_MAIN'
  | 'WAITING_FOR_FIRST_MESSAGE'
  | 'FIRST_MESSAGE_FOUND'
  | 'WAITING_FOR_LAYOUT_STABLE'
  | 'LAYOUT_STABLE'
  | 'READY'
  | 'DISPATCHING_CONVERSATION_READY'
  | 'FINISHED';

export interface ConversationReadyEvent {
  state: ReadyState;
  messageCount: number;
  scrollHeight: number;
  clientHeight: number;
}

/**
 * ConversationReadyDetector
 *
 * Deterministic state machine readiness gate for AI platform page loading.
 * Fully instrumented with transition logs, heartbeats, try-catch error wrappers,
 * and a 30s degraded mode fallback timeout.
 */
export class ConversationReadyDetector {
  private adapter: PlatformAdapter;
  private onReady: () => void;
  private state: ReadyState = 'STARTING';

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private mutationObserver: MutationObserver | null = null;

  private startTime: number = 0;
  private lastScrollHeight: number = -1;
  private stableChecks: number = 0;
  private lastMutationTime: number = 0;
  private mutationCount: number = 0;

  private readonly POLL_INTERVAL_MS = 150;
  private readonly HEARTBEAT_INTERVAL_MS = 1000;
  private readonly TIMEOUT_MS = 30000;
  private readonly QUIESCENCE_MS = 500;
  private readonly REQUIRED_STABLE_CHECKS = 3;

  private destroyed = false;

  constructor(adapter: PlatformAdapter, onReady: () => void) {
    this.adapter = adapter;
    this.onReady = onReady;
  }

  public start(): void {
    try {
      this.startTime = Date.now();
      console.log(`[ConversationReadyDetector] Started for ${this.adapter.id}`);
      this.transition('STARTING', 'Initializing detector');

      this.transition('WAITING_FOR_DOCUMENT', 'Checking document state');
      if (!document || !document.readyState) {
        console.warn(`[ConversationReadyDetector] Document state unavailable: ${document?.readyState}`);
      }

      this.transition('WAITING_FOR_MAIN', 'Document active, locating main observation target');
      const observeTarget = document.querySelector('main') || document.body;
      const mainExists = !!document.querySelector('main');

      if (observeTarget) {
        this.mutationObserver = new MutationObserver(() => {
          try {
            this.mutationCount++;
            this.lastMutationTime = Date.now();
            console.log(`[ConversationReadyDetector Callback] MutationObserver fired (Total mutations: ${this.mutationCount})`);
          } catch (err) {
            this.logError('MutationObserver callback', err);
          }
        });

        this.mutationObserver.observe(observeTarget, {
          childList: true,
          subtree: true,
          characterData: true,
        });
        console.log(`[ConversationReadyDetector Callback] MutationObserver attached to <${observeTarget.tagName.toLowerCase()}>`);
      } else {
        console.warn(`[ConversationReadyDetector] Neither <main> nor <body> available for MutationObserver`);
      }

      if (mainExists || observeTarget) {
        this.transition('WAITING_FOR_FIRST_MESSAGE', 'Main element located, polling for message nodes');
      }

      // Heartbeat timer (1s)
      this.heartbeatTimer = setInterval(() => {
        try {
          this.logHeartbeat();
        } catch (err) {
          this.logError('Heartbeat timer callback', err);
        }
      }, this.HEARTBEAT_INTERVAL_MS);

      // 30s Timeout timer for degraded mode fallback
      this.timeoutTimer = setTimeout(() => {
        try {
          console.log(`[ConversationReadyDetector Callback] Timeout timer fired (30s threshold reached)`);
          this.handleTimeout();
        } catch (err) {
          this.logError('Timeout timer callback', err);
        }
      }, this.TIMEOUT_MS);

      // Main poll timer (150ms)
      this.pollTimer = setInterval(() => {
        try {
          this.poll();
        } catch (err) {
          this.logError('Poll timer callback', err);
        }
      }, this.POLL_INTERVAL_MS);

    } catch (err) {
      this.logError('start() execution', err);
    }
  }

  public stop(): void {
    this.destroyed = true;
    this.cleanupTimers();
  }

  public reset(): void {
    console.log(`[ConversationReadyDetector Callback] URL change reset triggered`);
    this.stop();
    this.destroyed = false;
    this.state = 'STARTING';
    this.lastScrollHeight = -1;
    this.stableChecks = 0;
    this.lastMutationTime = 0;
    this.mutationCount = 0;
    this.start();
  }

  private cleanupTimers(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }
  }

  private formatRelativeTime(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(minutes)}:${pad(seconds)}`;
  }

  private transition(newState: ReadyState, reason: string): void {
    const prevState = this.state;
    if (prevState === newState) return;
    const now = new Date().toISOString();
    const elapsed = Date.now() - this.startTime;
    const relTime = this.formatRelativeTime(elapsed);
    this.state = newState;

    console.log(
      `[ConversationReadyDetector Timeline] ${relTime} ${newState}\n` +
      `[ConversationReadyDetector StateTransition] timestamp: ${now} | previous state: ${prevState} | next state: ${newState} | reason: ${reason}`
    );
  }

  private logHeartbeat(): void {
    const elapsedMs = Date.now() - this.startTime;
    const { messageCount, selectorUsed } = this.getMessageInfo();
    const container = this.getScrollContainer();
    const scrollHeight = container ? container.scrollHeight : 0;
    const clientHeight = container ? container.clientHeight : 0;
    const mainExists = !!document.querySelector('main');
    const layoutStable = this.stableChecks >= this.REQUIRED_STABLE_CHECKS;

    console.log(
      `[ConversationReadyDetector Heartbeat]\n` +
      `Current State: ${this.state}\n` +
      `elapsed time: ${elapsedMs}ms\n` +
      `messageCount: ${messageCount}\n` +
      `selectorUsed: ${selectorUsed}\n` +
      `document.readyState: ${document?.readyState || 'unknown'}\n` +
      `mainExists: ${mainExists}\n` +
      `mutationCount: ${this.mutationCount}\n` +
      `layoutStable: ${layoutStable}\n` +
      `scrollHeight: ${scrollHeight}\n` +
      `clientHeight: ${clientHeight}`
    );
  }

  private logError(context: string, err: unknown): void {
    console.error(
      `[ConversationReadyDetector] Unhandled exception in ${context}\n` +
      `Current State: ${this.state}\n` +
      `Elapsed: ${Date.now() - this.startTime}ms\n` +
      `Stack trace:\n${(err as Error)?.stack || String(err)}`
    );
  }

  private getMessageInfo(): { messageCount: number; selectorUsed: string } {
    const selectors = this.adapter.domSelectors || ['[data-message-author-role]', 'article', '.prose'];
    for (const selector of selectors) {
      const matches = document.querySelectorAll(selector);
      if (matches.length > 0) {
        return { messageCount: matches.length, selectorUsed: selector };
      }
    }
    return { messageCount: 0, selectorUsed: 'none' };
  }

  private getScrollContainer(): Element | null {
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
Component: ConversationReadyDetector
tagName: ${el.tagName}
className: ${el.className}
id: ${el.id}
overflowY: ${window.getComputedStyle(el).overflowY}
scrollTop: ${el.scrollTop}
scrollHeight: ${el.scrollHeight}
clientHeight: ${el.clientHeight}
boundingClientRect: ${JSON.stringify(el.getBoundingClientRect())}`);
        inspectScrollContainer(el, 'ConversationReadyDetector');
        return el;
      }
    }
    return null;
  }

  private poll(): void {
    if (this.destroyed) {
      console.log(`[ConversationReadyDetector] Detector exited unexpectedly | Current State: ${this.state} | Reason: Detector instance stopped/destroyed`);
      return;
    }
    if (this.state === 'FINISHED') return;

    const mainExists = !!document.querySelector('main');

    if (this.state === 'WAITING_FOR_MAIN') {
      if (mainExists || document.body) {
        this.transition('WAITING_FOR_FIRST_MESSAGE', 'Main container or document body became available');
      } else {
        return;
      }
    }

    const { messageCount, selectorUsed } = this.getMessageInfo();

    if (this.state === 'WAITING_FOR_FIRST_MESSAGE') {
      if (messageCount > 0) {
        this.transition('FIRST_MESSAGE_FOUND', `Detected ${messageCount} message nodes using selector "${selectorUsed}"`);
        this.transition('WAITING_FOR_LAYOUT_STABLE', 'Waiting for scroll height stabilization & DOM mutation quiescence');
        this.lastScrollHeight = -1;
        this.stableChecks = 0;
      }
      return;
    }

    if (this.state === 'WAITING_FOR_LAYOUT_STABLE') {
      const container = this.getScrollContainer();
      const currentScrollHeight = container ? container.scrollHeight : 0;
      const currentClientHeight = container ? container.clientHeight : 0;

      const timeSinceLastMutation = Date.now() - this.lastMutationTime;
      const mutationsQuiesced = timeSinceLastMutation >= this.QUIESCENCE_MS;
      const scrollStable = this.lastScrollHeight === currentScrollHeight;

      if (scrollStable && mutationsQuiesced && messageCount > 0) {
        this.stableChecks++;
      } else {
        this.stableChecks = 0;
      }

      this.lastScrollHeight = currentScrollHeight;

      if (this.stableChecks >= this.REQUIRED_STABLE_CHECKS) {
        this.transition('LAYOUT_STABLE', `Scroll height (${currentScrollHeight}px) & mutations quiesced for ${this.REQUIRED_STABLE_CHECKS} consecutive checks`);
        this.emitReady('Normal readiness criteria met');
      }
      return;
    }
  }

  private handleTimeout(): void {
    if (this.state === 'FINISHED') return;

    const elapsed = Date.now() - this.startTime;
    console.error(
      `[ConversationReadyDetector TIMEOUT]\n` +
      `State: ${this.state}\n` +
      `Elapsed: ${elapsed}ms\n` +
      `Reason: Conversation readiness not reached within ${this.TIMEOUT_MS}ms timeout`
    );

    this.emitReady(`Degraded mode fallback triggered after 30s timeout (Stuck in state ${this.state})`);
  }

  private emitReady(reason: string): void {
    if (this.state === 'FINISHED') return;

    this.transition('READY', reason);
    this.transition('DISPATCHING_CONVERSATION_READY', 'Invoking onReady callback to trigger acquisition pipeline');

    this.cleanupTimers();

    try {
      this.onReady();
    } catch (err) {
      this.logError('onReady callback', err);
    }

    this.transition('FINISHED', 'CONVERSATION_READY handling complete');
  }
}

