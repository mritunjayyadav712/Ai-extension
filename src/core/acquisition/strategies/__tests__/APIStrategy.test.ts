import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { APIStrategy } from '../APIStrategy';
import { AcquisitionResult, AcquisitionStatus } from '../../types';

describe('APIStrategy', () => {
  let strategy: APIStrategy;
  let fetchSpy: any;

  const mockAdapter = {
    id: 'chatgpt',
    domSelectors: ['article'],
    observeSelector: 'main'
  };

  const mockChatGPTResponse = {
    id: 'test-conversation-id',
    mapping: {
      'node_1': {
        id: 'node_1',
        message: {
          id: 'msg_1',
          author: { role: 'user' },
          content: { parts: ['Hello, how are you?'] },
          create_time: 1000
        }
      },
      'node_2': {
        id: 'node_2',
        message: {
          id: 'msg_2',
          author: { role: 'assistant' },
          content: { parts: ['I am doing well, thank you!'] },
          create_time: 2000
        }
      },
      'node_3': {
        id: 'node_3',
        message: {
          id: 'msg_3',
          author: { role: 'user' },
          content: { parts: ['That is great to hear.'] },
          create_time: 3000
        }
      }
    }
  };

  beforeEach(() => {
    strategy = new APIStrategy(mockAdapter as any);
    
    // Mock global fetch
    fetchSpy = vi.fn();
    global.fetch = fetchSpy;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('canExecute', () => {
    it('should return true for chatgpt platform', () => {
      const result = strategy.canExecute('chatgpt');
      expect(result).toBe(true);
    });

    it('should return false for other platforms', () => {
      expect(strategy.canExecute('claude')).toBe(false);
      expect(strategy.canExecute('gemini')).toBe(false);
      expect(strategy.canExecute('grok')).toBe(false);
    });
  });

  describe('execute', () => {
    it('should successfully fetch and normalize conversation', async () => {
      const mockResponse = new Response(JSON.stringify(mockChatGPTResponse), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
      fetchSpy.mockResolvedValue(mockResponse);

      const progressCallback = vi.fn();
      const result = await strategy.execute('test-thread-id', undefined, progressCallback);

      expect(result.strategy).toBe('API');
      expect(result.success).toBe(true);
      expect(result.isComplete).toBe(true);
      expect(result.messages).toHaveLength(3);
      
      // Verify order preservation (sorted by create_time)
      expect(result.messages[0].role).toBe('user');
      expect(result.messages[0].text).toBe('Hello, how are you?');
      expect(result.messages[1].role).toBe('ai');
      expect(result.messages[1].text).toBe('I am doing well, thank you!');
      expect(result.messages[2].role).toBe('user');

      // Verify progress callback was called
      expect(progressCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          state: 'SUCCESS',
          currentStrategy: 'API',
          messagesFound: 3
        })
      );

      // Verify correct API endpoint was called
      expect(fetchSpy).toHaveBeenCalledWith(
        '/backend-api/conversation/test-thread-id',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Accept': 'application/json'
          })
        })
      );
    });

    it('should return error on HTTP 404', async () => {
      const mockResponse = new Response(null, {
        status: 404,
        statusText: 'Not Found'
      });
      fetchSpy.mockResolvedValue(mockResponse);

      const result = await strategy.execute('nonexistent-thread-id');

      expect(result.strategy).toBe('API');
      expect(result.success).toBe(false);
      expect(result.isComplete).toBe(false);
      expect(result.messages).toHaveLength(0);
      expect(result.error?.message).toMatch(/404.*Not Found/);
    });

    it('should return error on HTTP 401 Unauthorized', async () => {
      const mockResponse = new Response(null, {
        status: 401,
        statusText: 'Unauthorized'
      });
      fetchSpy.mockResolvedValue(mockResponse);

      const result = await strategy.execute('test-thread-id');

      expect(result.success).toBe(false);
      expect(result.error?.message).toMatch(/401.*Unauthorized/);
    });

    it('should return error on HTTP 403 Forbidden', async () => {
      const mockResponse = new Response(null, {
        status: 403,
        statusText: 'Forbidden'
      });
      fetchSpy.mockResolvedValue(mockResponse);

      const result = await strategy.execute('test-thread-id');

      expect(result.success).toBe(false);
      expect(result.error?.message).toMatch(/403.*Forbidden/);
    });

    it('should handle network errors gracefully', async () => {
      fetchSpy.mockRejectedValue(new Error('Network error'));

      const result = await strategy.execute('test-thread-id');

      expect(result.success).toBe(false);
      expect(result.messages).toHaveLength(0);
      expect(result.error?.message).toBe('Network error');
    });

    it('should handle AbortError when signal is aborted', async () => {
      const abortController = new AbortController();
      abortController.abort();

      const result = await strategy.execute('test-thread-id', abortController.signal);

      expect(result.success).toBe(false);
      expect(result.error?.message).toMatch(/cancelled/);
    });

    it('should handle JSON parsing errors', async () => {
      const mockResponse = new Response('invalid json', {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
      fetchSpy.mockResolvedValue(mockResponse);

      const result = await strategy.execute('test-thread-id');

      expect(result.success).toBe(false);
      expect(result.messages).toHaveLength(0);
      expect(result.error).toBeDefined();
    });

    it('should handle empty conversation', async () => {
      const mockResponse = new Response(JSON.stringify({ mapping: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
      fetchSpy.mockResolvedValue(mockResponse);

      const result = await strategy.execute('test-thread-id');

      expect(result.success).toBe(false);
      expect(result.messages).toHaveLength(0);
    });

    it('should skip system messages', async () => {
      const responseWithSystem = {
        mapping: {
          'node_1': {
            message: {
              id: 'msg_1',
              author: { role: 'user' },
              content: { parts: ['Hello'] },
              create_time: 1000
            }
          },
          'node_2': {
            message: {
              id: 'msg_2',
              author: { role: 'system' },
              content: { parts: ['System message'] },
              create_time: 2000
            }
          }
        }
      };

      const mockResponse = new Response(JSON.stringify(responseWithSystem), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
      fetchSpy.mockResolvedValue(mockResponse);

      const result = await strategy.execute('test-thread-id');

      expect(result.success).toBe(true);
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe('user');
    });

    it('should skip messages without content', async () => {
      const responseWithEmpty = {
        mapping: {
          'node_1': {
            message: {
              id: 'msg_1',
              author: { role: 'user' },
              content: { parts: ['Hello'] },
              create_time: 1000
            }
          },
          'node_2': {
            message: {
              id: 'msg_2',
              author: { role: 'assistant' },
              content: { parts: [] },  // Empty parts
              create_time: 2000
            }
          },
          'node_3': {
            message: {
              id: 'msg_3',
              author: { role: 'user' },
              content: { parts: [''] },  // Whitespace only
              create_time: 3000
            }
          }
        }
      };

      const mockResponse = new Response(JSON.stringify(responseWithEmpty), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
      fetchSpy.mockResolvedValue(mockResponse);

      const result = await strategy.execute('test-thread-id');

      expect(result.success).toBe(true);
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].text).toBe('Hello');
    });

    it('should handle nodes without messages field', async () => {
      const responseWithMissingMessage = {
        mapping: {
          'node_1': {
            id: 'node_1'
            // No message field
          },
          'node_2': {
            message: {
              id: 'msg_2',
              author: { role: 'assistant' },
              content: { parts: ['Hi there'] },
              create_time: 2000
            }
          }
        }
      };

      const mockResponse = new Response(JSON.stringify(responseWithMissingMessage), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
      fetchSpy.mockResolvedValue(mockResponse);

      const result = await strategy.execute('test-thread-id');

      expect(result.success).toBe(true);
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].text).toBe('Hi there');
    });

    it('should handle multipart content', async () => {
      const responseWithMultipart = {
        mapping: {
          'node_1': {
            message: {
              id: 'msg_1',
              author: { role: 'user' },
              content: { parts: ['Part 1', 'Part 2', 'Part 3'] },
              create_time: 1000
            }
          }
        }
      };

      const mockResponse = new Response(JSON.stringify(responseWithMultipart), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
      fetchSpy.mockResolvedValue(mockResponse);

      const result = await strategy.execute('test-thread-id');

      expect(result.success).toBe(true);
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].text).toBe('Part 1\nPart 2\nPart 3');
    });

    it('should handle large conversations', async () => {
      // Generate large conversation with 100 messages
      const largeMapping: any = {};
      for (let i = 0; i < 100; i++) {
        const role = i % 2 === 0 ? 'user' : 'assistant';
        largeMapping[`node_${i}`] = {
          message: {
            id: `msg_${i}`,
            author: { role },
            content: { parts: [`Message ${i}`] },
            create_time: i * 1000
          }
        };
      }

      const mockResponse = new Response(JSON.stringify({ mapping: largeMapping }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
      fetchSpy.mockResolvedValue(mockResponse);

      const result = await strategy.execute('test-thread-id');

      expect(result.success).toBe(true);
      expect(result.messages).toHaveLength(100);
      expect(result.isComplete).toBe(true);
      
      // Verify order
      for (let i = 0; i < 100; i++) {
        expect(result.messages[i].text).toBe(`Message ${i}`);
      }
    });
  });

  describe('type property', () => {
    it('should have correct type', () => {
      expect(strategy.type).toBe('API');
    });
  });
});
