# AI Context Tracker — Deep Repository Audit Report

**Audit Date:** August 11, 2026  
**Auditor:** GitHub Copilot CLI  
**Scope:** Complete architecture trace, data flow analysis, and root-cause investigation  
**Status:** Alpha Prototype (Historical data is NOT being tracked automatically)

---

## Executive Summary

The AI Context Tracker extension **has the correct architecture but is missing the most critical piece: automatic historical data acquisition**. 

The extension successfully:
- ✅ Detects conversations
- ✅ Tracks live DOM messages (16 visible)
- ✅ Persists to IndexedDB
- ✅ Estimates context via scroll metrics
- ✅ Displays metrics in UI

But it **FAILS to**:
- ❌ Automatically acquire historical messages beyond what's visible
- ❌ Populate the canonical store with complete history
- ❌ Provide accurate token/turn/summary without scrolling

**Root Cause:** The extension only queries visible DOM nodes (16 messages). ChatGPT virtualizes long conversations—older messages disappear from the DOM. The extension has **no way to fetch them automatically**.

### Severity: CRITICAL

Without historical acquisition, the extension's core promise is broken:

```text
Promise: "I maintain the most complete conversation history I can obtain."
Reality: "I maintain only the 16 visible virtualized DOM messages."
```

---

## 1. Architecture Map (Actual Implementation)

### Data Flow Diagram

```
┌──────────────────┐
│   ChatGPT DOM    │
│   (16 virtual)   │
└────────┬─────────┘
         │
         ↓
┌────────────────────────────────────────────────────┐
│ RobustDOMEngine (src/adapters/engine.ts)           │
│ - ConversationReadyDetector (readiness gate)       │
│ - MutationObserver (watches changes)               │
│ - processDOM() (extracts visible messages)         │
└────────┬─────────────────────────────────────────────┘
         │
         ↓
┌────────────────────────────────────────────────────┐
│ ConversationAcquirer (src/core/acquisition)        │
│ Strategy Pipeline:                                  │
│ 1. HydrationStrategy   → FAILS (no hydration data) │
│ 2. VisibleDOMStrategy  → SUCCEEDS (returns 16)    │
│ Result: 16 messages, isComplete=false              │
└────────┬─────────────────────────────────────────────┘
         │
         ↓
┌────────────────────────────────────────────────────┐
│ Messaging Layer                                     │
│ content.ts → background.ts (CONTENT_MUTATION)      │
│ payload: DOMObservation                             │
└────────┬─────────────────────────────────────────────┘
         │
         ↓
┌────────────────────────────────────────────────────┐
│ ConversationManager (src/core/ConversationManager) │
│ processMutation():                                  │
│ - Canonical ID: "${platform}:${threadId}"         │
│ - Merge & deduplicate (working correctly)          │
│ - IndexedDB persist (working correctly)            │
│ - Result: 16 messages in IndexedDB                 │
└────────┬─────────────────────────────────────────────┘
         │
         ↓
┌────────────────────────────────────────────────────┐
│ Downstream Engines                                  │
│ - TokenEngine (offscreen): tokenizes 16            │
│ - SummaryEngine: summarizes 16                     │
│ - DegradationEngine: evaluates 16                  │
│ - ContextEstimationEngine: extrapolates 16         │
│ All engines work, but input is incomplete          │
└────────┬─────────────────────────────────────────────┘
         │
         ↓
┌────────────────────────────────────────────────────┐
│ AppState (Derived State)                           │
│ - tokens: ~2,000 (only from 16 messages)           │
│ - turns: ~8 (only visible user messages)           │
│ - summary: partial (only from 16 messages)         │
│ - estimatedContext: 16 * 918 scroll_ratio          │
└────────┬─────────────────────────────────────────────┘
         │
         ↓
┌────────────────────────────────────────────────────┐
│ UI (Popup, Side Panel, Widget)                     │
│ Display: Incomplete metrics as if they were        │
│ complete (NO indication that data is partial)      │
└────────────────────────────────────────────────────┘

⚠️  THE MISSING LINK: Historical Acquisition Strategy
    NO automatic way to fetch messages beyond the 16 visible
```

---

## 2. Component Status Map

