import { defineBackground } from 'wxt/sandbox';
import { browser } from 'wxt/browser';
import { messaging } from '../messaging/client';
import { storageLayer, defaultState } from '../storage';
import { ExtensionMessage } from '../messaging/types';
// TokenEngine is now offloaded to offscreen document
import { SummaryEngine } from '../engines/summary';
import { PlatformId } from '../shared/types';
import { DegradationEngine } from '../engines/degradation';
import { conversationManager } from '../core/ConversationManager';
import { ContextEstimationEngine } from '../core/context-estimation/ContextEstimationEngine';

const contextEstimationEngine = new ContextEstimationEngine();

let creatingOffscreen: Promise<void> | null = null;

async function setupOffscreenDocument(path: '/offscreen.html') {
  if (await hasDocument()) return;
  if (creatingOffscreen) {
    await creatingOffscreen;
  } else {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: browser.runtime.getURL(path),
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: 'Run tiktoken in an offscreen document for performance',
    });
    await creatingOffscreen;
    creatingOffscreen = null;
  }
}

async function hasDocument() {
  if (typeof chrome !== 'undefined' && chrome.offscreen && chrome.offscreen.hasDocument) {
    return await chrome.offscreen.hasDocument();
  }
  return false;
}
// Global cache for summary engines to enable incremental updates
const summaryEngines: Record<string, SummaryEngine> = {};

const degradationEngine = new DegradationEngine();

interface SidePanelBrowser {
  sidePanel?: {
    setPanelBehavior(options: { openPanelOnActionClick: boolean }): Promise<void>;
    open(options: { tabId: number }): Promise<void>;
  };
}

function getSidePanelApi() {
  return (browser as typeof browser & SidePanelBrowser).sidePanel;
}

function getSummaryEngine(platformId: string): SummaryEngine {
  if (!summaryEngines[platformId]) {
    summaryEngines[platformId] = new SummaryEngine();
  }
  return summaryEngines[platformId];
}



