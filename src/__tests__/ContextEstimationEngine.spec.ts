import { describe, it, expect, vi } from 'vitest';
import { ContextEstimationEngine } from '../core/context-estimation/ContextEstimationEngine';
import { SimpleEstimator } from '../core/context-estimation/estimators/SimpleEstimator';
import { ScrollbarEstimator } from '../core/context-estimation/estimators/ScrollbarEstimator';
import { HybridEstimator } from '../core/context-estimation/estimators/HybridEstimator';
import { EstimationInput } from '../core/context-estimation/types';

describe('Context Estimation Engine & Estimators', () => {
  const mockInput: EstimationInput = {
    observedConversation: { id: 'chatgpt:123', messages: {} },
    observedTokens: 1000,
    observedTurns: 5,
    visibleMessageCount: 10,
    averageUserTokens: 100,
    averageAssistantTokens: 100,
    scrollTop: 500,
    scrollHeight: 2000,
    viewportHeight: 1000,
    platform: 'chatgpt',
    conversationId: 'chatgpt:123',
    currentUrl: 'https://chatgpt.com/c/123',
  };

  describe('SimpleEstimator', () => {
    it('should scale context using scrollHeight and viewportHeight ratio', () => {
      const estimator = new SimpleEstimator();
      const result = estimator.estimate(mockInput);
      
      expect(result.observedTokens).toBe(1000);
      expect(result.observedTurns).toBe(5);
      expect(result.estimatedTurns).toBe(10); // 5 * (2000 / 1000)
      expect(result.estimatedTokens).toBe(2000); // 1000 * (2000 / 1000)
      expect(result.coverageRatio).toBe(0.5);
      expect(result.estimationSource).toBe('SimpleEstimator');
    });

    it('should fallback to observed values if scrollbar suggests no overflow', () => {
      const estimator = new SimpleEstimator();
      const input = { ...mockInput, scrollHeight: 1000, viewportHeight: 1000 };
      const result = estimator.estimate(input);
      
      expect(result.estimatedTurns).toBe(5);
      expect(result.estimatedTokens).toBe(1000);
      expect(result.coverageRatio).toBe(1.0);
    });
  });

  describe('ScrollbarEstimator', () => {
    it('should estimate context strictly using the scrollbar multiplier', () => {
      const estimator = new ScrollbarEstimator();
      const result = estimator.estimate(mockInput);
      
      expect(result.estimatedTurns).toBe(10);
      expect(result.estimatedTokens).toBe(2000);
      expect(result.coverageRatio).toBe(0.5);
      expect(result.estimationSource).toBe('ScrollbarEstimator');
    });

    it('should return observed context if viewport is 0', () => {
      const estimator = new ScrollbarEstimator();
      const input = { ...mockInput, viewportHeight: 0 };
      const result = estimator.estimate(input);
      
      expect(result.estimatedTurns).toBe(5);
      expect(result.estimatedTokens).toBe(1000);
      expect(result.coverageRatio).toBe(1.0);
    });
  });

  describe('HybridEstimator', () => {
    it('should compute weighted estimation using scroll and density', () => {
      const estimator = new HybridEstimator();
      const result = estimator.estimate(mockInput);
      
      expect(result.observedTokens).toBe(1000);
      expect(result.observedTurns).toBe(5);
      expect(result.estimatedTurns).toBeGreaterThanOrEqual(5);
      expect(result.estimatedTokens).toBeGreaterThanOrEqual(1000);
      expect(result.coverageRatio).toBeLessThanOrEqual(1.0);
      expect(result.estimationSource).toBe('HybridEstimator');
    });

    it('should gracefully handle 0 viewport or scrollHeight', () => {
      const estimator = new HybridEstimator();
      const input = { ...mockInput, viewportHeight: 0 };
      const result = estimator.estimate(input);
      
      expect(result.estimatedTurns).toBe(5);
      expect(result.estimatedTokens).toBe(1000);
      expect(result.coverageRatio).toBe(1.0);
    });
  });

  describe('ContextEstimationEngine', () => {
    it('should manage and register multiple estimators', () => {
      const consoleGroupSpy = vi.spyOn(console, 'group').mockImplementation(() => {});
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const consoleGroupEndSpy = vi.spyOn(console, 'groupEnd').mockImplementation(() => {});

      const engine = new ContextEstimationEngine();
      const result = engine.estimate(mockInput);

      expect(result.estimationSource).toBe('HybridEstimator');
      expect(consoleGroupSpy).toHaveBeenCalledWith('[Context Estimation]');
      
      engine.setActiveEstimator('ScrollbarEstimator');
      const scrollResult = engine.estimate(mockInput);
      expect(scrollResult.estimationSource).toBe('ScrollbarEstimator');

      // Cleanup
      consoleGroupSpy.mockRestore();
      consoleLogSpy.mockRestore();
      consoleGroupEndSpy.mockRestore();
    });

    it('should throw an error if active estimator is not found', () => {
      const engine = new ContextEstimationEngine();
      expect(() => engine.setActiveEstimator('NonExistent')).not.toThrow(); // warns only
      
      // Force internal active name to be missing for the throw check
      (engine as any).activeEstimatorName = 'Missing';
      expect(() => engine.estimate(mockInput)).toThrow('[Context Estimation] Active estimator Missing not found.');
    });
  });
});
