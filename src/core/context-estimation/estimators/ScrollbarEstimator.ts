import { ContextEstimator, EstimationInput } from '../types';
import { EstimatedContext } from '../../../shared/types';

export class ScrollbarEstimator implements ContextEstimator {
  public name = 'ScrollbarEstimator';

  public estimate(input: EstimationInput): EstimatedContext {
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

    const scrollRatio = input.scrollHeight / input.viewportHeight;
    const multiplier = Math.max(1.0, scrollRatio);

    const estimatedTurns = Math.max(input.observedTurns, Math.round(input.observedTurns * multiplier));
    const estimatedTokens = Math.max(input.observedTokens, Math.round(input.observedTokens * multiplier));
    const coverageRatio = estimatedTurns > 0 ? input.observedTurns / estimatedTurns : 1.0;

    return {
      observedTokens: input.observedTokens,
      estimatedTokens,
      observedTurns: input.observedTurns,
      estimatedTurns,
      coverageRatio: Math.min(1.0, Math.max(0.0, coverageRatio)),
      estimationSource: this.name,
    };
  }
}