export default defineBackground(() => {
  console.log('[Startup] AI Context Tracker: Background Service Worker initialized');

  // Enable session storage access for content scripts (Crucial for WXT HMR and runtime state)
  if (
    typeof chrome !== 'undefined' &&
    chrome.storage &&
    chrome.storage.session &&
    chrome.storage.session.setAccessLevel
  ) {
    chrome.storage.session
      .setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' })
      .catch(console.error);
  }

  // Initialize storage on install if needed
  browser.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'install') {
      console.log('[Startup] Extension installed, initializing default state.');
      await storageLayer.appState.setValue(defaultState);

      // Ensure the side panel opens when clicking the extension action icon
      const sidePanel = getSidePanelApi();
      if (sidePanel) {
        await sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
      }
    }
  });

  browser.tabs.onActivated.addListener(async (activeInfo) => {
    await storageLayer.activeTabId.setValue(activeInfo.tabId);
  });

  // Re-verify side panel behavior on startup just in case
  const sidePanel = getSidePanelApi();
  if (sidePanel) {
    sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
  }

  // Main Event Router
  messaging.addListener(async (message: ExtensionMessage, sender) => {
    switch (message.type) {
      case 'GET_STATE': {
        const tabId =
          typeof sender === 'object' && sender !== null && 'tab' in sender
            ? (sender as { tab?: { id?: number } }).tab?.id
            : undefined;
        const state = await storageLayer.appState.getValue(tabId);
        return state;
      }

      case 'CONTENT_MUTATION': {
        const observation = message.payload;
        console.log(`[Context] Received DOM_OBSERVATION with ${observation.messages.length} messages for platform: ${observation.platform}`);

        // 1. Let the ConversationManager perform the canonical merge
        const conversation = await conversationManager.processMutation(observation);

        // 2. Map back to array for downstream engines
        const fullMessages = conversation.orderedMessageIds.map(id => conversation.messages[id]);

        const tabId =
          typeof sender === 'object' && sender !== null && 'tab' in sender
            ? (sender as { tab?: { id?: number } }).tab?.id
            : undefined;

        // 3. Get current state to read thresholds and context limit
        const state = await storageLayer.appState.getValue(tabId);
        const limit = state.stats.contextLimit;

        // 4. Ensure Offscreen Document exists and send Tokenize Request
        // (We do this even while streaming to keep token count live)
        await setupOffscreenDocument('/offscreen.html');

        let estimate: { totalTokens: number; totalInputTokens: number; totalOutputTokens: number; confidence: number };
        try {
          console.log(`[LLM] Requesting tokenization offscreen for ${fullMessages.length} messages.`);
          estimate = await browser.runtime.sendMessage({
            type: 'TOKENIZE_REQUEST',
            payload: {
              platformId: observation.platform,
              maxContext: limit,
              messages: fullMessages,
            },
          }) as typeof estimate;
        } catch (err) {
          console.error('[LLM] Tokenization failed:', err);
          estimate = { totalTokens: 0, totalInputTokens: 0, totalOutputTokens: 0, confidence: 0 };
        }

        // 5. Run Summary Engine
        // Optimization: Only run summary if NOT streaming, to save CPU and LLM costs
        let currentSummary = state.currentSummary;
        const turns = fullMessages.filter((m) => m.role === 'user').length || 1;
        const autoSummaryThreshold = 3;

        if (!observation.isStreaming) {
          if (turns >= autoSummaryThreshold) {
            console.log(`[Summary] Triggering summary engine for ${observation.platform}. Turns: ${turns}`);
            const summaryEngine = getSummaryEngine(observation.platform);
            currentSummary = summaryEngine.processIncremental(fullMessages);
          }
        } else {
          console.log(`[Summary] Skipped summary generation (isStreaming = true)`);
        }

        // 6. Calculate live health from full conversation history
        const healthScore = degradationEngine.evaluate({
          messages: fullMessages,
          totalTokens: estimate.totalTokens,
          contextLimit: limit,
          thresholds: state.thresholds,
        });

        // 7. Context Estimation
        const totalUserChars = fullMessages.filter(m => m.role === 'user').reduce((acc, m) => acc + m.text.length, 0);
        const totalAssistantChars = fullMessages.filter(m => m.role === 'ai').reduce((acc, m) => acc + m.text.length, 0);
        const totalChars = totalUserChars + totalAssistantChars || 1;
        
        const userRatio = totalUserChars / totalChars;
        const assistantRatio = totalAssistantChars / totalChars;
        
        const totalUserTokens = estimate.totalTokens * userRatio;
        const totalAssistantTokens = estimate.totalTokens * assistantRatio;
        
        const userMsgCount = fullMessages.filter(m => m.role === 'user').length || 1;
        const assistantMsgCount = fullMessages.filter(m => m.role === 'ai').length || 1;
        
        const averageUserTokens = totalUserTokens / userMsgCount;
        const averageAssistantTokens = totalAssistantTokens / assistantMsgCount;

        console.log(
          `[ScrollContainerInvestigation][ContextEstimationEngine Input Trace]\n` +
          `Source Payload: CONTENT_MUTATION sent from processDOM\n` +
          `DOM Path Source: Processed by processDOM in content script\n` +
          `scrollHeight: ${observation.scrollHeight || 0}\n` +
          `clientHeight: ${observation.clientHeight || 0}\n` +
          `scrollTop: ${observation.scrollTop || 0}\n` +
          `platform: ${observation.platform}\n` +
          `url: ${observation.url}`
        );

        const estimatedContext = contextEstimationEngine.estimate({
          observedConversation: conversation,
          observedTokens: estimate.totalTokens,
          observedTurns: turns,
          visibleMessageCount: observation.messages.length,
          averageUserTokens,
          averageAssistantTokens,
          scrollTop: observation.scrollTop || 0,
          scrollHeight: observation.scrollHeight || 0,
          viewportHeight: observation.clientHeight || 0,
          platform: observation.platform,
          conversationId: conversation.id,
          currentUrl: observation.url,
        });

        console.log(`[Investigation 2 - Estimator wiring]
Stage: After estimation in background.ts
conversationId: ${conversation.id}
visibleMessageCount: ${observation.messages.length}
scrollTop: ${observation.scrollTop || 0}
scrollHeight: ${observation.scrollHeight || 0}
clientHeight: ${observation.clientHeight || 0}
estimatedTurns: ${estimatedContext.estimatedTurns}
estimatedTokens: ${estimatedContext.estimatedTokens}
confidence: ${estimatedContext.confidence ?? 1.0}`);

        // 8. Update the centralized Derived State (AppState)
        await storageLayer.updateAppState(
          {
            tokenEstimate: {
              count: estimate.totalTokens,
              inputCount: estimate.totalInputTokens,
              outputCount: estimate.totalOutputTokens,
              confidence: estimate.confidence,
              isStreaming: observation.isStreaming,
            },
            platform: observation.platform,
            status: healthScore.status,
            currentSummary,
            stats: {
              ...state.stats,
              turns,
              avgTokensPerTurn: estimate.totalTokens / turns,
              healthMetrics: degradationEngine.toLegacyMetrics(healthScore),
            },
            estimatedContext,
          },
          tabId
        );

        console.log(`[Investigation 2 - Estimator wiring] Stage: AppState updated for ${conversation.id}`);

        return { success: true };
      }

      case 'UPDATE_TOKEN_COUNT': {
        const tabId =
          typeof sender === 'object' && sender !== null && 'tab' in sender
            ? (sender as { tab?: { id?: number } }).tab?.id
            : undefined;
        // Legacy fallback or direct UI override
        const { count, platform } = message.payload;
        await storageLayer.updateAppState(
          {
            tokenEstimate: {
              count,
              inputCount: count / 2,
              outputCount: count / 2,
              confidence: 0.95,
              isStreaming: false,
            },
            platform,
          },
          tabId
        );
        return { success: true };
      }

      case 'REGENERATE_SUMMARY': {
        // We can't synchronously resolve the URL from here without querying the tab, 
        // but typically REGENERATE_SUMMARY is fired when the UI is open. 
        // In a full implementation we'd pass conversationId from the UI.
        console.warn('REGENERATE_SUMMARY requires conversationId in new architecture.');
        return { success: false, error: 'Not fully implemented in redesign' };
      }

      case 'OPEN_SIDE_PANEL': {
        const tabId =
          typeof sender === 'object' && sender !== null && 'tab' in sender
            ? (sender as { tab?: { id?: number } }).tab?.id
            : undefined;
        const currentSidePanel = getSidePanelApi();
        if (currentSidePanel && tabId) {
          await currentSidePanel.open({ tabId });
          return { success: true };
        }
        return { success: false, error: 'Side panel API not available or no tab ID' };
      }

      default:
        console.warn('[Background] Unhandled message type:', message.type);
        return { success: false, error: 'Unhandled message type' };
    }
  });
});