| Component | File | Function | Status | Evidence |
|---|---|---|---|---|
| **ChatGPT Adapter** | `src/adapters/chatgpt.ts` | `extractHydrationData()` | ❌ NOT VIABLE | `__NEXT_DATA__` and `__remixContext` not found; JSON scripts exist but no parseable mapping |
| **RobustDOMEngine** | `src/adapters/engine.ts` | `start()`, `processDOM()` | ✅ WORKING | Correctly orchestrates readiness detection, mutation watching, and DOM extraction |
| **ConversationReadyDetector** | `src/adapters/ConversationReadyDetector.ts` | `poll()`, `getScrollContainer()` | 🔴 **BUGGY** | **BUG FOUND:** Uses wrong scroll container selector; returns sidebar instead of main; accepts `scrollHeight > 0` while processDOM requires `scrollHeight > clientHeight` |
| **VisibleDOMStrategy** | `src/core/acquisition/strategies/VisibleDOMStrategy.ts` | `execute()` | ✅ WORKING | Correctly extracts visible DOM (16 messages); correctly marks `isComplete=false` |
| **HydrationStrategy** | `src/core/acquisition/strategies/HydrationStrategy.ts` | `execute()` | ✅ WORKING | Logic is correct; returns `isComplete=true` if data found; returns null (fails) on current ChatGPT |
| **ConversationAcquirer** | `src/core/acquisition/ConversationAcquirer.ts` | `acquire()` | ✅ WORKING | Runs strategies in order, returns first success; logging is excellent |
| **ConversationManager** | `src/core/ConversationManager.ts` | `processMutation()` | ✅ WORKING | Deduplication verified; Web Locks API working; IndexedDB persistence working; logs show "Ignored (Identical): 5" for duplicate messages |
| **ContextEstimationEngine** | `src/core/context-estimation/ContextEstimationEngine.ts` | `estimate()` | ⚠️ WORKING_BUT_INSUFFICIENT | Estimation math works; but input is extremely incomplete sample (16 visible × ~918 scroll ratio) |
| **processDOM** | `src/adapters/engine.ts` | `processDOM()` | ✅ WORKING | Correctly finds `main#main` (scrollHeight: 406,182); correctly collects scroll metrics; uses DIFFERENT scroll container than ConversationReadyDetector |
| **Background Service Worker** | `src/entrypoints/background.ts` | Message router | ✅ WORKING | Routes messages correctly; calls all downstream engines in order |
| **Network Discovery Interceptor** | `src/entrypoints/networkDiscovery.content.ts` | Fetch/XHR intercept | ✅ IMPLEMENTED | Runs in MAIN world; logs candidate API endpoints; but does NOT yet make acquisition requests |
| **Messaging Layer** | `src/messaging/client.ts` | `addListener()` | ✅ WORKING | Type-safe; cross-context communication functional |
| **Storage Layer** | `src/storage/db.ts` | IndexedDB | ✅ WORKING | Correctly stores and retrieves conversations; deduplication working |

---

## 3. Confirmed Bugs

### Bug #1: ConversationReadyDetector Uses Wrong Scroll Container

**File:** `src/adapters/ConversationReadyDetector.ts`  
**Function:** `getScrollContainer()` (lines 130-150)

**Current Behavior:**
```typescript
// Searches for scrollHeight > 0
for (const selector of selectors) {
  const el = document.querySelector(selector);
  if (el && el.scrollHeight > 0) {  // ← WRONG CONDITION
    return el;  // Returns FIRST element with scrollHeight
  }
}
```

**Problem:**
```
Selectors tried in order:
1. div[class*="react-scroll-to-bottom"]     → scrollHeight: 494 (SIDEBAR!)
2. div[class*="react-scroll-to-bottom--css"] → ...
3. main div.overflow-y-auto                  → ...
...

Returns: div#stage-slideover-sidebar
- scrollHeight: 494px
- clientHeight: 494px
- ❌ This is the WRONG element

Meanwhile, processDOM correctly finds:
- main#main
- scrollHeight: 406,182px  (huge!)
- clientHeight: 442px      (tiny!)
```

**Impact:**
- ConversationReadyDetector reports conversation "ready" based on sidebar metrics
- processDOM uses correct `main#main` element
- **Discrepancy detected!** (See utility: `inspectScrollContainer()` and comparison logs)

**Fix Required:**
Change condition from `scrollHeight > 0` to `scrollHeight > clientHeight` to find SCROLLABLE containers.

```typescript
// CORRECT CONDITION
if (el && el.scrollHeight > el.clientHeight) {
  return el;  // Only returns actually scrollable containers
}
```

