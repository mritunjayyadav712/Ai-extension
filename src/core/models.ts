import { PlatformId, ContextHealthMetrics } from '../shared/types';
import { StructuredSummary } from '../engines/summary/types';

export type MessageRole = 'user' | 'ai' | 'system';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  text: string;
  timestamp?: number;
}

export interface TokenEstimate {
  count: number;
  inputCount: number;
  outputCount: number;
  confidence: number;
  isStreaming: boolean;
}

export interface ConversationStats {
  turns: number;
  avgTokensPerTurn: number;
  contextLimit: number;
  healthMetrics: ContextHealthMetrics;
}

/**
 * The Canonical Conversation Entity
 */
export interface Conversation {
  id: string; // Canonical ID: e.g. "chatgpt:uuid"
  platform: PlatformId;
  threadId: string;
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;

  // O(1) merge updates and chronological order
  messages: Record<string, ChatMessage>;
  orderedMessageIds: string[];

  // Derived state attached directly to the entity
  summary: StructuredSummary | null;
  tokenEstimate: TokenEstimate;
  stats: ConversationStats;
  version: number; // Incremented on every successful merge
}

/**
 * The payload emitted by content script adapters
 */
export interface DOMObservation {
  platform: PlatformId;
  threadId: string | null; // Null if unable to resolve (e.g. temporary root URL)
  url: string;
  pageTitle: string;
  messages: ChatMessage[];
  isStreaming: boolean;
  source?: 'NETWORK' | 'DOM';
  scrollTop?: number;
  scrollHeight?: number;
  clientHeight?: number;
}

export interface MutationLog {
  id?: number; // Auto-incremented by IndexedDB
  conversationId: string;
  timestamp: number;
  observation: DOMObservation;
}
