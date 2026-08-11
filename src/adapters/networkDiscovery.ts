/**
 * Network Discovery Interceptor
 * Injected into the MAIN world of ChatGPT pages to inspect network calls.
 * STRICTLY NO MESSAGE TEXT, TOKENS, OR HEADERS ARE LOGGED.
 */

export function injectNetworkDiscoveryScript() {
  const code = `
  (function() {
    if (window.__chatgpt_network_discovery_injected) return;
    window.__chatgpt_network_discovery_injected = true;

    console.log("%c[Network Discovery] Interceptor active on page.", "color: #10b981; font-weight: bold;");

    let currentTrigger = 'INITIAL_LOAD';
    let candidateIndex = 0;

    // Track state triggers
    window.addEventListener('popstate', () => { currentTrigger = 'NAVIGATION'; });
    window.addEventListener('locationchange', () => { currentTrigger = 'NAVIGATION'; });
    
    document.addEventListener('click', (e) => {
      const target = e.target;
      if (target && target.closest && (target.closest('a') || target.closest('nav') || target.closest('[data-testid*="sidebar"]'))) {
        currentTrigger = 'SIDEBAR_CLICK';
      }
    }, true);

    document.addEventListener('scroll', (e) => {
      if (e.target && e.target.scrollTop < 50) {
        currentTrigger = 'SCROLL_UP';
      }
    }, true);

    const FILTER_KEYWORDS = ['conversation', 'messages', 'history', 'backend-api', '/api/'];

    function isCandidate(url) {
      if (!url) return false;
      const lower = url.toLowerCase();
      // Skip known telemetry / analytics / extensions
      if (lower.includes('sentry') || lower.includes('telemetry') || lower.includes('amplitude') || lower.includes('datadog')) return false;
      return FILTER_KEYWORDS.some(kw => lower.includes(kw));
    }

    function processCandidate(metadata) {
      candidateIndex++;
      console.log(\`
=== CHATGPT HISTORY REQUEST DISCOVERY ===
Candidate #\${candidateIndex}
URL: \${metadata.url}
METHOD: \${metadata.method}
STATUS: \${metadata.status}
TRIGGER: \${metadata.trigger}
CONTENT-TYPE: \${metadata.contentType}
RESPONSE SIZE: \${metadata.responseSize} bytes
TOP LEVEL KEYS: \${metadata.topLevelKeys.join(', ')}
PAYLOAD KEYS: \${metadata.payloadKeys.join(', ')}
CONTAINS MESSAGE HISTORY: \${metadata.hasMessageHistory ? 'YES' : 'NO'}
Structural Keys Found: mapping=\${metadata.hasMapping}, messages=\${metadata.hasMessages}, current_node=\${metadata.hasCurrentNode}, conversation_id=\${metadata.hasConversationId}
      \`);
    }

    async function inspectResponseBody(url, method, status, contentType, bodyText, requestPayload) {
      let topLevelKeys = [];
      let hasMapping = false;
      let hasMessages = false;
      let hasCurrentNode = false;
      let hasConversationId = false;
      let hasMessageHistory = false;
      let payloadKeys = [];

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
              topLevelKeys = [\`[Array of \${data.length} items]\`, ...Object.keys(data[0])];
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

      // Reset trigger to IDLE after logging
      setTimeout(() => { currentTrigger = 'IDLE'; }, 1000);
    }

    // Intercept window.fetch
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
      const resource = args[0];
      const config = args[1] || {};
      const url = typeof resource === 'string' ? resource : (resource && resource.url ? resource.url : '');
      const method = config.method || (resource && resource.method ? resource.method : 'GET');

      const response = await originalFetch.apply(this, args);

      if (isCandidate(url)) {
        try {
          const clone = response.clone();
          const bodyText = await clone.text();
          const contentType = response.headers.get('content-type') || '';
          let requestPayload = config.body || null;
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

    XMLHttpRequest.prototype.open = function(method, url) {
      this._nd_url = url;
      this._nd_method = method;
      return originalOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function(body) {
      this._nd_body = body;
      this.addEventListener('load', function() {
        if (isCandidate(this._nd_url)) {
          const contentType = this.getResponseHeader('content-type') || '';
          inspectResponseBody(this._nd_url, this._nd_method, this.status, contentType, this.responseText, this._nd_body);
        }
      });
      return originalSend.apply(this, arguments);
    };

  })();
  `;

  try {
    const script = document.createElement('script');
    script.textContent = code;
    (document.head || document.documentElement).appendChild(script);
    script.remove();
  } catch (err) {
    console.error('[Network Discovery] Injection failed:', err);
  }
}
