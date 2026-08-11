# AI Context Tracker - Project Analysis Report

**Date:** August 11, 2026  
**Status:** Alpha Prototype (Not Production-Ready)  
**Verdict:** Project has significant gaps between documentation and implementation.

---

## Executive Summary

The AI Context Tracker browser extension is in an **inconsistent state**. The documentation claims completion through Phase 11 (Profiling & Optimization), but the codebase reveals:

- ✅ **Build succeeds** (TypeScript compiles cleanly)
- ❌ **Tests fail** (Configuration issue, no comprehensive test coverage)
- ❌ **Linting fails** (37 errors + 23 warnings, mostly `any` types and unused imports)
- ❌ **Architecture promises not met** (CSP not enforced, no offscreen worker, tests missing)
- ⚠️ **Documentation-Code Gap** (TODO.md claims pre-implementation, PROJECT.md claims completion)

---

## 🔴 Critical Issues

### 1. **Linting Failures (37 Errors, 23 Warnings)**

**Impact:** Code quality debt; not production-ready.

#### Main Error Categories:

| Issue Type | Count | Files | Severity |
|---|---|---|---|
| `@typescript-eslint/no-explicit-any` | 6 errors | 5 files | 🔴 High |
| `@typescript-eslint/no-unused-vars` | ~12 warnings | Multiple | 🟡 Medium |
| `@typescript-eslint/no-require-imports` | 2 errors | `verify.js` | 🔴 High |

#### Files with Critical Errors:

```
src/core/context-estimation/types.ts:5          - any type
src/core/models.ts:35                             - any type
src/entrypoints/offscreen/main.ts:14,21          - 3x any types
src/entrypoints/popup/App.tsx:18                 - any type
src/messaging/client.ts:77-78                    - 2x any types
verify.js:1-2                                    - require() not allowed
```

**Why It Matters:**
- `any` types bypass TypeScript's type safety guarantee (core project promise)
- Unused imports bloat bundle size (contradicts 15KB budget promise)
- Increases maintenance burden and bug surface

---

### 2. **Tests Don't Run (Configuration Issue)**

**Impact:** No way to validate implementation; regressions undetected.

#### Problem:
```bash
npm run test
# Error: wxt/testing is ESM-only but loaded through CJS
```

The `vitest.config.mts` references `WxtVitest()` plugin from `wxt/testing`, which is ESM-only. Vitest is trying to load it as CommonJS.

#### Test Coverage Status:
- **3 test files exist** (dummy, ContextEstimationEngine, architecture spec)
- **0 tests for adapters** (ChatGPT, Claude, Gemini DOM scrapers)
- **0 tests for messaging layer** (type-safe protocol)
- **0 tests for storage layer** (3-tier abstraction)
- **0 tests for background service worker** (central orchestration)
- **0 tests for UI components** (Preact widgets)

#### Tests That Exist:
1. `dummy.test.ts` - Trivial (1+1=2)
2. `ContextEstimationEngine.spec.ts` - 8 passing tests (only estimators, not end-to-end)
3. `architecture.spec.ts` - E2E check (exists but never runs)

---

### 3. **TypeScript Strict Mode Gap**

**Issue:** 6 `any` types in critical paths.

```typescript
// src/core/context-estimation/types.ts:5
any  // Should specify exact type

// src/entrypoints/offscreen/main.ts:14-21
listener.handleMessage(message as any, sender as any);
```

**Impact:** Defeats strict TypeScript promise; runtime errors possible.

---

### 4. **CSP Not Enforced**

**Promise (PROJECT.md):** `connect-src 'none'` for zero-network guarantee  
**Reality:** Checked manifest.json → **CSP is not in manifest**

```json
// .output/chrome-mv3/manifest.json - NO CSP found
{
  "manifest_version": 3,
  // ... no content_security_policy
}
```

**Why It Matters:**
- Privacy guarantee is unverifiable
- Malicious package could exfiltrate chat context
- Does not comply with documented "zero-network policy"

---

### 5. **Offscreen Tokenization Not Implemented**

**Promise (PROJECT.md):** Tokenize async in offscreen worker  
**Reality:** Tokenization happens synchronously in main thread

```typescript
// src/entrypoints/offscreen/main.ts - exists but is a shell
// No actual tokenization logic, just message forwarding
```

**Impact:**
- ❌ Main thread blocks during tokenization (contradicts "stutter-free" promise)
- ❌ No performance benefit from worker offloading

---

### 6. **Unused Imports Bloat Bundle**

**Examples:**
```typescript
// src/entrypoints/content/widget/Widget.tsx:6
import { ChevronDown, MousePointer2 } from 'lucide-preact';
// ChevronDown, MousePointer2 never used → tree-shake fails
```

**Impact:** Every unused icon/component bloats the content script (contradicts 15KB budget).

---

## 🟡 Medium-Severity Issues

### 7. **Incomplete Adapter Platform Support**

**Claimed (PROJECT.md):** ChatGPT, Claude, Gemini, Grok, Perplexity adapters  
**Implemented:** ChatGPT, Claude, Gemini (basic)  
**Reality:**
- Grok adapter exists but minimal
- Perplexity adapter exists but minimal
- **No E2E tests** to validate detection or scraping

### 8. **Storage Architecture Incomplete**

**Promised:** 3-tier storage (session/local/IndexedDB)  
**Actual:**
- Single `local:appState` store via WXT
- No separation of concern for session vs. persistent data
- No IndexedDB integration tested

### 9. **Messaging Layer Simplified**

**Promised:** Discriminated union messages with type safety  
**Actual:** Simplified message handlers, type safety compromised with `any`

```typescript
// src/messaging/client.ts:77-78
payload: message as any,
sender: sender as any
```

---

## 📊 What's Actually Working

