import { PlatformId } from '../../../shared/types';
import { PlatformAdapter } from '../../../adapters/types';
import { ChatMessage } from '../../models';
import {
  AcquisitionResult,
  AcquisitionStatus,
  AcquisitionStrategy,
  AcquisitionStrategyType,
} from '../types';

export interface StoredNetworkHistory {
  conversationId: string;
  rawNodeCount: number;
  messages: ChatMessage[];
  timestamp: number;
  consumed?: boolean;
}

class NetworkHistoryStoreClass {
  private store: Map<string, StoredNetworkHistory> = new Map();

  public set(history: StoredNetworkHistory): void {
    this.store.set(history.conversationId, { ...history, consumed: false });
  }

  public get(conversationId?: string | null): StoredNetworkHistory | undefined {
    if (conversationId && this.store.has(conversationId)) {
      return this.store.get(conversationId);
    }
    // Fallback: return the most recent entry
    let latest: StoredNetworkHistory | undefined;
    for (const entry of this.store.values()) {
      if (!latest || entry.timestamp > latest.timestamp) {
        latest = entry;
      }
    }
    return latest;
  }

  public has(conversationId?: string | null): boolean {
    const entry = this.get(conversationId);
    return !!entry && entry.messages.length > 0;
  }

  public hasUnconsumed(conversationId?: string | null): boolean {
    const entry = this.get(conversationId);
    return !!entry && entry.messages.length > 0 && !entry.consumed;
  }

  public markConsumed(conversationId?: string | null): void {
    const entry = this.get(conversationId);
    if (entry) {
      entry.consumed = true;
    }
  }

  public clear(): void {
    this.store.clear();
  }
}

export const NetworkHistoryStore = new NetworkHistoryStoreClass();

export class NetworkInterceptStrategy implements AcquisitionStrategy {
  public type: AcquisitionStrategyType = 'NETWORK_INTERCEPT';
  private adapter: PlatformAdapter;

  constructor(adapter: PlatformAdapter) {
    this.adapter = adapter;
  }

  public canExecute(platform: PlatformId): boolean {
    if (platform !== 'chatgpt') return false;
    const threadId = this.adapter.getThreadId ? this.adapter.getThreadId() : null;
    return NetworkHistoryStore.has(threadId);
  }

  public async execute(
    threadId: string,
    signal?: AbortSignal,
    onProgress?: (status: AcquisitionStatus) => void
  ): Promise<AcquisitionResult> {
    if (signal?.aborted) {
      return {
        strategy: this.type,
        success: false,
        messages: [],
        isComplete: false,
        error: new Error('Acquisition cancelled before network intercept check'),
      };
    }

    const stored = NetworkHistoryStore.get(threadId);

    if (stored && stored.messages.length > 0) {
      onProgress?.({
        state: 'SUCCESS',
        currentStrategy: this.type,
        messagesFound: stored.messages.length,
      });

      return {
        strategy: this.type,
        success: true,
        messages: stored.messages,
        isComplete: true,
      };
    }

    return {
      strategy: this.type,
      success: false,
      messages: [],
      isComplete: false,
      error: new Error(`No network intercepted history available for threadId ${threadId}`),
    };
  }
}
