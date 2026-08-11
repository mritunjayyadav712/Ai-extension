import { ContextEstimator, EstimationInput } from '../types';
import { EstimatedContext } from '../../../shared/types';

export class HybridEstimator implements ContextEstimator {
  public name = 'HybridEstimator';

  public estimate(input: EstimationInput): EstimatedContext {
    // Basic fallback check
    if (input.viewportHeight <= 0 || input.scrollHeight <= 0) {
      return {
        observedTokens: input.observedTokens,
        estimatedTokens: input.observedTokens,
        observedTurns: input.observedTurns,
        estimatedTurns: input.observedTurns,
        coverageRatio: 1.0,
        estimationSource: this.name,
      };
    }

    // Heuristic 1: Scrollbar ratio (total height / viewport height)
    const scrollbarRatio = input.scrollHeight / input.viewportHeight;

    // Heuristic 2: Message density-based projection
    // Estimate average height per message based on viewport and current visible messages
    const visibleMessageCount = Math.max(1, input.visibleMessageCount);
    const averageMessageHeight = input.viewportHeight / visibleMessageCount;
    
    // Project total messages using the scrollHeight and average message height
    const estimatedTotalMessagesByHeight = averageMessageHeight > 0 
      ? input.scrollHeight / averageMessageHeight 
      : visibleMessageCount;

    // Convert messages to turns (ratio of turns to visible messages in the current state)
    const turnsToMessagesRatio = input.observedTurns > 0 
      ? input.observedTurns / visibleMessageCount 
      : 0.5;

    const turnsByScroll = input.observedTurns * scrollbarRatio;
    const turnsByDensity = estimatedTotalMessagesByHeight * turnsToMessagesRatio;

    // Combine turn estimations with pluggable weights (scrollbar vs density)
    const scrollbarWeight = 0.6;
    const densityWeight = 0.4;
    const weightedTurns = (turnsByScroll * scrollbarWeight) + (turnsByDensity * densityWeight);
    const finalEstimatedTurns = Math.max(input.observedTurns, Math.round(weightedTurns));

    // Heuristic 3: Token projection
    // Use average tokens per turn (user + assistant)
    const avgTokensPerTurn = input.averageUserTokens + input.averageAssistantTokens;
    const tokensByAvgTurn = finalEstimatedTurns * (avgTokensPerTurn || 400); // 400 fallback
    const tokensByScrollMultiplier = input.observedTokens * scrollbarRatio;

    // Combine token projections
    const finalEstimatedTokens = Math.max(
      input.observedTokens,
      Math.round((tokensByScrollMultiplier * 0.5) + (tokensByAvgTurn * 0.5))
    );

    // Heuristic 4: Coverage ratio
    const coverageRatio = finalEstimatedTurns > 0 ? input.observedTurns / finalEstimatedTurns : 1.0;

    return {
      observedTokens: input.observedTokens,
      estimatedTokens: finalEstimatedTokens,
      observedTurns: input.observedTurns,
      estimatedTurns: finalEstimatedTurns,
      coverageRatio: Math.min(1.0, Math.max(0.0, coverageRatio)),
      estimationSource: this.name,
    };
  }
}
