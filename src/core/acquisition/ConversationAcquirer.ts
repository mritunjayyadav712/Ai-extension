import { PlatformId } from '../../shared/types';
import { NetworkHistoryStore } from './strategies/NetworkInterceptStrategy';
import {
  AcquisitionResult,
  AcquisitionStatus,
  ConversationAcquirerInterface,
  AcquisitionStrategy,
} from './types';

export class ConversationAcquirer implements ConversationAcquirerInterface {
  private strategies: AcquisitionStrategy[] = [];
  private statusListeners: Set<(status: AcquisitionStatus) => void> = new Set();
  private abortController: AbortController | null = null;

  constructor(strategies: AcquisitionStrategy[]) {
    this.strategies = strategies;
  }

  public registerStrategy(strategy: AcquisitionStrategy) {
    this.strategies.push(strategy);
  }

  public async acquire(threadId: string, platform: PlatformId): Promise<AcquisitionResult> {
    this.cancel(); // Cancel any ongoing acquisition
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    let result: AcquisitionResult = {
      strategy: 'FALLBACK',
      success: false,
      messages: [],
      isComplete: false,
      error: new Error('No valid strategies found'),
    };

    let totalMessagesFound = 0;
    let directApiAttempted = false;

    const notifyStatus = (status: AcquisitionStatus) => {
      this.statusListeners.forEach((listener) => listener(status));
    };

    notifyStatus({ state: 'ACQUIRING', messagesFound: 0 });

    console.group(`[History Acquisition] Started for Conversation: ${threadId}`);

    let selectedStrategy: string = 'None (All Failed)';

    try {
      // In a real implementation, we would fetch the PlatformCapability and sort the strategies.
      // For Phase 1, we just run the registered strategies in order.
      for (const strategy of this.strategies) {
        if (signal.aborted) {
          notifyStatus({ state: 'ABORTED', messagesFound: totalMessagesFound });
          return result; // return last failed/partial result
        }

        if (!strategy.canExecute(platform)) {
          console.log(
            `\n[Strategy] ${strategy.type}:\nFAILED\nReason: canExecute() returned false (Adapter does not support this strategy or it already ran).`
          );
          continue;
        }

        if (strategy.type === 'API') {
          directApiAttempted = true;
        }

        notifyStatus({
          state: 'ACQUIRING',
          currentStrategy: strategy.type,
          messagesFound: totalMessagesFound,
        });

        try {
          const stratResult = await strategy.execute(threadId, signal, (status) => {
            totalMessagesFound = Math.max(totalMessagesFound, status.messagesFound);
            notifyStatus({
              ...status,
              currentStrategy: strategy.type,
            });
          });

          if (stratResult.success && stratResult.messages.length > 0) {
            console.log(
              `\n[Strategy] ${strategy.type}:\nSUCCESS\nMessages: ${stratResult.messages.length}`
            );
            result = stratResult;
            totalMessagesFound = Math.max(totalMessagesFound, stratResult.messages.length);
            selectedStrategy = strategy.type;

            if (stratResult.isComplete) {
              // We successfully got the full history
              notifyStatus({
                state: 'SUCCESS',
                currentStrategy: strategy.type,
                messagesFound: totalMessagesFound,
              });
              break;
            }
          } else {
            console.log(
              `\n[Strategy] ${strategy.type}:\nFAILED\nReason: ${stratResult.error?.message || 'Returned 0 messages.'}`
            );
          }
        } catch (err) {
          console.log(`\n[Strategy] ${strategy.type}:\nFAILED\nReason: ${(err as Error).message}`);
        }
      }

      if (result.success) {
        notifyStatus({ state: 'SUCCESS', messagesFound: totalMessagesFound });
      } else {
        notifyStatus({ state: 'FAILED', messagesFound: totalMessagesFound });
      }

      const hasNetworkHistory = NetworkHistoryStore.has(threadId);
      const storedNetHistory = NetworkHistoryStore.get(threadId);
      const netMsgCount = storedNetHistory ? storedNetHistory.messages.length : 0;

      console.log(
        `\n[History Acquisition]\n` +
          `Strategy selected: ${selectedStrategy}\n` +
          `Messages acquired: ${totalMessagesFound}\n` +
          `[VERIFY:ACQUISITION_ROUTING]\n` +
          `conversationId=${threadId}\n` +
          `networkHistoryAvailable=${hasNetworkHistory}\n` +
          `networkHistoryMessageCount=${netMsgCount}\n` +
          `selectedStrategy=${selectedStrategy}\n` +
          `directApiAttempted=${directApiAttempted}\n` +
          `[VERIFY:ACQUIRER]\n` +
          `conversationId=${threadId}\n` +
          `messages=${totalMessagesFound}`
      );
      console.groupEnd();
      return result;
    } finally {
      this.abortController = null;
    }
  }

  public cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  public onStatusChange(callback: (status: AcquisitionStatus) => void): void {
    this.statusListeners.add(callback);
  }

  public removeStatusListener(callback: (status: AcquisitionStatus) => void): void {
    this.statusListeners.delete(callback);
  }
}