| Feature | Status | Notes |
|---|---|---|
| TypeScript strict compilation | ✅ Pass | No type errors |
| Build pipeline (WXT → Chrome MV3) | ✅ Pass | Output in `.output/chrome-mv3` |
| React/Preact UI structure | ✅ Pass | Popup, side panel, options exist |
| Platform detection logic | ✅ Pass | Detects ChatGPT, Claude, Gemini |
| DOM observation (MutationObserver) | ✅ Pass | Watches for new messages |
| Token estimation (math) | ✅ Pass | Estimators work (tests pass when run manually) |
| Zustand state store | ✅ Pass | Connected to UI components |
| Manifest V3 structure | ✅ Pass | Valid MV3 manifest generated |

---

## 📋 Documentation Inconsistencies

### Problem 1: TODO.md vs. PROJECT.md Mismatch

**TODO.md says:**
```markdown
## 🔴 Blocked — Awaiting Decisions
- [ ] **Founder approval of Product Specification v1.0**
- [ ] Phase 1: Foundation (After Approval)
- [ ] Phase 2: Platform Adapters
- [ ] Phase 3: Token Estimation Engine
```
→ Claims project is **pre-implementation**

**PROJECT.md says:**
```markdown
## Completed Features
- [x] Phase 5: Platform Adapters Implementation
- [x] Phase 6: Summary Engine Implementation
- [x] Phase 7: Transfer Summary Engine & UI
- [x] Phase 8: Alert Engine (Smart Context Switch)
...
- [x] Phase 11: Profiling & Optimization
```
→ Claims all phases **complete through Phase 11**

**Reality:** Middle ground — many features exist but are incomplete/untested.

### Problem 2: Verification Report vs. Current State

The `PROJECT_VERIFICATION_REPORT.md` (dated July 15, 2026) correctly identifies:
- ❌ Tests fail (vitest config issue)
- ❌ Linting fails (47 findings)
- ❌ No test files for most subsystems
- ❌ CSP not enforced

Yet `PROJECT.md` still claims "Phase 11: Profiling & Optimization Complete."

---

## 🛠️ How to Fix (Priority Order)

### Priority 1: Enable Tests (Unblocks CI)

**Issue:** Vitest config fails
**Fix:**
1. Migrate `vitest.config.mts` to use `defineConfig` without `WxtVitest()` plugin
2. Use standard Vitest setup for happy-dom
3. Write comprehensive tests for adapters, messaging, storage, background worker

**Effort:** 2-3 days  
**Payoff:** Enables regression detection, validates 11 "completed" phases

---

### Priority 2: Fix Linting (Code Quality)

**Issue:** 37 errors prevent merge
**Fix:**
1. Replace all `any` types with specific types (6 errors)
2. Remove unused imports (12 warnings) → auto-fix with `--fix`
3. Fix `verify.js` to use ES imports instead of `require()`

**Effort:** 4-6 hours  
**Payoff:** Code quality baseline; CI/CD gate

---

### Priority 3: Enforce CSP in Manifest

**Issue:** Privacy guarantee not verifiable
**Fix:**
1. Add `content_security_policy` to `wxt.config.ts`
2. Set `connect-src 'none'` to prevent network access
3. Validate in E2E tests that no network requests happen

**Effort:** 2 hours  
**Payoff:** Keeps privacy promise; builds user trust

---

### Priority 4: Implement Offscreen Tokenization

**Issue:** Tokenization blocks main thread
**Fix:**
1. Move `js-tiktoken` logic into offscreen/main.ts
2. Wrap tokenization calls in async message passing
3. Remove synchronous tokenization from background worker

**Effort:** 1-2 days  
**Payoff:** Main thread stays responsive; matches performance promise

---

### Priority 5: Reconcile Documentation

**Issue:** TODO.md, PROJECT.md, and code are out of sync
**Fix:**
1. Update TODO.md to reflect actual implementation status
2. Remove false "Complete" claims from PROJECT.md Phase list
3. Create a single source of truth (GitHub Project or wiki)

**Effort:** 4 hours  
**Payoff:** Team clarity; prevents further drift

---

## 🎯 Recommendations

### Immediate (This Week)

1. **Fix vitest config** → run tests → catch real bugs
2. **Run `npm run lint -- --fix`** → clean up low-hanging fruit
3. **Add 6 missing type annotations** → full strict mode

### Short-term (This Sprint)

1. Write adapter unit tests (ChatGPT, Claude, Gemini)
2. Write storage layer tests (3-tier abstraction)
3. Implement missing offscreen tokenization
4. Add CSP to manifest with validation tests

### Before Release

1. Run full Playwright E2E suite against real ChatGPT/Claude/Gemini
2. Bundle analysis → ensure content script < 15KB
3. Privacy audit → verify zero-network policy (Charles proxy inspection)
4. Manual QA across Chrome versions

---

## Checklist: What Needs to Happen

- [ ] Fix vitest config → tests pass
- [ ] Fix 37 lint errors → pass linting gate
- [ ] Write 50+ comprehensive unit tests
- [ ] Add CSP to manifest
- [ ] Implement offscreen tokenization
- [ ] Reconcile documentation (TODO.md/PROJECT.md)
- [ ] Run bundle analysis → verify size budgets
- [ ] Run E2E tests on real AI platforms
- [ ] Privacy audit (zero-network verification)
- [ ] Manual QA on target platforms

---

## Summary

**The project is an alpha prototype, not a production MVP.** Documentation overstates completion. Core architectural promises (CSP, offscreen tokenization, strict TypeScript, zero-network) are documented but not enforced. Tests don't run, linting fails, and most subsystems lack test coverage.

**Next step:** Fix vitest config to unblock testing, then systematically validate the 11 "completed" phases with comprehensive tests.

