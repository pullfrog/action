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
  const fetchSpy = vi.spyOn(global, 'fetch');

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    process.env = originalEnv;
  });

  describe('fetchWorkflowRunInfo', () => {
    it('should fetch workflow run info successfully', async () => {
      const mockWorkflowRunInfo: WorkflowRunInfo = {
        progressCommentId: 'comment-123',
        issueNumber: 42,
      };

      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => mockWorkflowRunInfo,
      } as Response);

      const result = await fetchWorkflowRunInfo('run-123');

      expect(result).toEqual(mockWorkflowRunInfo);
      expect(fetchSpy).toHaveBeenCalledWith(
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
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 404,
      } as Response);

      const result = await fetchWorkflowRunInfo('run-123');

      expect(result).toEqual({
        progressCommentId: null,
        issueNumber: null,
      });
      expect(fetchSpy).toHaveBeenCalled();
    });

    it('should return null values when fetch throws', async () => {
      fetchSpy.mockRejectedValue(new Error('Network error'));

      const result = await fetchWorkflowRunInfo('run-123');

      expect(result).toEqual({
        progressCommentId: null,
        issueNumber: null,
      });
      expect(fetchSpy).toHaveBeenCalled();
    });

    it('should use custom API_URL from environment', async () => {
      process.env.API_URL = 'https://custom-api.com';
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({ progressCommentId: null, issueNumber: null }),
      } as Response);

      await fetchWorkflowRunInfo('run-123');

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://custom-api.com/api/workflow-run/run-123',
        expect.any(Object)
      );
    });

    it('should handle timeout', async () => {
      fetchSpy.mockImplementation(() => {
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
      expect(fetchSpy).toHaveBeenCalled();
    });

    it('should clear timeout on successful response', async () => {
      const mockClearTimeout = vi.spyOn(global, 'clearTimeout');
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({ progressCommentId: null, issueNumber: null }),
      } as Response);

      await fetchWorkflowRunInfo('run-123');

      expect(mockClearTimeout).toHaveBeenCalled();
    });

    it('should clear timeout on error', async () => {
      const mockClearTimeout = vi.spyOn(global, 'clearTimeout');
      fetchSpy.mockRejectedValue(new Error('Network error'));

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

      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => mockSettings,
      } as Response);

      const result = await fetchRepoSettings({
        token: 'test-token',
        repoContext,
      });

      expect(result).toEqual(mockSettings);
      expect(fetchSpy).toHaveBeenCalledWith(
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

      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => mockSettings,
      } as Response);

      const result = await getRepoSettings('test-token', repoContext);

      expect(result).toEqual(mockSettings);
      expect(fetchSpy).toHaveBeenCalledWith(
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
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 404,
      } as Response);

      const result = await getRepoSettings('test-token', repoContext);

      expect(result).toEqual(DEFAULT_REPO_SETTINGS);
      expect(fetchSpy).toHaveBeenCalled();
    });

    it('should return default settings when response is null', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => null,
      } as Response);

      const result = await getRepoSettings('test-token', repoContext);

      expect(result).toEqual(DEFAULT_REPO_SETTINGS);
      expect(fetchSpy).toHaveBeenCalled();
    });

    it('should return default settings when fetch throws', async () => {
      fetchSpy.mockRejectedValue(new Error('Network error'));

      const result = await getRepoSettings('test-token', repoContext);

      expect(result).toEqual(DEFAULT_REPO_SETTINGS);
      expect(fetchSpy).toHaveBeenCalled();
    });

    it('should use custom API_URL from environment', async () => {
      process.env.API_URL = 'https://custom-api.com';
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => DEFAULT_REPO_SETTINGS,
      } as Response);

      await getRepoSettings('test-token', repoContext);

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://custom-api.com/api/repo/test-owner/test-repo/settings',
        expect.any(Object)
      );
    });

    it('should handle timeout', async () => {
      fetchSpy.mockImplementation(() => {
        // Simulate a fetch that gets aborted due to timeout
        return Promise.reject(new DOMException('aborted', 'AbortError'));
      });

      const promise = getRepoSettings('test-token', repoContext);
      vi.advanceTimersByTime(30000);

      const result = await promise;

      expect(result).toEqual(DEFAULT_REPO_SETTINGS);
      expect(fetchSpy).toHaveBeenCalled();
    });

    it('should clear timeout on successful response', async () => {
      const mockClearTimeout = vi.spyOn(global, 'clearTimeout');
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => DEFAULT_REPO_SETTINGS,
      } as Response);

      await getRepoSettings('test-token', repoContext);

      expect(mockClearTimeout).toHaveBeenCalled();
    });

    it('should clear timeout on error', async () => {
      const mockClearTimeout = vi.spyOn(global, 'clearTimeout');
      fetchSpy.mockRejectedValue(new Error('Network error'));

      await getRepoSettings('test-token', repoContext);

      expect(mockClearTimeout).toHaveBeenCalled();
    });

    it('should include Authorization header with token', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => DEFAULT_REPO_SETTINGS,
      } as Response);

      await getRepoSettings('my-secret-token', repoContext);

      expect(fetchSpy).toHaveBeenCalledWith(
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
