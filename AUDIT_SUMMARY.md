# Deep Audit Summary — AI Context Tracker

**Status:** Architecture is correct. **Missing: automatic historical data acquisition.**

---

## The Problem in One Picture

```
User opens old 500-message conversation
                ↓
ChatGPT renders 16 visible (virtualized) messages
                ↓
Extension has 3 strategies to get complete history:
  1. Hydration API  → NOT FOUND on current ChatGPT ✗
  2. Programmatic scroll → NOT IMPLEMENTED ✗
  3. Network API call → NOT DISCOVERED YET ✗
                ↓
Extension gives up after strategy #1 fails
                ↓
Only 16 messages reach IndexedDB
                ↓
Estimator extrapolates: 16 × 918 scroll_ratio ≈ ~14,688 estimated
                ↓
UI shows incomplete metrics as if they were complete ✗
                ↓
User doesn't know conversation isn't fully tracked
```

---

## What's Working ✅

- Conversation persistence (IndexedDB)
- Deduplication (verified working)
- Estimator math (sound, but inputs incomplete)
- Network interception (already implemented for discovery)
- Message merging (deterministic, correct)
- All downstream engines (token, summary, degradation)

## What's Missing ❌

1. **Automatic API history acquisition** (CRITICAL)
   - Network discovery interceptor exists but doesn't make API calls
   - No APIStrategy to fetch complete conversation from ChatGPT backend

2. **Bug in readiness detector** (MEDIUM)
   - ConversationReadyDetector selects wrong scroll container
   - Returns sidebar (scrollHeight 494) instead of main (scrollHeight 406k)
   - Fix: Change `scrollHeight > 0` to `scrollHeight > clientHeight`

---

## The Solution

### Short-term (Fix #1): Scroll Container Bug
**File:** `src/adapters/ConversationReadyDetector.ts:134`  
**Change:** `if (el && el.scrollHeight > 0)` → `if (el && el.scrollHeight > el.clientHeight)`  
**Effort:** 5 minutes  
**Impact:** Correctness improvement

### Long-term (Fix #2): Implement Historical Acquisition
**Approach:** Discover ChatGPT's API endpoint + implement APIStrategy  
**Effort:** 5-8 days  
**Impact:** Extension can now automatically fetch complete history  
**Steps:**
1. Open DevTools Network tab → load old ChatGPT conversation
2. Find API request with `mapping` or `messages` in response
3. Create `APIStrategy` class implementing `AcquisitionStrategy` interface
4. Register in ConversationAcquirer pipeline as first strategy
5. ConversationAcquirer now tries: `[APIStrategy, HydrationStrategy, VisibleDOMStrategy]`

---

## Why This Works

The architecture is already designed to accept multiple acquisition strategies:

```typescript
this.acquirer = new ConversationAcquirer([
  new HydrationStrategy(adapter),      // Try first
  new VisibleDOMStrategy(adapter)       // Fallback
]);
```

You just need to insert APIStrategy as the first option:

```typescript
this.acquirer = new ConversationAcquirer([
  new APIStrategy(adapter),             // ← Try first (complete history!)
  new HydrationStrategy(adapter),
  new VisibleDOMStrategy(adapter)
]);
```

ConversationManager doesn't care where messages came from—it processes them identically.

---

## Architecture Trace

```
ChatGPT DOM (16 visible)
  ↓
RobustDOMEngine.processDOM()
  ↓
ConversationAcquirer.acquire([APIStrategy, HydrationStrategy, VisibleDOMStrategy])
  ↓
APIStrategy.execute() → SUCCEEDS (500 messages)
  ↓
DOMObservation { messages: 500 }
  ↓
ConversationManager.processMutation()
  ↓
IndexedDB: 500 messages stored
  ↓
All downstream engines work from complete sample
  ↓
UI: Accurate metrics displayed
```

---

## Key Files

| Component | File | Status |
|---|---|---|
| Network Interceptor | `src/entrypoints/networkDiscovery.content.ts` | ✅ Ready (logs API calls) |
| Acquisition Pipeline | `src/core/acquisition/ConversationAcquirer.ts` | ✅ Ready to accept new strategy |
| Conversation Storage | `src/core/ConversationManager.ts` | ✅ Ready (no changes needed) |
| Readiness Gate | `src/adapters/ConversationReadyDetector.ts` | 🔴 Bug: wrong scroll container |
| DOM Extraction | `src/adapters/engine.ts:processDOM()` | ✅ Working correctly |

---

## Next Steps

1. **Do not change ConversationManager or estimators** (they work)
2. **Fix readiness detector** (5 min)
3. **Discover ChatGPT API endpoint** (1-2 days)
4. **Implement APIStrategy** (2-3 days)
5. **Test with real conversations** (2-3 days)
6. **Deploy**

---

## Evidence-Based Findings

**Verified Working:**
- ConversationManager deduplication: "Canonical count after merge: 16, Ignored (Identical): 5"
- Scroll metrics reaching background: Debug logs show scrollHeight 406182 received
- ContextEstimationEngine wiring: Logs show estimation executed
- Network interception: Logs show candidate endpoints being detected

**Verified Broken:**
- Hydration data: __NEXT_DATA__ and __remixContext not found
- Readiness detector scroll container: sidebar (494px) vs main (406k px) — different elements!
- Complete history acquisition: No strategy succeeds beyond visible 16

---

**Complete audit in:** `DEEP_AUDIT_REPORT.md`
