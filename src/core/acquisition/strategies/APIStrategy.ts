import { PlatformId } from '../../../shared/types';
import { PlatformAdapter } from '../../../adapters/types';
import { normalizeChatGPTMapping } from '../normalizeMapping';
import { 
  AcquisitionResult, 
  AcquisitionStatus, 
  AcquisitionStrategy, 
  AcquisitionStrategyType 
} from '../types';

/**
 * APIStrategy
 * 
 * Fetches complete conversation history from ChatGPT's backend API.
 * This strategy makes a direct fetch() from the content script context.
 * 
 * NOTE: This currently returns 404 because the isolated content script
 * does not carry ChatGPT's session tokens. The NetworkInterceptStrategy
 * (via MAIN-world interception) is the primary method for acquiring
 * complete history. This strategy is retained as a documented fallback.
 */
export class APIStrategy implements AcquisitionStrategy {
  public type: AcquisitionStrategyType = 'API';
  private adapter: PlatformAdapter;

  constructor(adapter: PlatformAdapter) {
    this.adapter = adapter;
  }

  public canExecute(platform: PlatformId): boolean {
    // Only ChatGPT has the backend API available
    return platform === 'chatgpt';
  }

  public async execute(
    threadId: string,
    signal?: AbortSignal,
    onProgress?: (status: AcquisitionStatus) => void
  ): Promise<AcquisitionResult> {
    try {
      // Check if aborted before starting
      if (signal?.aborted) {
        return {
          strategy: this.type,
          success: false,
          messages: [],
          isComplete: false,
          error: new Error('Acquisition cancelled before API call')
        };
      }

      // Make API request to ChatGPT backend
      const response = await fetch(`/backend-api/conversation/${threadId}`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        signal
      });

      // Handle HTTP errors
      if (!response.ok) {
        return {
          strategy: this.type,
          success: false,
          messages: [],
          isComplete: false,
          error: new Error(`API returned HTTP ${response.status}: ${response.statusText}`)
        };
      }

      // Parse response
      const data = await response.json();

      // Normalize response to ChatMessage[] using shared normalizer
      const messages = normalizeChatGPTMapping(data);

      if (messages.length > 0) {
        onProgress?.({
          state: 'SUCCESS',
          currentStrategy: this.type,
          messagesFound: messages.length
        });

        return {
          strategy: this.type,
          success: true,
          messages,
          isComplete: true  // ← API gives us complete history
        };
      }

      return {
        strategy: this.type,
        success: false,
        messages: [],
        isComplete: false,
        error: new Error('API returned empty message list')
      };

    } catch (error) {
      // Handle abort error separately
      if (error instanceof Error && error.name === 'AbortError') {
        return {
          strategy: this.type,
          success: false,
          messages: [],
          isComplete: false,
          error: new Error('API acquisition cancelled')
        };
      }

      // Other network/parsing errors
      return {
        strategy: this.type,
        success: false,
        messages: [],
        isComplete: false,
        error: error as Error
      };
    }
  }
}
