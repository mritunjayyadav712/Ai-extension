# AI Context Tracker 🧠

A privacy-first, event-driven browser extension (Manifest V3) built with **WXT** and **Preact** to monitor, estimate, and analyze LLM chat context limits (tokens and turns) in real-time.

---

## Key Features

- **Multi-Platform Adapters**: Scrapes and handles chat threads on major AI platforms (ChatGPT, Claude, Gemini, Perplexity, Grok).
- **Stateless Telemetry & Mutation Engine**: Watches DOM changes in real-time to detect new user prompts, assistant responses, and streaming activities.
- **Offscreen Tokenization**: Tokenizes chat history asynchronously using `js-tiktoken` (`o200k_base` model) offloaded to an Offscreen document for stutter-free main-thread performance.
- **Context Estimation Engine**: Estimates turns and token count on partially virtualized DOM containers using Simple, Scrollbar, and Hybrid (weighted average of scroll ratio and visible message density) estimators.
- **Local History Acquisition**: Reconstructs conversations by merging historical hydration data with real-time DOM updates.
- **Zero-Network Policy (Privacy-First)**: Enforces strict Content Security Policy (`connect-src 'none'`) ensuring all tokenization, context evaluations, and summaries remain 100% local.

---

## Folder Structure

```text
browser-extension/
├── src/
│   ├── entrypoints/        # WXT entrypoints (background, content, sidepanel, popup, options, offscreen)
│   ├── adapters/           # Per-platform DOM scraping adapters
│   ├── core/               # Engine core (Acquisition, Context Estimation, Models, Manager)
│   │   └── context-estimation/ # Subsystem to estimate context limits on virtualized DOMs
│   ├── engines/            # Logic layers (summary, degradation evaluation)
│   ├── storage/            # 3-tier browser storage abstraction (runtime, settings, snapshots)
│   ├── messaging/          # Cross-context type-safe chrome messaging
│   ├── ui/                 # Injected Preact widgets, side panels, and options page
│   └── shared/             # Shared constants, types, and logging utilities
├── public/                 # Ext icons and static assets
├── tsconfig.json           # Strict TypeScript configuration
├── vitest.config.mts       # Unit test configurations
└── wxt.config.ts           # WXT framework configurations
```

---

## Technology Stack

- **Framework**: [WXT](https://wxt.dev/) (Vite-based Next-Gen Web Extension Framework)
- **UI Render**: [Preact](https://preactjs.com/) (Ultra-lightweight React-like virtual DOM engine)
- **Tokenizer**: `js-tiktoken` (pure-JS tiktoken implementation)
- **State Management**: [Zustand](https://github.com/pmndrs/zustand)
- **Testing**: [Vitest](https://vitest.dev/) for unit testing, [Playwright](https://playwright.dev/) for E2E validation

---

## Subsystems

### 1. Platform Adapters & Telemetry
Injected content scripts detect the platform (ChatGPT, Claude, etc.) and start a `RobustDOMEngine` observer that watches DOM mutations and emits `DOMObservation` signals when changes are detected.

### 2. Context Estimation Engine
When AI platforms virtualize long threads, the DOM only contains the most recent messages. The `ContextEstimationEngine` steps in to estimate the total turns and token usage by using pluggable estimators:
- **SimpleEstimator**: Multiplies turns/tokens by the ratio of `scrollHeight / viewportHeight`.
- **ScrollbarEstimator**: Adjusts context calculations strictly using the scroll container's metrics.
- **HybridEstimator**: Integrates scroll ratios, viewport ratios, and visible message density to approximate total token usage safely.

---

## Development Setup

### Prerequisites
- [Node.js](https://nodejs.org/) (v18+)
- npm

### Installation
Clone the repository and install dependencies:
```bash
npm install
```

### Run Development Server
WXT will build the extension and launch a clean Chrome instance with the extension auto-loaded:
```bash
npm run dev
```

### Build for Production
Build compile bundle output for Chrome Web Store:
```bash
npm run build
```

---

## Testing & Compilation

Verify TypeScript compilation without emitting files:
```bash
npm run compile
```

Run unit tests:
```bash
npm run test
```

For executing unit tests directly on Windows (bypassing WXT-Vite plugin path issues):
```bash
npx vitest run -c vitest.unit.config.ts
```

Run Playwright E2E browser tests:
```bash
npm run test:e2e
```
