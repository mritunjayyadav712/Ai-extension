import { ContextEstimator, EstimationInput } from './types';
import { EstimatedContext } from '../../shared/types';
import { HybridEstimator } from './estimators/HybridEstimator';
import { SimpleEstimator } from './estimators/SimpleEstimator';
import { ScrollbarEstimator } from './estimators/ScrollbarEstimator';

export class ContextEstimationEngine {
  private estimators: Map<string, ContextEstimator> = new Map();
  private activeEstimatorName: string;

  constructor(estimators: ContextEstimator[] = [], defaultEstimatorName?: string) {
    if (estimators.length === 0) {
      // Register standard estimators by default
      const hybrid = new HybridEstimator();
      const simple = new SimpleEstimator();
      const scroll = new ScrollbarEstimator();
      
      this.estimators.set(hybrid.name, hybrid);
      this.estimators.set(simple.name, simple);
      this.estimators.set(scroll.name, scroll);
      
      this.activeEstimatorName = hybrid.name;
    } else {
      estimators.forEach((est) => this.estimators.set(est.name, est));
      this.activeEstimatorName = defaultEstimatorName || estimators[0].name;
    }
  }

  public registerEstimator(estimator: ContextEstimator) {
    this.estimators.set(estimator.name, estimator);
  }

  public setActiveEstimator(name: string) {
    if (this.estimators.has(name)) {
      this.activeEstimatorName = name;
    } else {
      console.warn(`[Context Estimation] Estimator ${name} not found. Keeping ${this.activeEstimatorName}`);
    }
  }

  public estimate(input: EstimationInput): EstimatedContext {
    const estimator = this.estimators.get(this.activeEstimatorName);
    if (!estimator) {
      throw new Error(`[Context Estimation] Active estimator ${this.activeEstimatorName} not found.`);
    }

    // ─── PRE-ESTIMATION INPUT DUMP ───
    console.group(`[Context Estimation] Input Diagnostic`);
    console.log(`conversationId:`, input.conversationId);
    console.log(`platform:`, input.platform);
    console.log(`currentUrl:`, input.currentUrl);
    console.log(`visibleMessageCount:`, input.visibleMessageCount);
    console.log(`observedTurns (canonical):`, input.observedTurns);
    console.log(`observedTokens (canonical):`, input.observedTokens);
    console.log(`averageUserTokens:`, input.averageUserTokens.toFixed(1));
    console.log(`averageAssistantTokens:`, input.averageAssistantTokens.toFixed(1));
    console.log(`scrollTop:`, input.scrollTop);
    console.log(`scrollHeight:`, input.scrollHeight);
    console.log(`clientHeight (viewportHeight):`, input.viewportHeight);
    const viewportCoverage = input.scrollHeight > 0 ? input.viewportHeight / input.scrollHeight : 1.0;
    console.log(`viewportCoverage:`, viewportCoverage.toFixed(4));
    console.log(`estimator selected:`, estimator.name);
    console.groupEnd();

    // ─── EARLY RETURN DETECTION ───
    // Check every condition that could cause estimated == observed
    console.group(`[Context Estimation] Early Return Analysis`);

    if (input.viewportHeight <= 0) {
      console.warn(`⚠ DETECTED: viewportHeight is ${input.viewportHeight} (<= 0). Estimator will return observed values.`);
      console.log(`Reason: "Skipped: missing scroll metrics (viewportHeight)"`);
    }
    if (input.scrollHeight <= 0) {
      console.warn(`⚠ DETECTED: scrollHeight is ${input.scrollHeight} (<= 0). Estimator will return observed values.`);
      console.log(`Reason: "Skipped: missing scroll metrics (scrollHeight)"`);
    }
    if (input.viewportHeight > 0 && input.scrollHeight > 0 && input.scrollHeight <= input.viewportHeight) {
      console.warn(`⚠ DETECTED: scrollHeight (${input.scrollHeight}) <= viewportHeight (${input.viewportHeight}). Scroll ratio = 1.0. No extrapolation possible.`);
      console.log(`Reason: "Skipped: canonical == visible (scroll ratio is 1.0, entire conversation fits in viewport)"`);
    }
    if (input.observedTurns <= 0) {
      console.warn(`⚠ DETECTED: observedTurns is ${input.observedTurns}. No turns to extrapolate from.`);
      console.log(`Reason: "Skipped: insufficient observations (zero turns)"`);
    }
    if (input.observedTokens <= 0) {
      console.warn(`⚠ DETECTED: observedTokens is ${input.observedTokens}. No tokens to extrapolate from.`);
      console.log(`Reason: "Skipped: insufficient observations (zero tokens)"`);
    }
    if (input.visibleMessageCount <= 0) {
      console.warn(`⚠ DETECTED: visibleMessageCount is ${input.visibleMessageCount}. Cannot compute density.`);
      console.log(`Reason: "Skipped: insufficient observations (zero visible messages)"`);
    }

    // Check if scroll metrics were passed from content script at all
    if (input.scrollTop === 0 && input.scrollHeight === 0 && input.viewportHeight === 0) {
      console.warn(`⚠ DETECTED: ALL scroll metrics are 0. Content script likely failed to find scroll container.`);
      console.log(`Reason: "Skipped: missing scroll metrics (all zero — content script scroll detection failed)"`);
    }

    console.groupEnd();

    // ─── EXECUTE ESTIMATION ───
    const result = estimator.estimate(input);

    // ─── POST-ESTIMATION OUTPUT DUMP ───
    const estimatedEqualsObserved = result.estimatedTokens === result.observedTokens && result.estimatedTurns === result.observedTurns;

    console.group(`[Context Estimation] Result`);
    console.log(`Observed Tokens:`, result.observedTokens);
    console.log(`Estimated Tokens:`, result.estimatedTokens);
    console.log(`Observed Turns:`, result.observedTurns);
    console.log(`Estimated Turns:`, result.estimatedTurns);
    console.log(`Coverage Ratio:`, result.coverageRatio.toFixed(4));
    console.log(`Confidence:`, (result.confidence ?? 1.0).toFixed(2));
    console.log(`Estimator:`, result.estimationSource);
    console.log(`Scroll Ratio:`, (input.scrollHeight / (input.viewportHeight || 1)).toFixed(2));
    console.log(`Avg Tokens/Turn:`, (input.averageUserTokens + input.averageAssistantTokens).toFixed(1));

    if (estimatedEqualsObserved) {
      console.warn(`🔴 ESTIMATED == OBSERVED. The estimator produced no extrapolation.`);
      console.warn(`   This means one of the early-return conditions above was triggered,`);
      console.warn(`   OR the scroll ratio is 1.0 (conversation fits entirely in viewport).`);
    } else {
      console.log(`🟢 Estimation produced extrapolated values (estimated > observed).`);
      console.log(`   Token delta: +${result.estimatedTokens - result.observedTokens}`);
      console.log(`   Turn delta: +${result.estimatedTurns - result.observedTurns}`);
    }

    console.groupEnd();

    return result;
  }
}
