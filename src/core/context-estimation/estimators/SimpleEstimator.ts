import { ContextEstimator, EstimationInput } from '../types';
import { EstimatedContext } from '../../../shared/types';

export class SimpleEstimator implements ContextEstimator {
  public name = 'SimpleEstimator';

  public estimate(input: EstimationInput): EstimatedContext {
    const hasScroll = input.scrollHeight > input.viewportHeight;
    const scrollFactor = hasScroll && input.viewportHeight > 0 ? input.scrollHeight / input.viewportHeight : 1.0;

    const estimatedTurns = Math.max(input.observedTurns, Math.round(input.observedTurns * scrollFactor));
    const estimatedTokens = Math.max(input.observedTokens, Math.round(input.observedTokens * scrollFactor));
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
