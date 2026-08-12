import { ChatMessage, DOMObservation } from '../models';
import { PlatformId } from '../../shared/types';

export type AcquisitionStrategyType =
  'NETWORK_INTERCEPT' | 'CACHE' | 'HYDRATION' | 'API' | 'DOM' | 'SCROLL' | 'FALLBACK';

export interface PlatformCapability {
  platformId: string;
  supportedStrategies: AcquisitionStrategyType[];
  priority: AcquisitionStrategyType[];
  supportsStreaming: boolean;
}

export interface AcquisitionResult {
  strategy: AcquisitionStrategyType;
  success: boolean;
  messages: ChatMessage[];
  isComplete: boolean; // True if the strategy guarantees the entire history was retrieved
  error?: Error;
}

export interface AcquisitionStatus {
  state: 'IDLE' | 'ACQUIRING' | 'SUCCESS' | 'FAILED' | 'ABORTED';
  currentStrategy?: AcquisitionStrategyType;
  progressPercentage?: number;
  messagesFound: number;
}

// 2. Strategy Interfaces
export interface AcquisitionStrategy {
  type: AcquisitionStrategyType;
  canExecute(platform: PlatformId): boolean;
  execute(
    threadId: string,
    signal?: AbortSignal,
    onProgress?: (status: AcquisitionStatus) => void
  ): Promise<AcquisitionResult>;
}

// 3. Providers (Separating passive observation from active history pulling)
export interface ObservationProvider {
  /** Actively watches the viewport/network for new incoming tokens/messages */
  startObserving(threadId: string, onObservation: (obs: DOMObservation) => void): void;
  stopObserving(): void;
}

export interface HistoryProvider {
  /** On-demand historical pull */
  acquireHistory(threadId: string): Promise<AcquisitionResult>;
}

// 4. Orchestration
export interface ConversationAcquirerInterface {
  acquire(threadId: string, platform: PlatformId): Promise<AcquisitionResult>;
  cancel(): void;
  onStatusChange(callback: (status: AcquisitionStatus) => void): void;
}

export interface HistoryLoaderInterface {
  ensureCompleteHistory(threadId: string): Promise<void>;
  getStatus(threadId: string): AcquisitionStatus;
}
