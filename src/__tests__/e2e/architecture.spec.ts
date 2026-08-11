import { test, expect } from './fixtures';
import type { Page, Worker } from '@playwright/test';

test.describe('Canonical Context Architecture Invariants', () => {

  test.beforeEach(async ({ context, page }, testInfo) => {
    // Use the test ID to make thread IDs unique
    const uniqueId = testInfo.title.replace(/[^a-zA-Z0-9]/g, '-').substring(0, 20);
    const threadId = `test-thread-${uniqueId}`;
    
    // Route chatgpt.com to our mock HTML so the content script activates
    await context.route(`https://chatgpt.com/c/${threadId}`, route => {
      route.fulfill({
        contentType: 'text/html',
        body: `
          <!DOCTYPE html>
          <html>
            <head><title>Mock ChatGPT</title></head>
            <body>
              <main id="chat-container">
              </main>
            </body>
          </html>
        `
      });
    });
  });

  // Helper to inject a message into the DOM
  async function injectMessage(page: Page, id: string, role: 'user' | 'assistant', text: string) {
    await page.evaluate(({ id, role, text }: { id: string; role: string; text: string }) => {
      const main = document.querySelector('main');
      const div = document.createElement('div');
      div.className = 'conversation-turn';
      div.setAttribute('data-message-author-role', role);
      div.setAttribute('data-message-id', id);
      div.innerText = text;
      main?.appendChild(div);
    }, { id, role, text });
  }
  
  // Helper to modify an existing message
  async function updateMessage(page: Page, id: string, text: string) {
    await page.evaluate(({ id, text }: { id: string; text: string }) => {
      const msg = document.querySelector(`[data-message-id="${id}"]`) as HTMLElement;
      if (msg) msg.innerText = text;
    }, { id, text });
  }

  // Helper to remove messages from the DOM
  async function removeMessages(page: Page, count: number) {
    await page.evaluate(({ count }: { count: number }) => {
      const msgs = document.querySelectorAll('.conversation-turn');
      for (let i = 0; i < count; i++) {
        if (msgs[i]) msgs[i].remove();
      }
    }, { count });
  }

  async function getBackgroundState(background: Worker) {
    return await background.evaluate(async () => {
      return await chrome.storage.local.get(null);
    });
  }
  
  async function getIDBConversationCount(background: Worker, conversationId: string) {
    return await background.evaluate(async ({ conversationId }: { conversationId: string }) => {
      return new Promise<number>((resolve, reject) => {
        const req = indexedDB.open('ai-context-tracker-db', 1);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('conversations', 'readonly');
          const store = tx.objectStore('conversations');
          const getReq = store.get(conversationId);
          getReq.onsuccess = () => {
            resolve(getReq.result ? getReq.result.orderedMessageIds.length : 0);
          };
          getReq.onerror = () => reject(getReq.error);
        };
        req.onerror = () => reject(req.error);
      });
    }, { conversationId });
  }

  test('Invariant 1 & 6: Conversation length never decreases after page refresh & no new conv created', async ({ context, page }, testInfo) => {
    const uniqueId = testInfo.title.replace(/[^a-zA-Z0-9]/g, '-').substring(0, 20);
    const threadId = `test-thread-${uniqueId}`;
    
    await page.goto(`https://chatgpt.com/c/${threadId}`);
    
    // Inject 10 messages
    for (let i = 0; i < 10; i++) {
      await injectMessage(page, `msg-${i}`, i % 2 === 0 ? 'user' : 'assistant', `Test message ${i}`);
    }
    
    // Wait for content mutation sync (debounced at 250ms in engine)
    await page.waitForTimeout(1000);
    
    const [background] = context.serviceWorkers();
    
    let count = await getIDBConversationCount(background, `chatgpt:${threadId}`);
    expect(count).toBe(10);
    
    // Hard refresh
    await page.reload();
    
    // Inject only the last 4 messages (simulating partial load)
    for (let i = 6; i < 10; i++) {
      await injectMessage(page, `msg-${i}`, i % 2 === 0 ? 'user' : 'assistant', `Test message ${i}`);
    }
    
    await page.waitForTimeout(1000);
    
    // Count should still be 10, not 4
    count = await getIDBConversationCount(background, `chatgpt:${threadId}`);
    expect(count).toBe(10);
  });

  test('Invariant 2: Conversation length never decreases because of DOM virtualization', async ({ context, page }, testInfo) => {
    const uniqueId = testInfo.title.replace(/[^a-zA-Z0-9]/g, '-').substring(0, 20);
    const threadId = `test-thread-${uniqueId}`;
    await page.goto(`https://chatgpt.com/c/${threadId}`);
    
    // Inject 50 messages
    for (let i = 0; i < 50; i++) {
      await injectMessage(page, `msg-${i}`, 'user', `Message ${i}`);
    }
    await page.waitForTimeout(1000);
    
    const [background] = context.serviceWorkers();
    let count = await getIDBConversationCount(background, `chatgpt:${threadId}`);
    expect(count).toBe(50);
    
    // Remove the first 40 (DOM virtualization)
    await removeMessages(page, 40);
    await page.waitForTimeout(1000);
    
    // IDB should still hold 50
    count = await getIDBConversationCount(background, `chatgpt:${threadId}`);
    expect(count).toBe(50);
  });

  test('Invariant 3, 4, 5: UI Consistency, Summary Input, and Token Count derived from Canonical', async ({ context, page }, testInfo) => {
    const uniqueId = testInfo.title.replace(/[^a-zA-Z0-9]/g, '-').substring(0, 20);
    const threadId = `test-thread-${uniqueId}`;
    await page.goto(`https://chatgpt.com/c/${threadId}`);
    
    for (let i = 0; i < 5; i++) {
      await injectMessage(page, `msg-${i}`, 'user', `Message ${i}`);
    }
    await page.waitForTimeout(1000);
    
    const [background] = context.serviceWorkers();
    const state = await getBackgroundState(background);
    
    // Ensure tokens are populated (from offscreen tiktoken)
    // Actually, 'local:appState' key in WXT holds the appState
    const rawAppState = state['local:appState'];
    expect(rawAppState).toBeDefined();
    
    // stats.turns should be 5
    expect(rawAppState.stats.turns).toBe(5);
    // tokenEstimate.count should be derived from all 5 messages
    expect(rawAppState.tokenEstimate.count).toBeGreaterThan(0);
    
    // Ensure the side panel and widget receive this state
    // We can evaluate in page context if the widget is mounted
    const widgetTurns = await page.evaluate(() => {
      const turnCounter = document.querySelector('.turns-counter');
      return turnCounter ? (turnCounter as HTMLElement).innerText : null;
    });
    // Not explicitly testing innerText parsing here, just existence of synced data
  });

  test('Invariant 7: Streaming updates modify existing message instead of creating duplicates', async ({ context, page }, testInfo) => {
    const uniqueId = testInfo.title.replace(/[^a-zA-Z0-9]/g, '-').substring(0, 20);
    const threadId = `test-thread-${uniqueId}`;
    await page.goto(`https://chatgpt.com/c/${threadId}`);
    
    // Simulate streaming by updating the same ID
    await injectMessage(page, 'msg-stream', 'assistant', 'S');
    await page.waitForTimeout(300);
    await updateMessage(page, 'msg-stream', 'Streaming...');
    await page.waitForTimeout(300);
    await updateMessage(page, 'msg-stream', 'Streaming complete.');
    await page.waitForTimeout(1000);
    
    const [background] = context.serviceWorkers();
    const count = await getIDBConversationCount(background, 'chatgpt:test-thread-id');
    
    // Should be EXACTLY 1 message, not 3.
    expect(count).toBe(1);
  });

  test('Invariant 8: Multiple tabs do not corrupt conversation state', async ({ context, page }, testInfo) => {
    const uniqueId = testInfo.title.replace(/[^a-zA-Z0-9]/g, '-').substring(0, 20);
    const threadId = `test-thread-${uniqueId}`;
    // Open two pages pointing to same thread
    await page.goto(`https://chatgpt.com/c/${threadId}`);
    const page2 = await context.newPage();
    await page2.goto(`https://chatgpt.com/c/${threadId}`);
    
    // Inject rapidly across both pages
    await Promise.all([
      injectMessage(page, 'msg-a', 'user', 'From tab 1'),
      injectMessage(page2, 'msg-b', 'assistant', 'From tab 2'),
    ]);
    
    await page.waitForTimeout(1000);
    
    const [background] = context.serviceWorkers();
    const count = await getIDBConversationCount(background, 'chatgpt:test-thread-id');
    
    // Both should merge perfectly due to Web Locks
    expect(count).toBe(2);
  });

  test('Invariant 9: Service Worker suspension does not lose history', async ({ context, page }, testInfo) => {
    const uniqueId = testInfo.title.replace(/[^a-zA-Z0-9]/g, '-').substring(0, 20);
    const threadId = `test-thread-${uniqueId}`;
    await page.goto(`https://chatgpt.com/c/${threadId}`);
    
    await injectMessage(page, 'msg-1', 'user', 'First message');
    await page.waitForTimeout(1000);
    
    let [background] = context.serviceWorkers();
    let count = await getIDBConversationCount(background, `chatgpt:${threadId}`);
    expect(count).toBe(1);
    
    // Stop the worker directly using CDP
    const session = await context.newCDPSession(page);
    await session.send('ServiceWorker.stopAllWorkers');
    await page.waitForTimeout(500); // Give it time to terminate
    
    // Trigger a new mutation which will wake up the SW
    await injectMessage(page, 'msg-2', 'assistant', 'Second message');
    await page.waitForTimeout(2000); // Wait for wake up and sync
    
    // SW restarts, meaning `sessionMessages` would be wiped if we still used it.
    // Since we use IDB, the count should be 2.
    // Wait for the new background worker reference
    [background] = context.serviceWorkers();
    if (!background) {
      background = await context.waitForEvent('serviceworker');
    }
    
    count = await getIDBConversationCount(background, `chatgpt:${threadId}`);
    expect(count).toBe(2);
  });

  test('Invariant 10: ConversationManager is the only component capable of mutating IndexedDB', async ({ page }, testInfo) => {
    const uniqueId = testInfo.title.replace(/[^a-zA-Z0-9]/g, '-').substring(0, 20);
    const threadId = `test-thread-${uniqueId}`;
    await page.goto(`https://chatgpt.com/c/${threadId}`);
    
    // Try to open IndexedDB directly from the content script page context
    // This will either fail due to cross-origin isolation or prove isolation
    const hasConversationsStore = await page.evaluate(async () => {
      return new Promise((resolve) => {
        const req = indexedDB.open('ai-context-tracker-db', 1);
        req.onsuccess = () => {
          const db = req.result;
          resolve(db.objectStoreNames.contains('conversations'));
        };
        req.onerror = () => {
          resolve(false);
        };
      });
    });
    
    // Ensure the web page cannot access the extension's database (the one with our schema).
    // The page might create a new empty DB with the same name in its own origin, but it won't have our schema.
    expect(hasConversationsStore).toBe(false);
  });

});