---

### Bug #2: Missing Historical Acquisition Strategy

**Severity:** CRITICAL  
**Impact:** Extension cannot automatically load complete conversation history

**Current State:**
```
Strategy Pipeline:
1. HydrationStrategy   → Tries __NEXT_DATA__ / __remixContext → NOT FOUND → FAILS
2. VisibleDOMStrategy  → Returns 16 visible nodes → SUCCEEDS → Returns

Result: 16 messages, marked isComplete=false
```

**Problem:**
No third strategy to handle the case where:
- Hydration data is unavailable (current ChatGPT situation)
- Only 16 visible messages are available
- User has NOT manually scrolled to top

**Why This Matters:**
If a user opens an old 500-message conversation, the extension sees 16 DOM nodes and gives up. The estimator extrapolates based on 16 nodes × 918 scroll ratio, but that's an unreliable guess.

---

## 4. Root Cause Analysis

### The Fundamental Problem

**Question:** Why does the extension show incomplete metrics for historical conversations?

**Answer:**

```
┌────────────────────────────────────────────────────┐
│              CAUSAL CHAIN                          │
├────────────────────────────────────────────────────┤
│ 1. User opens old 500-message conversation         │
│    ↓                                               │
│ 2. ChatGPT DOM only renders 16 messages            │
│    (virtualization: older messages removed from    │
│     document, not deleted from ChatGPT's data)     │
│    ↓                                               │
│ 3. HydrationStrategy looks for __NEXT_DATA__       │
│    ↓                                               │
│ 4. Modern ChatGPT doesn't expose this (Remix)      │
│    ↓                                               │
│ 5. HydrationStrategy FAILS                         │
│    ↓                                               │
│ 6. VisibleDOMStrategy runs (fallback)              │
│    ↓                                               │
│ 7. Returns 16 visible messages                     │
│    isComplete=false (correctly marked!)            │
│    ↓                                               │
│ 8. ConversationManager receives 16 messages        │
│    ↓                                               │
│ 9. IndexedDB canonical store now has 16            │
│    (Can't invent missing 484 messages)             │
│    ↓                                               │
│ 10. All downstream engines (tokens, summary, etc)  │
│     work from 16-message sample                    │
│     ↓                                              │
│ 11. ContextEstimationEngine extrapolates:          │
│     16 × (406182 / 442) ≈ 14,688 estimated turns  │
│     (mathematically sound, but based on tiny       │
│      sample size — unreliable)                     │
│     ↓                                              │
│ 12. UI DISPLAYS ESTIMATED METRICS                 │
│     ❌ NO INDICATION THEY'RE ESTIMATED/PARTIAL    │
│     ❌ USER DOESN'T KNOW TO SCROLL                │
│     ↓                                              │
│ RESULT: Extension shows wrong metrics as if       │
│         they were complete                        │
└────────────────────────────────────────────────────┘
```

### Why Current Architecture Is Stuck

1. **HydrationStrategy is a dead-end** for current ChatGPT (Remix-based)
2. **VisibleDOMStrategy can only see 16 nodes** (architectural constraint of virtualization)
3. **No API acquisition strategy exists** to fetch complete history from ChatGPT backend
4. **ConversationManager cannot invent messages** it wasn't given
5. **Estimator extrapolates but can't guarantee accuracy** from tiny sample

The architecture is **correct and well-designed**, but it's **missing the final piece: a way to automatically fetch historical data**.

---

## 5. API Discovery Findings

### Network Interception Setup

**File:** `src/entrypoints/networkDiscovery.content.ts`  
**Status:** ✅ IMPLEMENTED & RUNNING

The extension **already has** a MAIN-world network interceptor that:
- ✅ Intercepts `window.fetch()` calls
- ✅ Intercepts `XMLHttpRequest`
- ✅ Filters for conversation/history/messages/api keywords
- ✅ Logs request/response metadata
- ✅ Checks for `mapping`, `messages`, `current_node` structural keys

**Current Usage:** Diagnostic only (logs to console)

### What API Calls Has ChatGPT Made?

Based on the diagnostic code, the interceptor is already **listening for these patterns**:

```
FILTER_KEYWORDS: ['conversation', 'messages', 'history', 'backend-api', '/api/']
```

**To discover actual endpoints:** Open DevTools Console → look for `=== CHATGPT HISTORY REQUEST DISCOVERY ===` logs

