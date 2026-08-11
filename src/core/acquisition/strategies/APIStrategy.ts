import { PlatformId } from '../../../shared/types';
import { PlatformAdapter } from '../../../adapters/types';
import { ChatMessage, MessageRole } from '../../models';
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
 * This is the most reliable way to get the full conversation without requiring
 * the user to scroll through the entire history.
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

      // Normalize response to ChatMessage[]
      const messages = this.normalizeResponse(data);

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

  /**
   * Normalize ChatGPT API response to ChatMessage[]
   * 
   * ChatGPT's /backend-api/conversation/{id} endpoint returns:
   * {
   *   "mapping": {
   *     "node_id_1": {
   *       "id": "msg_id_1",
   *       "message": {
   *         "id": "msg_id_1",
   *         "author": { "role": "user" | "assistant" | "system" },
   *         "content": { "parts": ["text content"] },
   *         "create_time": timestamp
   *       }
   *     },
   *     ...
   *   }
   * }
   */
  private normalizeResponse(data: any): ChatMessage[] {
    const messages: ChatMessage[] = [];

    if (!data || typeof data !== 'object') {
      return messages;
    }

    // Handle ChatGPT API response structure: mapping object
    if (data.mapping && typeof data.mapping === 'object') {
      const mapping = data.mapping;
      
      // mapping is { node_id: { message: {...} }, ... }
      // We need to preserve order, so collect with timestamps
      const messageEntries: Array<{ node: any; msg: any; time: number }> = [];

      for (const nodeId in mapping) {
        try {
          const node = mapping[nodeId];
          
          // Some nodes may not have messages (they're structural)
          if (!node || !node.message) {
            continue;
          }

          const msg = node.message;
          const createTime = msg.create_time || 0;
          
          messageEntries.push({ node, msg, time: createTime });
        } catch (e) {
          // Skip malformed entries
          continue;
        }
      }

      // Sort by creation time to preserve conversation order
      messageEntries.sort((a, b) => a.time - b.time);

      // Extract messages
      for (const entry of messageEntries) {
        try {
          const msg = entry.msg;
          
          // Determine role
          const authorRole = msg.author?.role;
          let role: MessageRole;
          
          if (authorRole === 'user') {
            role = 'user';
          } else if (authorRole === 'assistant') {
            role = 'ai';
          } else {
            // Skip system messages or unknown roles
            continue;
          }

          // Extract text content
          let text = '';
          if (msg.content?.parts && Array.isArray(msg.content.parts)) {
            text = msg.content.parts
              .filter((part: any) => typeof part === 'string')
              .join('\n');
          } else if (typeof msg.content === 'string') {
            text = msg.content;
          }

          // Only include messages with actual content
          if (text && text.trim()) {
            messages.push({
              id: msg.id || `msg_${messages.length}`,
              role,
              text: text.trim()
            });
          }
        } catch (e) {
          // Skip messages that fail to parse
          continue;
        }
      }
    }

    return messages;
  }
}
