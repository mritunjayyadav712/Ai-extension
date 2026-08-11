import { PlatformAdapter } from './types';
import { ChatMessage, MessageRole } from '../core/models';

function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32bit integer
  }
  return hash.toString(36);
}

export const chatGptAdapter: PlatformAdapter = {
  id: 'chatgpt',
  name: 'ChatGPT',

  matches(url: URL) {
    return url.hostname.includes('chatgpt.com') || url.hostname.includes('chat.openai.com');
  },

  getThreadId() {
    const match = window.location.pathname.match(/\/c\/([a-zA-Z0-9-]+)/);
    return match ? match[1] : null;
  },

  domSelectors: [
    '[data-message-author-role]',
    'article',
    'div[class*="conversation-turn"]',
    '.prose, .whitespace-pre-wrap'
  ],

  async extractHydrationData(): Promise<ChatMessage[] | null> {
    try {
      const scripts = Array.from(document.querySelectorAll('script'));
      let conversationData = null;
      
      for (const script of scripts) {
        if (!script.textContent) continue;
        
        // 1. Next.js Legacy
        if (script.id === '__NEXT_DATA__') {
          try {
            const data = JSON.parse(script.textContent);
            conversationData = data?.props?.pageProps?.serverResponse?.mapping || data?.props?.pageProps?.initialState?.serverState?.mapping;
          } catch (e) {}
        }
        
        // 2. Remix Current (Usually encoded in window.__remixContext or similar)
        if (script.textContent.includes('__remixContext') || script.textContent.includes('"mapping":')) {
           try {
             const jsonMatch = script.textContent.match(/(\{.*\})/);
             if (jsonMatch) {
                const data = JSON.parse(jsonMatch[1]);
                if (data.mapping) {
                  conversationData = data.mapping;
                } else if (data?.state?.loaderData) {
                  const routes = Object.values(data.state.loaderData);
                  for (const route of routes) {
                    if ((route as any)?.serverResponse?.mapping) {
                       conversationData = (route as any).serverResponse.mapping;
                       break;
                    }
                  }
                }
             }
           } catch(e) {}
        }
        
        if (conversationData) break;
      }
      
      if (!conversationData) return null;
      
      const messages: ChatMessage[] = [];
      
      // ChatGPT mapping is an object: { "node_id": { message: { ... } } }
      Object.values(conversationData).forEach((node: any) => {
         const msg = node?.message;
         if (!msg || !msg.content || !msg.content.parts) return;
         
         const role = msg.author?.role === 'user' ? 'user' : 'ai';
         const text = msg.content.parts.join('\n');
         const id = msg.id;
         const timestamp = msg.create_time || 0;
         
         if (text && text.length > 0) {
           messages.push({ id, role, text, timestamp });
         }
      });
      
      // Sort chronologically by create_time
      messages.sort((a: any, b: any) => (a.timestamp || 0) - (b.timestamp || 0));
      
      console.log(`[ChatGPT Adapter] Successfully extracted ${messages.length} messages from Hydration Data.`);
      return messages.length > 0 ? messages : null;
    } catch (err) {
      console.warn('[ChatGPT Adapter] Hydration parsing failed:', err);
      return null;
    }
  },

  isStreaming() {
    // Look for the "Stop generating" button or the blinking cursor
    const stopButton = document.querySelector('button[aria-label="Stop generating"]');
    const streamingCursor = document.querySelector('.result-streaming');
    return !!(stopButton || streamingCursor);
  },

  extractMessages(): ChatMessage[] {
    // Deprecated. Handled by VisibleDOMStrategy.
    return [];
  }
};

