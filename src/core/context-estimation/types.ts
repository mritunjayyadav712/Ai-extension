import { PlatformId } from '../../shared/types';
import { EstimatedContext } from '../../shared/types';

export interface EstimationInput {
  observedConversation: any; // The canonical conversation entity or record
  observedTokens: number;     // ObservedTokenCount
  observedTurns: number;      // ObservedTurnCount
  visibleMessageCount: number; // VisibleMessageCount
  averageUserTokens: number;   // AverageUserTokens
  averageAssistantTokens: number; // AverageAssistantTokens
  scrollTop: number;           // ScrollTop
  scrollHeight: number;        // ScrollHeight
  viewportHeight: number;      // ViewportHeight
  platform: PlatformId;        // Platform
  conversationId: string;      // ConversationId
  currentUrl: string;          // Current URL
}

export interface ContextEstimator {
  name: string;
  estimate(input: EstimationInput): EstimatedContext;
}