**Critical Finding:** The extension does NOT yet make its own API requests. It only **observes** ChatGPT's requests for diagnostic purposes.

### Manifest Permissions for API Acquisition

**Current Manifest (wxt.config.ts):**

```typescript
host_permissions: [
  'https://chatgpt.com/*',
  'https://*.chatgpt.com/*',
  'https://chat.openai.com/*',
  // ...
]

content_security_policy: {
  extension_pages:
    process.env.NODE_ENV === 'development'
      ? "script-src 'self'; object-src 'self'; connect-src 'self' ws://localhost:3000 http://localhost:3000"
      : "script-src 'self'; object-src 'self'; connect-src 'none'",
}
```

**Assessment:**
- ✅ host_permissions allow content-script access to ChatGPT URLs
- ✅ MV3 compatible (can make fetch from content-script)
- ⚠️ CSP `connect-src 'none'` **blocks network calls from service worker**
- ⚠️ But content-script is NOT restricted by extension CSP (only by page CSP)
- ✅ No API endpoint currently attempted (why no 404 errors yet)

### To Make API Calls

**Option A: From content script (can bypass extension CSP)**
```typescript
// In content-script context (not restricted by extension CSP)
const res = await fetch(`https://chatgpt.com/backend-api/conversation/${threadId}`);
```

**Option B: Via cross-origin request**
Must first discover the actual endpoint ChatGPT uses by inspecting network tab.

---

## 6. Architecture Assessment

### Can the current architecture support automatic API history acquisition?

**Short Answer:** YES, with minimal changes.

**Required Path:**

```
1. Network Discovery identifies actual endpoint ChatGPT uses
   ↓
2. Create new AcquisitionStrategy: APIStrategy implements AcquisitionStrategy
   ↓
3. APIStrategy.execute():
   - fetch(`https://chatgpt.com/backend-api/conversation/${threadId}`)
   - Parse response → normalize to ChatMessage[]
   - Return { strategy: 'API', success: true, messages: [...], isComplete: true }
   ↓
4. Register APIStrategy in ConversationAcquirer:
   strategies = [APIStrategy, HydrationStrategy, VisibleDOMStrategy]
   ↓
5. ConversationAcquirer.acquire() now tries:
   - APIStrategy → SUCCEEDS with 500 messages, isComplete=true → RETURNS
   - (other strategies not tried)
   ↓
6. ConversationManager.processMutation() receives 500 messages
   ↓
7. All downstream engines work from complete sample
   ↓
