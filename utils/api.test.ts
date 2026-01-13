import {
  fetchWorkflowRunInfo,
  fetchRepoSettings,
  getRepoSettings,
  DEFAULT_REPO_SETTINGS,
  type WorkflowRunInfo,
  type RepoSettings,
} from './api.ts';
import type { RepoContext } from './github.ts';

describe('api', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.useFakeTimers();
    vi.spyOn(global, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    process.env = originalEnv;
  });

  describe('fetchWorkflowRunInfo', () => {
    it('should fetch workflow run info successfully', async () => {
      const mockWorkflowRunInfo: WorkflowRunInfo = {
        progressCommentId: 'comment-123',
        issueNumber: 42,
      };

      const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => mockWorkflowRunInfo,
      } as Response);

      const result = await fetchWorkflowRunInfo('run-123');

      expect(result).toEqual(mockWorkflowRunInfo);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://pullfrog.com/api/workflow-run/run-123',
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
          signal: expect.any(AbortSignal),
        }
      );
    });

    it('should return null values when response is not ok', async () => {
      const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 404,
      } as Response);

      const result = await fetchWorkflowRunInfo('run-123');

      expect(result).toEqual({
        progressCommentId: null,
        issueNumber: null,
      });
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should return null values when fetch throws', async () => {
      const mockFetch = vi
        .spyOn(global, 'fetch')
        .mockRejectedValue(new Error('Network error'));

      const result = await fetchWorkflowRunInfo('run-123');

      expect(result).toEqual({
        progressCommentId: null,
        issueNumber: null,
      });
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should use custom API_URL from environment', async () => {
      process.env.API_URL = 'https://custom-api.com';
      const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ progressCommentId: null, issueNumber: null }),
      } as Response);

      await fetchWorkflowRunInfo('run-123');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://custom-api.com/api/workflow-run/run-123',
        expect.any(Object)
      );
    });

    it('should handle timeout', async () => {
      const mockFetch = vi.spyOn(global, 'fetch').mockImplementation(() => {
        // Simulate a fetch that gets aborted due to timeout
        return Promise.reject(new DOMException('aborted', 'AbortError'));
      });

      const promise = fetchWorkflowRunInfo('run-123');
      vi.advanceTimersByTime(30000);

      const result = await promise;

      expect(result).toEqual({
        progressCommentId: null,
        issueNumber: null,
      });
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should clear timeout on successful response', async () => {
      const mockClearTimeout = vi.spyOn(global, 'clearTimeout');
      const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ progressCommentId: null, issueNumber: null }),
      } as Response);

      await fetchWorkflowRunInfo('run-123');

      expect(mockClearTimeout).toHaveBeenCalled();
    });

    it('should clear timeout on error', async () => {
      const mockClearTimeout = vi.spyOn(global, 'clearTimeout');
      const mockFetch = vi
        .spyOn(global, 'fetch')
        .mockRejectedValue(new Error('Network error'));

      await fetchWorkflowRunInfo('run-123');

      expect(mockClearTimeout).toHaveBeenCalled();
    });
  });

  describe('fetchRepoSettings', () => {
    it('should fetch repo settings through getRepoSettings', async () => {
      const mockSettings: RepoSettings = {
        defaultAgent: 'claude',
        webAccessLevel: 'limited',
        webAccessAllowTrusted: true,
        webAccessDomains: 'example.com',
        modes: [],
      };

      const repoContext: RepoContext = {
        owner: 'test-owner',
        name: 'test-repo',
      };

      const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => mockSettings,
      } as Response);

      const result = await fetchRepoSettings({
        token: 'test-token',
        repoContext,
      });

      expect(result).toEqual(mockSettings);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://pullfrog.com/api/repo/test-owner/test-repo/settings',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        })
      );
    });
  });

  describe('getRepoSettings', () => {
    const repoContext: RepoContext = {
      owner: 'test-owner',
      name: 'test-repo',
    };

    it('should fetch repo settings successfully', async () => {
      const mockSettings: RepoSettings = {
        defaultAgent: 'claude',
        webAccessLevel: 'limited',
        webAccessAllowTrusted: true,
        webAccessDomains: 'example.com',
        modes: [
          {
            id: 'mode-1',
            name: 'Mode 1',
            description: 'Description 1',
            prompt: 'Prompt 1',
          },
        ],
      };

      const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => mockSettings,
      } as Response);

      const result = await getRepoSettings('test-token', repoContext);

      expect(result).toEqual(mockSettings);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://pullfrog.com/api/repo/test-owner/test-repo/settings',
        {
          method: 'GET',
          headers: {
            Authorization: 'Bearer test-token',
            'Content-Type': 'application/json',
          },
          signal: expect.any(AbortSignal),
        }
      );
    });

    it('should return default settings when response is not ok', async () => {
      const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 404,
      } as Response);

      const result = await getRepoSettings('test-token', repoContext);

      expect(result).toEqual(DEFAULT_REPO_SETTINGS);
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should return default settings when response is null', async () => {
      const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => null,
      } as Response);

      const result = await getRepoSettings('test-token', repoContext);

      expect(result).toEqual(DEFAULT_REPO_SETTINGS);
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should return default settings when fetch throws', async () => {
      const mockFetch = vi
        .spyOn(global, 'fetch')
        .mockRejectedValue(new Error('Network error'));

      const result = await getRepoSettings('test-token', repoContext);

      expect(result).toEqual(DEFAULT_REPO_SETTINGS);
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should use custom API_URL from environment', async () => {
      process.env.API_URL = 'https://custom-api.com';
      const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => DEFAULT_REPO_SETTINGS,
      } as Response);

      await getRepoSettings('test-token', repoContext);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://custom-api.com/api/repo/test-owner/test-repo/settings',
        expect.any(Object)
      );
    });

    it('should handle timeout', async () => {
      const mockFetch = vi.spyOn(global, 'fetch').mockImplementation(() => {
        // Simulate a fetch that gets aborted due to timeout
        return Promise.reject(new DOMException('aborted', 'AbortError'));
      });

      const promise = getRepoSettings('test-token', repoContext);
      vi.advanceTimersByTime(30000);

      const result = await promise;

      expect(result).toEqual(DEFAULT_REPO_SETTINGS);
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should clear timeout on successful response', async () => {
      const mockClearTimeout = vi.spyOn(global, 'clearTimeout');
      const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => DEFAULT_REPO_SETTINGS,
      } as Response);

      await getRepoSettings('test-token', repoContext);

      expect(mockClearTimeout).toHaveBeenCalled();
    });

    it('should clear timeout on error', async () => {
      const mockClearTimeout = vi.spyOn(global, 'clearTimeout');
      const mockFetch = vi
        .spyOn(global, 'fetch')
        .mockRejectedValue(new Error('Network error'));

      await getRepoSettings('test-token', repoContext);

      expect(mockClearTimeout).toHaveBeenCalled();
    });

    it('should include Authorization header with token', async () => {
      const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => DEFAULT_REPO_SETTINGS,
      } as Response);

      await getRepoSettings('my-secret-token', repoContext);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer my-secret-token',
          }),
        })
      );
    });
  });
});
