# AI Context Tracker — Code Location Reference

## Exact Architecture Implementation

### 1. Content Script Entry Point
**Where:** `src/entrypoints/content/`  
**Status:** No main content.ts file; only widget/ subdirectory exists  
**Note:** DOM observation happens in `RobustDOMEngine` (not a separate entrypoint)

---

### 2. RobustDOMEngine (Primary Orchestrator)
**File:** `src/adapters/engine.ts`  
**Class:** `RobustDOMEngine`

**Key Methods:**
- `start()` (line ~60) — Initializes detector and observer
- `onConversationReady()` (line ~90) — Attaches MutationObserver when conversation ready
- `processDOM()` (line ~200) — Main extraction function, runs when mutations detected
- `getObservationTarget()` (line ~108) — Finds DOM root for observer
- `setupUrlListener()` (line ~128) — Detects navigation (SPA history API)
- `scheduleUpdate()` (line ~170) — Debounces DOM extraction (250ms)

**Key Variables:**
```typescript
private acquirer: ConversationAcquirer;      // Handles multi-strategy acquisition
private readyDetector: ConversationReadyDetector;  // Readiness gate
private conversationReady: boolean = false;  // Blocks processing until ready
```

**Data Flow:**
```
start() 
  → setupUrlListener() 
  → readyDetector.start()
     → onConversationReady() [when ready signal fires]
        → MutationObserver attached
        → scheduleUpdate('ConversationReady')
           → processDOM()
              → acquirer.acquire() [strategy pipeline]
              → emits via messaging.send('CONTENT_MUTATION', observation)
```

---

### 3. ConversationReadyDetector (🔴 HAS BUG)
**File:** `src/adapters/ConversationReadyDetector.ts`  
**Class:** `ConversationReadyDetector`

**Bug Location:** `getScrollContainer()` method (lines ~130-160)

```typescript
private getScrollContainer(): Element | null {
  tagAllCandidateScrollContainers();
  const selectors = [
    'div[class*="react-scroll-to-bottom"]',      // ← Tries this FIRST
    'div[class*="react-scroll-to-bottom--css"]',
    'main div.overflow-y-auto',
    'div.overflow-y-auto',
    'main',
    '[role="main"]',
  ];
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el && el.scrollHeight > 0) {  // 🔴 WRONG: accepts ANY element
      // Returns first match with scrollHeight > 0
      // This is often the sidebar (494px) not the main conversation (406k px)
      return el;  // ← BUG: Returns wrong element
    }
  }
  return null;
}
```

**Fix:** Change condition from `el.scrollHeight > 0` to `el.scrollHeight > el.clientHeight`

**Correct Logic:**
```typescript
if (el && el.scrollHeight > el.clientHeight) {  // ✅ Only scrollable containers
  return el;
}
```

**Key Methods:**
- `start()` (line ~80) — Initializes timers and mutation observer
- `poll()` (line ~240) — Main polling loop, checks for layout stability
- `getScrollContainer()` (line ~130) — **HAS BUG**
- `getMessageInfo()` (line ~220) — Counts visible messages
- `emitReady()` (line ~305) — Fires onReady callback

---

### 4. Acquisition Pipeline
**File:** `src/core/acquisition/ConversationAcquirer.ts`  
**Class:** `ConversationAcquirer`

**Strategy Pipeline (Lines ~30-80):**
```typescript
// Current hardcoded strategies:
for (const strategy of this.strategies) {
  if (!strategy.canExecute(platform)) continue;
  
  const stratResult = await strategy.execute(threadId, signal, onProgress);
  
  if (stratResult.success && stratResult.messages.length > 0) {
    result = stratResult;
    selectedStrategy = strategy.type;
    
    if (stratResult.isComplete) {
      // Complete history obtained; stop trying strategies
      break;  // ← Only breaks if isComplete=true
    }
  }
}
```

**Current Strategies Registered (engine.ts line ~32):**
```typescript
this.acquirer = new ConversationAcquirer([
  new HydrationStrategy(adapter),    // Try first
  new VisibleDOMStrategy(adapter)     // Try second (only succeeds)
]);
```

---

