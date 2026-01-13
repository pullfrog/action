import { retry, type RetryOptions } from './retry.ts';
import * as cli from './cli.ts';

describe('retry', () => {
  const logWarningSpy = vi.spyOn(cli.log, 'warning').mockImplementation(() => {}); // mute

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  describe('successful execution', () => {
    it('should return result on first attempt', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      const result = await retry(fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
      expect(cli.log.warning).not.toHaveBeenCalled();
    });

    it('should return result after retries', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('fetch failed'))
        .mockRejectedValueOnce(new Error('fetch failed'))
        .mockResolvedValue('success');

      const promise = retry(fn);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
      expect(cli.log.warning).toHaveBeenCalledTimes(2);
    });
  });

  describe('failure handling', () => {
    it('should throw error after all retries exhausted', async () => {
      const error = new Error('fetch failed');
      const fn = vi.fn().mockRejectedValue(error);

      const promise = retry(fn, { maxAttempts: 3 });
      const expectPromise = expect(promise).rejects.toThrow('fetch failed');
      await vi.runAllTimersAsync();
      await expectPromise;

      expect(fn).toHaveBeenCalledTimes(3);
      expect(cli.log.warning).toHaveBeenCalledTimes(2);
    });

    it('should throw immediately if shouldRetry returns false', async () => {
      const error = new Error('permanent error');
      const fn = vi.fn().mockRejectedValue(error);

      const promise = retry(fn, { maxAttempts: 3 });
      const expectPromise = expect(promise).rejects.toThrow('permanent error');
      await vi.runAllTimersAsync();
      await expectPromise;

      expect(fn).toHaveBeenCalledTimes(1);
      expect(cli.log.warning).not.toHaveBeenCalled();
    });
  });

  describe('default shouldRetry logic', () => {
    it('should retry on AbortError', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new DOMException('aborted', 'AbortError'))
        .mockResolvedValue('success');

      const promise = retry(fn);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should retry on "fetch failed" error', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('fetch failed'))
        .mockResolvedValue('success');

      const promise = retry(fn);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should retry on ECONNRESET error', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        .mockResolvedValue('success');

      const promise = retry(fn);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should retry on ETIMEDOUT error', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('ETIMEDOUT'))
        .mockResolvedValue('success');

      const promise = retry(fn);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should not retry on non-Error objects', async () => {
      const fn = vi.fn().mockRejectedValue('string error');

      const promise = retry(fn);
      const expectPromise = expect(promise).rejects.toBe('string error');
      await vi.runAllTimersAsync();
      await expectPromise;

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should not retry on errors that do not match retry conditions', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('permanent failure'));

      const promise = retry(fn);
      const expectPromise = expect(promise).rejects.toThrow('permanent failure');
      await vi.runAllTimersAsync();
      await expectPromise;

      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('custom options', () => {
    it('should use custom maxAttempts', async () => {
      const fn = vi
        .fn()
        .mockRejectedValue(new Error('fetch failed'))
        .mockRejectedValue(new Error('fetch failed'))
        .mockRejectedValue(new Error('fetch failed'))
        .mockRejectedValue(new Error('fetch failed'))
        .mockRejectedValue(new Error('fetch failed'));

      const promise = retry(fn, { maxAttempts: 5 });
      const expectPromise = expect(promise).rejects.toThrow('fetch failed');
      await vi.runAllTimersAsync();
      await expectPromise;

      expect(fn).toHaveBeenCalledTimes(5);
      expect(cli.log.warning).toHaveBeenCalledTimes(4);
    });

    it('should use custom delayMs', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('fetch failed'))
        .mockResolvedValue('success');

      const promise = retry(fn, { delayMs: 500 });
      await vi.advanceTimersByTimeAsync(500);
      const result = await promise;

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should use exponential backoff (delayMs * attempt)', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('fetch failed'))
        .mockRejectedValueOnce(new Error('fetch failed'))
        .mockResolvedValue('success');

      const promise = retry(fn, { delayMs: 100 });
      
      // First retry should wait 100ms (delayMs * 1)
      await vi.advanceTimersByTimeAsync(100);
      expect(fn).toHaveBeenCalledTimes(2);
      
      // Second retry should wait 200ms (delayMs * 2)
      await vi.advanceTimersByTimeAsync(200);
      expect(fn).toHaveBeenCalledTimes(3);
      
      const result = await promise;
      expect(result).toBe('success');
    });

    it('should use custom shouldRetry function', async () => {
      const customShouldRetry = vi.fn((error: unknown) => {
        return error instanceof Error && error.message.includes('retry me');
      });

      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('retry me'))
        .mockResolvedValue('success');

      const promise = retry(fn, { shouldRetry: customShouldRetry });
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
      expect(customShouldRetry).toHaveBeenCalled();
    });

    it('should use custom label in log messages', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('fetch failed'))
        .mockResolvedValue('success');

      const promise = retry(fn, { label: 'custom operation' });
      await vi.runAllTimersAsync();
      await promise;

      expect(cli.log.warning).toHaveBeenCalledWith(
        expect.stringContaining('custom operation')
      );
    });
  });

  describe('log messages', () => {
    it('should log warning with correct format on retry', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('fetch failed'))
        .mockResolvedValue('success');

      const promise = retry(fn, { maxAttempts: 3, delayMs: 100, label: 'test' });
      await vi.runAllTimersAsync();
      await promise;

      expect(cli.log.warning).toHaveBeenCalledWith(
        '» test failed (attempt 1/3), retrying in 100ms...'
      );
    });

    it('should not log on final failure', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('fetch failed'));

      const promise = retry(fn, { maxAttempts: 2 });
      const expectPromise = expect(promise).rejects.toThrow();
      await vi.runAllTimersAsync();
      await expectPromise;

      // Should only log once (for attempt 1, not for attempt 2 which is the final one)
      expect(cli.log.warning).toHaveBeenCalledTimes(1);
    });
  });
});