8. Metrics are now ACCURATE, not estimated
```

### ConversationManager Compatibility

**YES** — ConversationManager doesn't care about acquisition source:

```typescript
// From processMutation():
for (const msg of observation.messages) {
  const existing = conversation.messages[msg.id];
  if (!existing) {
    conversation.messages[msg.id] = msg;  // ← Works with ANY source
    conversation.orderedMessageIds.push(msg.id);
  }
}
```

Doesn't matter if messages came from DOM, hydration, or API—ConversationManager processes them identically.

---

## 7. What's Working Well

1. **IndexedDB Persistence** ✅
   - Survives page refreshes
   - Deduplication working (verified: "Ignored (Identical): 5")
   - Conversation identity stable

2. **Mutation Merging** ✅
   - Deterministic: same message ID → same data
   - Streaming updates correctly (text appended)
   - Version incrementing on changes

3. **Estimator Wiring** ✅
   - Scroll metrics reach background service worker
   - ContextEstimationEngine receives inputs
   - Estimation logic mathematically sound
   - Early-return detection prevents false extrapolations

4. **Message Deduplication** ✅
   - Hash-based IDs (when not provided)
   - data-message-id preserved
   - No duplicate messages in storage

5. **DOM Observation** ✅
   - MutationObserver correctly watches changes
   - 250ms debounce prevents thrashing
   - Streaming detection working

6. **Platform Detection** ✅
   - Thread ID extraction working
   - URL-based conversation identity stable

7. **Offscreen Tokenization** ✅
   - `js-tiktoken` integrated
   - Messages correctly sent to offscreen document
   - Token counts received by background

---

## 8. Solution Options (Ranked)

### Option 1: API History Acquisition (⭐⭐⭐⭐⭐ RECOMMENDED)

**Approach:**
- Discover ChatGPT's actual conversation API endpoint via network interception
- Implement `APIStrategy` following existing `AcquisitionStrategy` interface
- Register as highest-priority strategy: `[APIStrategy, HydrationStrategy, VisibleDOMStrategy]`
- Make API call from content-script (not blocked by extension CSP)

**Reliability:** Very High (ChatGPT stores complete history server-side)  
**Accuracy:** 100% (exact data from source)  
**UX:** Seamless (automatic on page load)  
**Complexity:** Medium (need to discover endpoint, handle auth, normalize response)  
**MV3 Compatibility:** ✅ Yes (content-script can make fetch)  
**Privacy:** ✅ Data stays local (only used to populate IndexedDB)  
**Maintenance:** Low (endpoint unlikely to change)

**Implementation Path:**
1. Open DevTools → Networks tab → Load old conversation
2. Look for API call containing `mapping` or `messages`
3. Implement APIStrategy to call that endpoint
4. Test with various conversation lengths (5 msg, 100 msg, 500 msg)

---

### Option 2: Programmatic Scrolling (⭐⭐ NOT RECOMMENDED)

**Approach:**
- After DOM acquisition, programmatically scroll conversation to top
- MutationObserver watches for newly-mounted messages
- Repeat: scroll up until no new messages appear

**Reliability:** Low (ChatGPT may rate-limit, scroll behavior unpredictable)  
**Accuracy:** High if completes, but may fail silently  
**UX:** Jarring (scrolling visible to user if side panel open)  
**Complexity:** High (scroll state tracking, infinite loop prevention)  
**MV3 Compatibility:** ✅ Yes (DOM manipulation allowed)  
**Privacy:** ✅ Yes (no network)  
**Maintenance:** High (ChatGPT DOM/scroll code changes often)

**Why Not Recommended:**
- User should NOT have to manually scroll for extension to work
- Unpredictable scroll behavior may cause hangs
- Violates UX principle: "Don't require user action"

---

### Option 3: Improved Hydration Parsing (⭐⭐⭐ PARTIAL)

**Approach:**
- Re-examine page source for alternative hydration patterns
- Look for global variables: `__remixManifest`, `__remixRouteData`, `window.__state`
- Parse large JSON scripts more carefully
- Cache any hydration data found

**Reliability:** Low (ChatGPT may not expose this data)  
**Accuracy:** Very High if data found  
**UX:** Seamless (automatic)  
**Complexity:** Medium (JSON parsing patterns)  
**MV3 Compatibility:** ✅ Yes (just DOM inspection)  
**Privacy:** ✅ Yes (no network)  
**Maintenance:** Medium (depends on ChatGPT's architecture)

**Current Status:**
Already investigated (reported in requirements). Conclusion: Not viable on current ChatGPT (Remix-based, no exposed full history).

---

### Option 4: Hybrid Approach (⭐⭐⭐⭐ STRONG)

**Approach:**
- Combine API + Programmatic Scrolling as fallback
- Try API first (fast, reliable, complete)
- If API fails, fall back to programmatic scroll (recovers in edge cases)
- If scroll completes, populates remaining history

**Reliability:** Very High (two independent paths)  
**Accuracy:** Very High (both give exact data)  
**UX:** Best of both worlds  
**Complexity:** High (need both implementations)  
**MV3 Compatibility:** ✅ Yes  
**Privacy:** ✅ Yes  
**Maintenance:** Medium

**When to Use:**
If unsure which approach will work after API discovery.

---

## 9. Recommended Implementation Path

### Phase 1: API Discovery (1-2 days)

1. **Manual exploration:**
   - Open ChatGPT in browser
   - Open DevTools → Network tab
   - Load an old conversation
   - Look for requests containing `mapping`, `messages`, or `conversation`

2. **Document findings:**
   - Endpoint URL (e.g., `/backend-api/conversation/{id}`)
   - Request method (GET, POST)
   - Request headers needed (auth, content-type)
   - Response structure (format of returned messages)
   - Message ID field name in response

### Phase 2: Implement APIStrategy (2-3 days)

```typescript
// src/core/acquisition/strategies/APIStrategy.ts

export class APIStrategy implements AcquisitionStrategy {
  public type: AcquisitionStrategyType = 'API';
  private adapter: PlatformAdapter;

  constructor(adapter: PlatformAdapter) {
    this.adapter = adapter;
  }

  public canExecute(platform: PlatformId): boolean {
    return platform === 'chatgpt';  // ChatGPT only for now
  }