### 5. VisibleDOMStrategy (Fallback)
**File:** `src/core/acquisition/strategies/VisibleDOMStrategy.ts`  
**Class:** `VisibleDOMStrategy`

**Key Method:** `extractMessages()` (lines ~50-180)

**How It Works:**
1. Queries adapter's DOM selectors: `['[data-message-author-role]', 'article', '.prose']`
2. Extracts role from `data-message-author-role` attribute
3. Gets text from `innerText`
4. Generates ID from `data-message-id` or hashes text
5. Returns array of ChatMessage (16 visible)
6. **Crucially:** Returns `isComplete=false` (knows it's incomplete)

**Output Example:**
```javascript
{
  strategy: 'DOM',
  success: true,
  messages: [
    { id: 'hash-xyz', role: 'user', text: 'What is...' },
    { id: 'hash-abc', role: 'ai', text: 'This is...' },
    // ... 14 more visible messages
  ],
  isComplete: false  // ← Correctly marks incomplete
}
```

---

### 6. HydrationStrategy (Not Viable)
**File:** `src/core/acquisition/strategies/HydrationStrategy.ts`  
**Class:** `HydrationStrategy`

**Current Status:** Fails on modern ChatGPT

**Why It Fails:**
- Looks for `window.__NEXT_DATA__` → Not found
- Looks for `window.__remixContext` → Not found
- Modern ChatGPT is Remix-based, not Next.js
- No complete conversation history exposed to page hydration

**Code (lines ~20-45):**
```typescript
try {
  this.hasExecuted = true;
  const messages = await this.adapter.extractHydrationData();
  
  if (messages && messages.length > 0) {
    return {
      strategy: this.type,
      success: true,
      messages,
      isComplete: true  // ← If found, would be complete
    };
  }

  return {
    strategy: this.type,
    success: false,    // ← Current state: always fails
    messages: [],
    isComplete: false,
    error: new Error('No hydration data found')
  };
}
```

---

### 7. ConversationManager (Persistence)
**File:** `src/core/ConversationManager.ts`  
**Class:** `ConversationManager`

**Entry Point:** `processMutation()` (lines ~1-130)

**Key Logic:**
```typescript
// Generate conversation ID from platform + threadId
const conversationId = `${observation.platform}:${threadId}`;

// Fetch existing conversation from IndexedDB
let conversation = await convStore.get(conversationId);

// Merge new messages
for (const msg of observation.messages) {
  const existing = conversation.messages[msg.id];
  
  if (!existing) {
    conversation.messages[msg.id] = msg;        // ← Add new
    conversation.orderedMessageIds.push(msg.id);
    addedCount++;
  } else if (existing.text !== msg.text) {
    existing.text = msg.text;                   // ← Update (streaming)
    updatedCount++;
  } else {
    ignoredCount++;                             // ← Duplicate
  }
}

// Persist to IndexedDB
await convStore.put(conversation);
```

**Why It Works with Partial Data:**
- Doesn't assume messages come from any specific source
- Processes messages ID-by-ID (deterministic)
- IndexedDB correctly stores 16 messages if that's what's given
- Can't invent missing 484 messages

---

### 8. ContextEstimationEngine
**File:** `src/core/context-estimation/ContextEstimationEngine.ts`  
**Class:** `ContextEstimationEngine`

**Entry Point:** `estimate()` (lines ~30-100)

**Input Structure (EstimationInput):**
```typescript
{
  observedConversation: Conversation,     // From IndexedDB
  observedTokens: number,                 // From offscreen tokenizer
  observedTurns: number,                  // Visible user message count
  visibleMessageCount: number,            // Always 16 in current case
  averageUserTokens: number,              // Per-message avg
  averageAssistantTokens: number,         // Per-message avg
  scrollTop: number,                      // From scroll container
  scrollHeight: number,                   // 406,182px (main#main)
  viewportHeight: number,                 // 442px (clientHeight)
  platform: string,                       // 'chatgpt'
  conversationId: string,                 // Platform:threadId
  currentUrl: string                      // Full URL
}
```

**Estimation Logic:**
```typescript
const scrollRatio = scrollHeight / viewportHeight;  // ~918x
const estimatedTurns = observedTurns * scrollRatio;
const estimatedTokens = observedTokens * scrollRatio;

// Example output with current data:
// 16 visible × 918 ratio = ~14,688 estimated turns (UNRELIABLE)
```

---

### 9. Background Service Worker
**File:** `src/entrypoints/background.ts`  
**Export:** `defineBackground()` function

**Message Handler (lines ~70-300):**
```typescript
messaging.addListener(async (message: ExtensionMessage, sender) => {
  switch (message.type) {
    case 'CONTENT_MUTATION': {
      const observation = message.payload;
      
      // 1. Merge into IndexedDB
      const conversation = await conversationManager.processMutation(observation);
      
      // 2. Get full message array
      const fullMessages = conversation.orderedMessageIds.map(
        id => conversation.messages[id]
      );  // ← Even with partial data, works correctly
      
      // 3. Request tokenization from offscreen
      const estimate = await browser.runtime.sendMessage({
        type: 'TOKENIZE_REQUEST',
        payload: { platformId, maxContext, messages: fullMessages }
      });
      
      // 4. Run estimator
      const estimatedContext = contextEstimationEngine.estimate({
        observedConversation: conversation,
        observedTokens: estimate.totalTokens,
        observedTurns: turns,
        visibleMessageCount: observation.messages.length,  // 16
        scrollTop: observation.scrollTop,                   // 0 or more
        scrollHeight: observation.scrollHeight,             // 406,182
        viewportHeight: observation.clientHeight,           // 442
        // ... other fields
      });
      
      // 5. Update UI state
      await storageLayer.updateAppState({
        tokenEstimate: estimate,
        estimatedContext,
        stats: { turns, avgTokensPerTurn }
      });
    }
  }
});
```

---

### 10. Network Discovery Interceptor
**File:** `src/entrypoints/networkDiscovery.content.ts`  
**Status:** ✅ Implemented and running

**Type:** Content script, runs in MAIN world (can see all network requests)

**What It Does:**
```typescript
// Intercepts fetch() calls
const originalFetch = window.fetch;
window.fetch = async function(...args) {
  const response = await originalFetch.apply(this, args);
  
  if (isCandidate(url)) {  // Filters for 'conversation', 'messages', etc.
    // Logs to console: 
    // === CHATGPT HISTORY REQUEST DISCOVERY ===
    // Candidate #N
    // URL: ...
    // STATUS: ...
    // CONTAINS MESSAGE HISTORY: YES/NO
  }
  
  return response;
};

// Also intercepts XMLHttpRequest similarly
```

**How to Use It:**
1. Open DevTools Console
2. Look for logs: `=== CHATGPT HISTORY REQUEST DISCOVERY ===`
3. Identify which endpoint returns `{ mapping: {...} }` or `{ messages: [...] }`
4. That's the endpoint to use for APIStrategy

---

### 11. Messaging Layer
**File:** `src/messaging/client.ts`  
**Type:** Type-safe cross-context messaging

**Key Functions:**
- `addListener(callback)` — Background listens for messages
- `send(message)` — Content script sends message
- Uses `chrome.runtime.sendMessage()` under the hood

**Message Types (src/messaging/types.ts):**
```typescript
type ExtensionMessage = 
  | { type: 'GET_STATE', payload: void }
  | { type: 'CONTENT_MUTATION', payload: DOMObservation }
  | { type: 'UPDATE_TOKEN_COUNT', payload: { count, platform } }
  | { type: 'TOKENIZE_REQUEST', payload: { ... } }
  // ... others
```

---

### 12. Storage Layer
**File:** `src/storage/db.ts`  
**Type:** IndexedDB abstraction

**Database Schema:**
```
Database: 'ai-context-tracker'

Store: 'conversations'
  keyPath: 'id'
  {
    id: 'chatgpt:uuid-...',           // Conversation identifier
    platform: 'chatgpt',
    threadId: 'uuid-...',
    messages: { [msgId]: ChatMessage, ... },  // Map of messages
    orderedMessageIds: ['id1', 'id2', ...],   // Ordered list
    metadata: { url, title },
    summary: { ... },
    tokenEstimate: { count, confidence },
    stats: { turns, avgTokensPerTurn },
    createdAt: timestamp,
    updatedAt: timestamp,
    version: number  // Increments on changes
  }

Store: 'mutation_logs'
  Event sourcing log (for debugging)
```

---

## Data Flow Trace

### For an Existing Old Conversation

```
1. User opens: /c/abc123xyz...
   ↓
2. RobustDOMEngine.start() fires
   → Calls readyDetector.start()
   ↓
3. ConversationReadyDetector.poll() runs
   → Calls getScrollContainer()
   → 🔴 BUG: Returns sidebar (494px) not main (406k px)
   ↓
4. When layout stabilizes & mutations quiet:
   → emitReady() fires
   → onConversationReady() called in RobustDOMEngine
   ↓
5. RobustDOMEngine.scheduleUpdate('ConversationReady')
   → 250ms debounce
   → processDOM() runs
   ↓
6. processDOM():
   → Gets correct scroll container (main#main)
   → scrollHeight=406182, clientHeight=442
   → Calls acquirer.acquire(threadId, 'chatgpt')
   ↓
7. ConversationAcquirer.acquire():
   → Tries HydrationStrategy → FAILS (no __NEXT_DATA__)
   → Tries VisibleDOMStrategy → SUCCEEDS (16 messages)
   → Returns { messages: [16 items], isComplete: false }
   ↓
8. RobustDOMEngine creates DOMObservation:
   {
     platform: 'chatgpt',
     threadId: 'abc123xyz',
     url: '...',
     messages: [16 messages],     // ← Only 16!
     scrollHeight: 406182,
     clientHeight: 442,
     scrollTop: 0,
     isStreaming: false
   }
   ↓
9. Sends via messaging.send('CONTENT_MUTATION', observation)
   ↓
10. Background.ts receives:
    → ConversationManager.processMutation()
    → Stores 16 messages in IndexedDB under 'chatgpt:abc123xyz'
    → Returns: Canonical count = 16
    ↓
11. ContextEstimationEngine.estimate():
    Input: observedTurns=8, observedTokens=2000, 
           visibleMessageCount=16, scrollHeight=406182, viewportHeight=442
    
    Calculates: scrollRatio = 406182 / 442 = ~918
    Estimates: estimatedTurns = 8 * 918 = ~7,344
    Estimates: estimatedTokens = 2000 * 918 = ~1,836,000
    
    Confidence: LOW (based on 16-message sample)
    ↓
12. UI displays: "7,344 turns | 1.8M tokens" 
    ⚠️ NO indication this is ESTIMATED not EXACT
    ↓
13. User doesn't know conversation isn't fully tracked
```

---

## What Needs to Change

### Change #1: Fix Scroll Container Bug (5 min)
**File:** `src/adapters/ConversationReadyDetector.ts:134`  
```typescript
// BEFORE
if (el && el.scrollHeight > 0) {

// AFTER
if (el && el.scrollHeight > el.clientHeight) {
```

### Change #2: Add APIStrategy (2-3 days)
**File:** `src/core/acquisition/strategies/APIStrategy.ts` (NEW)

Create new file with class implementing AcquisitionStrategy:
- `execute()` makes fetch call to `/backend-api/conversation/{threadId}`
- Parses response into ChatMessage[]
- Returns `{ success: true, messages: 500+, isComplete: true }`

**File:** `src/adapters/engine.ts` (REGISTER)
```typescript
// Line ~32, change:
this.acquirer = new ConversationAcquirer([
  new APIStrategy(adapter),      // ← Add this (try first)
  new HydrationStrategy(adapter),
  new VisibleDOMStrategy(adapter)
]);
```

---

## Summary

**Current Architecture:** ✅ Correct and complete  
**Bug in Production:** 🔴 Readiness detector scroll container selection  
**Missing Feature:** ❌ Automatic historical acquisition via API  
**Fix Timeline:** 5 days (1 day fix bug, 4 days implement API strategy)  
**Effort to Fix:** Medium (straightforward, well-architected codebase)  
**Payoff:** Complete automatic historical conversation tracking

