import { defineContentScript } from 'wxt/sandbox';

export default defineContentScript({
  matches: ['*://chatgpt.com/*', '*://*.chatgpt.com/*', '*://chat.openai.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    if ((window as any).__chatgpt_network_discovery_injected) return;
    (window as any).__chatgpt_network_discovery_injected = true;

    console.log('%c[Network Discovery] Interceptor active on page (MAIN world entrypoint).', 'color: #10b981; font-weight: bold;');

    let currentTrigger = 'INITIAL_LOAD';
    let candidateIndex = 0;

    window.addEventListener('popstate', () => { currentTrigger = 'NAVIGATION'; });
    window.addEventListener('locationchange', () => { currentTrigger = 'NAVIGATION'; });

    document.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target && target.closest && (target.closest('a') || target.closest('nav') || target.closest('[data-testid*="sidebar"]'))) {
        currentTrigger = 'SIDEBAR_CLICK';
      }
    }, true);

    document.addEventListener('scroll', (e) => {
      const target = e.target as HTMLElement;
      if (target && target.scrollTop < 50) {
        currentTrigger = 'SCROLL_UP';
      }
    }, true);

    const FILTER_KEYWORDS = ['conversation', 'messages', 'history', 'backend-api', '/api/'];

    function isCandidate(url: string) {
      if (!url) return false;
      const lower = url.toLowerCase();
      if (lower.includes('sentry') || lower.includes('telemetry') || lower.includes('amplitude') || lower.includes('datadog')) return false;
      return FILTER_KEYWORDS.some(kw => lower.includes(kw));
    }

    function processCandidate(metadata: any) {
      candidateIndex++;
      console.log(`
=== CHATGPT HISTORY REQUEST DISCOVERY ===
Candidate #${candidateIndex}
URL: ${metadata.url}
METHOD: ${metadata.method}
STATUS: ${metadata.status}
TRIGGER: ${metadata.trigger}
CONTENT-TYPE: ${metadata.contentType}
RESPONSE SIZE: ${metadata.responseSize} bytes
TOP LEVEL KEYS: ${metadata.topLevelKeys.join(', ')}
PAYLOAD KEYS: ${metadata.payloadKeys.join(', ')}
CONTAINS MESSAGE HISTORY: ${metadata.hasMessageHistory ? 'YES' : 'NO'}
Structural Keys Found: mapping=${metadata.hasMapping}, messages=${metadata.hasMessages}, current_node=${metadata.hasCurrentNode}, conversation_id=${metadata.hasConversationId}
      `);
    }

    async function inspectResponseBody(url: string, method: string, status: number, contentType: string, bodyText: string, requestPayload: any) {
      let topLevelKeys: string[] = [];
      let hasMapping = false;
      let hasMessages = false;
      let hasCurrentNode = false;
      let hasConversationId = false;
      let hasMessageHistory = false;
      let payloadKeys: string[] = [];

      if (requestPayload) {
        try {
          const parsedReq = JSON.parse(requestPayload);
          if (parsedReq && typeof parsedReq === 'object') {
            payloadKeys = Object.keys(parsedReq);
          }
        } catch(e) {}
      }

      if (bodyText) {
        try {
          const data = JSON.parse(bodyText);
          if (data && typeof data === 'object' && !Array.isArray(data)) {
            topLevelKeys = Object.keys(data);
            hasMapping = 'mapping' in data;
            hasMessages = 'messages' in data;
            hasCurrentNode = 'current_node' in data;
            hasConversationId = 'conversation_id' in data;
            hasMessageHistory = hasMapping || (hasMessages && Array.isArray(data.messages) && data.messages.length > 0);
          } else if (Array.isArray(data)) {
            topLevelKeys = ['[Array]'];
            if (data.length > 0 && typeof data[0] === 'object' && data[0] !== null) {
              topLevelKeys = [`[Array of ${data.length} items]`, ...Object.keys(data[0])];
            }
          }
        } catch(e) {}
      }

      processCandidate({
        url,
        method,
        status,
        trigger: currentTrigger,
        contentType: contentType || 'unknown',
        responseSize: bodyText ? bodyText.length : 0,
        topLevelKeys,
        payloadKeys,
        hasMapping,
        hasMessages,
        hasCurrentNode,
        hasConversationId,
        hasMessageHistory
      });

      // Bridge: Forward successful conversation responses to the ISOLATED content script
      // via window.postMessage. The ISOLATED world cannot intercept page fetches but
      // shares the window message event bus with the MAIN world.
      if (status === 200 && hasMapping && hasConversationId && bodyText) {
        try {
          const data = JSON.parse(bodyText);
          window.postMessage({
            type: '__CTXTRACKER_NETWORK_CONVERSATION__',
            payload: {
              url,
              conversationId: data.conversation_id,
              mapping: data.mapping,
              currentNode: data.current_node || null,
            }
          }, '*');
          console.log(`%c[Network Discovery] Bridged conversation ${data.conversation_id} to content script (${Object.keys(data.mapping).length} nodes)`, 'color: #10b981;');
        } catch (bridgeErr) {
          console.warn('[Network Discovery] Failed to bridge conversation data:', bridgeErr);
        }
      }

      setTimeout(() => { currentTrigger = 'IDLE'; }, 1000);
    }

    // Intercept window.fetch
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
      const resource = args[0];
      const config = args[1] || {};
      const url = typeof resource === 'string' ? resource : (resource && (resource as Request).url ? (resource as Request).url : '');
      const method = config.method || (resource && (resource as Request).method ? (resource as Request).method : 'GET');

      const response = await originalFetch.apply(this, args);

      if (isCandidate(url)) {
        try {
          const clone = response.clone();
          const bodyText = await clone.text();
          const contentType = response.headers.get('content-type') || '';
          const requestPayload = config.body || null;
          inspectResponseBody(url, method, response.status, contentType, bodyText, requestPayload);
        } catch(e) {
          console.warn('[Network Discovery] Error reading fetch clone:', e);
        }
      }

      return response;
    };

    // Intercept XMLHttpRequest
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(this: any, method: string, url: string) {
      this._nd_url = url;
      this._nd_method = method;
      return originalOpen.apply(this, arguments as any);
    };

    XMLHttpRequest.prototype.send = function(this: any, body?: any) {
      this._nd_body = body;
      this.addEventListener('load', function(this: any) {
        if (isCandidate(this._nd_url)) {
          const contentType = this.getResponseHeader('content-type') || '';
          inspectResponseBody(this._nd_url, this._nd_method, this.status, contentType, this.responseText, this._nd_body);
        }
      });
      return originalSend.apply(this, arguments as any);
    };
  },
});
