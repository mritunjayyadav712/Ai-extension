import { defineContentScript } from 'wxt/sandbox';
import { mountWidget } from './content/widget/mount';
import { detectPlatform } from '../adapters';
import { RobustDOMEngine } from '../adapters/engine';
import { messaging } from '../messaging/client';
import { storageLayer } from '../storage';
import { normalizeChatGPTMapping } from '../core/acquisition/normalizeMapping';
import { DOMObservation } from '../core/models';
import '../ui/styles/tailwind.css';

export default defineContentScript({
  matches: [
    '*://chatgpt.com/*',
    '*://*.chatgpt.com/*',
    '*://chat.openai.com/*',
    '*://claude.ai/*',
    '*://gemini.google.com/*',
    '*://*.x.com/*',
    '*://*.grok.com/*',
    '*://*.perplexity.ai/*',
  ],
  cssInjectionMode: 'ui',
  async main(ctx) {
    console.log(`[Startup] AI Context Tracker: Content Script injected on ${window.location.href}`);

    const url = new URL(window.location.href);
    const adapter = detectPlatform(url);

    if (adapter) {
      let state;
      try {
        state = await storageLayer.appState.getValue();
      } catch (error) {
        console.warn('[Startup] Failed to access storage (context restricted). Falling back to default tracking state.', error);
        // Default state fallback guarantees the tracker and observer always start
        const { defaultState } = await import('../storage');
        state = defaultState;
      }

      if (!state.trackingEnabled || !state.supportedPlatforms[adapter.id]) {
        console.log(`[Startup] Tracking disabled for ${adapter.name}. Observer not started.`);
        return;
      }

      console.log(`[Startup] Detected Platform: ${adapter.name}. Initializing engine.`);

      // Initialize Robust DOM Engine (Stateless telemetry observer)
      const engine = new RobustDOMEngine(
        adapter,
        (observation) => {
          console.log(`[Observer] Emitting ${observation.messages.length} visible messages for ${observation.platform}`);

          // Send the raw DOM observation to Background Service Worker (the source of truth)
          messaging.sendToBackground({
            type: 'CONTENT_MUTATION',
            payload: observation,
          });
        }
      );

      console.log(`[Startup] Starting engine for ${adapter.id}.`);
      engine.start();

      // Network Intercept Bridge: Listen for conversation data from the MAIN-world
      // network interceptor (networkDiscovery.content.ts). The MAIN world intercepts
      // ChatGPT's own authenticated fetch and posts the mapping data via postMessage.
      // We normalize it and forward it through the same CONTENT_MUTATION pipeline.
      if (adapter.id === 'chatgpt') {
        window.addEventListener('message', (event: MessageEvent) => {
          // Security: only accept messages from this window
          if (event.source !== window) return;
          if (!event.data || event.data.type !== '__CTXTRACKER_NETWORK_CONVERSATION__') return;

          const { conversationId, mapping, url: interceptedUrl } = event.data.payload;

          if (!mapping || !conversationId) {
            console.warn('[NetworkBridge] Received malformed conversation data');
            return;
          }

          console.log(`[NetworkBridge] Received intercepted conversation: ${conversationId}`);

          // Normalize using the shared ChatGPT mapping parser
          const messages = normalizeChatGPTMapping({ mapping });

          if (messages.length > 0) {
            const observation: DOMObservation = {
              platform: 'chatgpt',
              threadId: conversationId,
              url: interceptedUrl || window.location.href,
              pageTitle: document.title,
              messages,
              isStreaming: false,
            };

            messaging.sendToBackground({
              type: 'CONTENT_MUTATION',
              payload: observation,
            });

            console.log(`[NetworkBridge] Forwarded ${messages.length} messages from network intercept for ${conversationId}`);
          } else {
            console.warn(`[NetworkBridge] Normalization returned 0 messages for ${conversationId}`);
          }
        });

        console.log(`[NetworkBridge] Listener registered for ChatGPT network intercept bridge`);
      }

      // Mount the UI widget
      await mountWidget(ctx);
    } else {
      console.log('[Startup] No matching AI platform adapter found for this URL.');
    }
  },
});
