import { defineContentScript } from 'wxt/sandbox';
import { mountWidget } from './content/widget/mount';
import { detectPlatform } from '../adapters';
import { RobustDOMEngine } from '../adapters/engine';
import { messaging } from '../messaging/client';
import { storageLayer } from '../storage';
import { normalizeChatGPTMapping } from '../core/acquisition/normalizeMapping';
import { NetworkHistoryStore } from '../core/acquisition/strategies/NetworkInterceptStrategy';
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
        console.warn(
          '[Startup] Failed to access storage (context restricted). Falling back to default tracking state.',
          error
        );
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
      const engine = new RobustDOMEngine(adapter, (observation) => {
        console.log(
          `[Observer] Emitting ${observation.messages.length} visible messages for ${observation.platform}`
        );

        // Send the raw DOM observation to Background Service Worker (the source of truth)
        messaging
          .sendToBackground<{
            conversationId?: string;
            canonicalMessageCount?: number;
            storedMessageCount?: number;
            turns?: number;
            tokens?: number;
          }>({
            type: 'CONTENT_MUTATION',
            payload: observation,
          })
          .then((res) => {
            const data = res?.data;
            if (data) {
              console.log(
                `[VERIFY:CONVERSATION_MANAGER]\n` +
                  `conversationId=${data.conversationId}\n` +
                  `source=${observation.source || 'DOM'}\n` +
                  `incomingMessages=${observation.messages.length}\n` +
                  `[VERIFY:CANONICAL]\n` +
                  `conversationId=${data.conversationId}\n` +
                  `messageCount=${data.canonicalMessageCount}\n` +
                  `[VERIFY:CANONICAL_PROTECTION]\n` +
                  `before=${data.canonicalMessageCount}\n` +
                  `domIncoming=${observation.messages.length}\n` +
                  `after=${data.canonicalMessageCount}\n` +
                  `action=NO_SHRINK\n` +
                  `[VERIFY:INDEXEDDB]\n` +
                  `conversationId=${data.conversationId}\n` +
                  `storedMessageCount=${data.storedMessageCount}\n` +
                  `[VERIFY:ESTIMATOR_INPUT]\n` +
                  `canonicalMessageCount=${data.canonicalMessageCount}\n` +
                  `domMessageCount=${observation.messages.length}\n` +
                  `estimatorMessageCount=${data.canonicalMessageCount}\n` +
                  `source=CANONICAL\n` +
                  `[VERIFY:DERIVED]\n` +
                  `conversationId=${data.conversationId}\n` +
                  `canonicalMessageCount=${data.canonicalMessageCount}\n` +
                  `derivedMessageCount=${data.canonicalMessageCount}\n` +
                  `turnCount=${data.turns}\n` +
                  `tokenCount=${data.tokens}`
              );
            }
          });
      });

      console.log(`[Startup] Starting engine for ${adapter.id}.`);
      engine.start();

      // Network Intercept Bridge: Listen for conversation data from the MAIN-world
      // network interceptor (networkDiscovery.content.ts). The MAIN world intercepts
      // ChatGPT's own authenticated fetch and posts the mapping data via postMessage.
      // We normalize it, store it in NetworkHistoryStore, and trigger acquisition.
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

          const rawNodeCount =
            typeof mapping === 'object' && mapping !== null ? Object.keys(mapping).length : 0;

          // Normalize using the shared ChatGPT mapping parser
          const messages = normalizeChatGPTMapping({ mapping });

          console.log(
            `[NetworkHistory]\n` +
              `Conversation ID: ${conversationId}\n` +
              `Raw mapping nodes: ${rawNodeCount}\n` +
              `Normalized messages: ${messages.length}\n` +
              `[VERIFY:NETWORK]\n` +
              `conversationId=${conversationId}\n` +
              `messages=${messages.length}`
          );

          if (messages.length > 0) {
            // Retain history in central NetworkHistoryStore for ConversationAcquirer
            NetworkHistoryStore.set({
              conversationId,
              rawNodeCount,
              messages,
              timestamp: Date.now(),
            });

            console.log(
              `[VERIFY:NETWORK_TO_BACKGROUND]\n` +
                `conversationId=${conversationId}\n` +
                `messages=${messages.length}`
            );

            // Emit CONTENT_MUTATION directly to background for immediate canonical persistence
            const observation: DOMObservation = {
              platform: 'chatgpt',
              threadId: conversationId,
              url: interceptedUrl || window.location.href,
              pageTitle: document.title,
              messages,
              isStreaming: false,
              source: 'NETWORK',
            };

            messaging
              .sendToBackground<{
                conversationId?: string;
                canonicalMessageCount?: number;
                storedMessageCount?: number;
                turns?: number;
                tokens?: number;
              }>({
                type: 'CONTENT_MUTATION',
                payload: observation,
              })
              .then((res) => {
                const data = res?.data;
                if (data) {
                  console.log(
                    `[VERIFY:CONVERSATION_MANAGER]\n` +
                      `conversationId=${data.conversationId}\n` +
                      `source=NETWORK\n` +
                      `incomingMessages=${messages.length}\n` +
                      `[VERIFY:CANONICAL]\n` +
                      `conversationId=${data.conversationId}\n` +
                      `messageCount=${data.canonicalMessageCount}\n` +
                      `[VERIFY:INDEXEDDB]\n` +
                      `conversationId=${data.conversationId}\n` +
                      `storedMessageCount=${data.storedMessageCount}\n` +
                      `[VERIFY:ESTIMATOR_INPUT]\n` +
                      `canonicalMessageCount=${data.canonicalMessageCount}\n` +
                      `domMessageCount=${messages.length}\n` +
                      `estimatorMessageCount=${data.canonicalMessageCount}\n` +
                      `source=CANONICAL\n` +
                      `[VERIFY:DERIVED]\n` +
                      `conversationId=${data.conversationId}\n` +
                      `canonicalMessageCount=${data.canonicalMessageCount}\n` +
                      `derivedMessageCount=${data.canonicalMessageCount}\n` +
                      `turnCount=${data.turns}\n` +
                      `tokenCount=${data.tokens}`
                  );
                }
              });

            // Trigger engine to run acquisition using NetworkInterceptStrategy
            engine.triggerAcquisition('NetworkIntercept');

            console.log(
              `[NetworkBridge] Stored and dispatched initial network history for ${conversationId}`
            );
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