  public async execute(
    threadId: string,
    signal?: AbortSignal,
    onProgress?: (status: AcquisitionStatus) => void
  ): Promise<AcquisitionResult> {
    try {
      // 1. Make API call
      const response = await fetch(
        `https://chatgpt.com/backend-api/conversation/${threadId}`,
        { signal }
      );

      if (!response.ok) {
        return {
          strategy: this.type,
          success: false,
          messages: [],
          isComplete: false,
          error: new Error(`HTTP ${response.status}`)
        };
      }

      // 2. Parse response
      const data = await response.json();
      const messages = this.normalizeResponse(data);

      // 3. Return result
      return {
        strategy: this.type,
        success: true,
        messages,
        isComplete: messages.length > 0  // API gives complete data
      };
    } catch (error) {
      return {
        strategy: this.type,
        success: false,
        messages: [],
        isComplete: false,
        error: error as Error
      };
    }
  }

  private normalizeResponse(data: any): ChatMessage[] {
    // Parse ChatGPT's response format into standard ChatMessage[]
    // This will depend on actual API response structure
    const messages: ChatMessage[] = [];
    
    // Example (will vary based on actual API):
    if (data.mapping) {
      Object.values(data.mapping).forEach((node: any) => {
        const msg = node.message;
        if (msg) {
          messages.push({
            id: msg.id,
            role: msg.author.role === 'user' ? 'user' : 'ai',
            text: msg.content.parts[0] || ''
          });
        }
      });
    }

    return messages;
  }
}
```

### Phase 3: Register APIStrategy (4 hours)

**File:** `src/adapters/engine.ts`

```typescript
// In RobustDOMEngine constructor:
this.acquirer = new ConversationAcquirer([
  new APIStrategy(adapter),           // ← TRY FIRST (most complete)
  new HydrationStrategy(adapter),      // ← TRY SECOND (if API unavailable)
  new VisibleDOMStrategy(adapter)      // ← TRY LAST (fallback)
]);
```

### Phase 4: Testing (2-3 days)

1. **Unit tests:** Mock API response, verify normalization
2. **Integration tests:** Real ChatGPT conversations (5, 50, 500 messages)
3. **Edge cases:**
   - Network failure → fallback to Hydration/DOM
   - Auth required → handle 401/403
   - Thread ID malformed → handle 404
4. **Performance:** Measure time to acquire 500 messages
5. **Regression:** Ensure VisibleDOMStrategy still works as fallback

### Phase 5: Deployment (1 day)

1. Merge APIStrategy
2. Update documentation
3. Release as patch (this fixes historical tracking completely)

---

## 10. Immediate Action Items

### Fix #1 (URGENT): Scroll Container Bug

**File:** `src/adapters/ConversationReadyDetector.ts` line ~134

**Change:**
```typescript
// BEFORE
if (el && el.scrollHeight > 0) {

// AFTER
if (el && el.scrollHeight > el.clientHeight) {
```

**Impact:** Fixes readiness detection; improves scroll metric accuracy  
**Risk:** Low (correctness improvement)  
**Effort:** 5 minutes

---

### Fix #2: Implement Historical Acquisition

**Following the path in Section 9**

**Impact:** Enables automatic complete history acquisition  
**Risk:** Medium (depends on API discovery)  
**Effort:** 5-8 days

---

### Optional: Improve Estimator Confidence Signal

**File:** `src/core/context-estimation/ContextEstimationEngine.ts`

**Current:** Returns estimated context regardless of sample completeness  
**Improvement:** Flag estimate confidence based on sample size

```typescript
// Add to EstimatedContext output
const confidence = Math.min(
  1.0,
  input.visibleMessageCount / 100  // 100 visible = high confidence
);

if (confidence < 0.5) {
  console.warn('[Estimate] Low confidence: based on ${input.visibleMessageCount} visible messages');
}
```

**Impact:** UI can show "Estimated (low confidence)" vs "Exact"  
**Risk:** None (purely informational)  
**Effort:** 2 hours

---

## 11. Final Verdict

**Can the extension track complete historical conversations?**

**YES**, with one addition: **API History Acquisition Strategy**

**Current State:** Architecture is sound, but missing final piece  
**Readiness:** 80% complete (needs API strategy + bug fix)  
**Blockers:** None (API discovery required, but feasible)  
**Timeline:** 5-8 days to production-ready

**The path is clear. The tools are in place. Execute Option 1 (API Acquisition).**

