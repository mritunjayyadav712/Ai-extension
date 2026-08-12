import { getDB } from '../storage/db';
import { Conversation, DOMObservation } from './models';

export class ConversationManager {
  /**
   * Processes a DOM observation from the content script.
   * Exclusively locks the specific conversation, performs a deterministic merge,
   * logs the mutation, and persists back to IndexedDB.
   */
  public async processMutation(observation: DOMObservation): Promise<Conversation> {
    // Generate Canonical ID. If the adapter couldn't resolve a threadId (e.g. at root /),
    // we fallback to the raw URL as a temporary identifier.
    const threadId = observation.threadId || observation.url;
    const conversationId = `${observation.platform}:${threadId}`;

    const lockName = `conversation-lock:${conversationId}`;

    // Utilize Web Locks API for robust concurrency that survives service worker suspensions
    return await navigator.locks.request(lockName, async () => {
      const db = await getDB();
      const tx = db.transaction(['conversations', 'mutation_logs'], 'readwrite');

      const convStore = tx.objectStore('conversations');
      const logStore = tx.objectStore('mutation_logs');

      // 1. Fetch current canonical state
      let conversation = await convStore.get(conversationId);
      const now = Date.now();

      if (!conversation) {
        conversation = {
          id: conversationId,
          platform: observation.platform,
          threadId: threadId,
          metadata: {
            url: observation.url,
            title: observation.pageTitle,
          },
          createdAt: now,
          updatedAt: now,
          messages: {},
          orderedMessageIds: [],
          summary: null,
          tokenEstimate: {
            count: 0,
            inputCount: 0,
            outputCount: 0,
            confidence: 1,
            isStreaming: false,
          },
          stats: {
            turns: 0,
            avgTokensPerTurn: 0,
            contextLimit: 128000,
            healthMetrics: {
              repetition: 'Low',
              lengthDrift: 'Stable',
              instruction: 'Good',
              explicit: 'None',
            },
          },
          version: 0,
        };
      }

      const storedCountBefore = conversation.orderedMessageIds.length;
      let addedCount = 0;
      let updatedCount = 0;
      let ignoredCount = 0;

      // 2. Deterministic Merge Logic
      for (const msg of observation.messages) {
        const existing = conversation.messages[msg.id];

        if (!existing) {
          // Add new message
          conversation.messages[msg.id] = msg;
          conversation.orderedMessageIds.push(msg.id);
          addedCount++;
          console.debug(`[ConversationManager] Added new message ID: ${msg.id}`);
        } else {
          if (existing.text !== msg.text) {
            // Update existing message (e.g., streaming or edited)
            console.debug(
              `[ConversationManager] Updated existing message ID: ${msg.id}. Old length: ${existing.text.length}, New length: ${msg.text.length}`
            );
            existing.text = msg.text;
            updatedCount++;
          } else {
            console.debug(`[ConversationManager] Ignored message ID: ${msg.id} (Text identical)`);
            console.debug(
              `[ConversationManager] Existing record:`,
              JSON.stringify(existing).slice(0, 200)
            );
            ignoredCount++;
          }
        }
      }

      // 3. Update Meta & Version
      conversation.updatedAt = now;
      if (addedCount > 0 || updatedCount > 0) {
        conversation.version += 1;
      }

      // Compute turn count roughly based on user messages
      const turns = conversation.orderedMessageIds.filter(
        (id) => conversation.messages[id]?.role === 'user'
      ).length;
      conversation.stats.turns = turns;

      const storedCountAfter = conversation.orderedMessageIds.length;

      const source = observation.source || 'DOM';

      // 4. Reconciliation Logging
      console.log(
        `[VERIFY:CONVERSATION_MANAGER]\n` +
          `conversationId=${conversationId}\n` +
          `source=${source}\n` +
          `incomingMessages=${observation.messages.length}\n` +
          `[VERIFY:MERGE]\n` +
          `source=${source}\n` +
          `beforeCount=${storedCountBefore}\n` +
          `incomingCount=${observation.messages.length}\n` +
          `newUnique=${addedCount}\n` +
          `updated=${updatedCount}\n` +
          `afterCount=${storedCountAfter}\n` +
          `[VERIFY:CANONICAL]\n` +
          `conversationId=${conversationId}\n` +
          `messageCount=${storedCountAfter}\n` +
          `[VERIFY:CANONICAL_PROTECTION]\n` +
          `before=${storedCountBefore}\n` +
          `domIncoming=${observation.messages.length}\n` +
          `after=${storedCountAfter}\n` +
          `action=${source === 'DOM' ? 'NO_SHRINK' : 'MERGE_ONLY'}\n` +
          `[ConversationManager] MERGE COMPLETED:\n` +
          ` Added: ${addedCount}\n` +
          ` Updated: ${updatedCount}\n` +
          ` Ignored (Identical): ${ignoredCount}\n` +
          ` Turn count: ${conversation.stats.turns}\n` +
          ` Token count estimate: ${conversation.tokenEstimate.count}`
      );

      // 5. Append Mutation Log for Event Sourcing
      await logStore.add({
        conversationId: conversationId,
        timestamp: now,
        observation: observation,
      });

      // 6. Persist Canonical State
      await convStore.put(conversation);

      // Transaction auto-commits upon completion of this scope
      await tx.done;

      console.log(
        `[VERIFY:INDEXEDDB]\n` +
          `conversationId=${conversationId}\n` +
          `storedMessageCount=${storedCountAfter}`
      );

      return conversation;
    });
  }
}

export const conversationManager = new ConversationManager();
