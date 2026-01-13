import { reportErrorToComment } from './errorReport.ts';
import * as api from './api.ts';
import * as github from './github.ts';

describe('errorReport', () => {
  const originalEnv = process.env;
  const fetchWorkflowRunInfoSpy = vi.spyOn(api, 'fetchWorkflowRunInfo');
  const getGitHubInstallationTokenSpy = vi.spyOn(github, 'getGitHubInstallationToken');
  const parseRepoContextSpy = vi.spyOn(github, 'parseRepoContext');
  const createOctokitSpy = vi.spyOn(github, 'createOctokit');

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.PULLFROG_PROGRESS_COMMENT_ID;
    delete process.env.GITHUB_RUN_ID;
  });

  afterEach(() => {
    vi.clearAllMocks();
    process.env = originalEnv;
  });

  describe('reportErrorToComment', () => {
    it('should update comment when comment ID is in env var', async () => {
      process.env.PULLFROG_PROGRESS_COMMENT_ID = '123';
      const mockOctokit = {
        rest: {
          issues: {
            updateComment: vi.fn().mockResolvedValue({}),
          },
        },
      };
      const mockRepoContext = { owner: 'test-owner', name: 'test-repo' };

      getGitHubInstallationTokenSpy.mockReturnValue('token-123');
      parseRepoContextSpy.mockReturnValue(mockRepoContext);
      createOctokitSpy.mockReturnValue(mockOctokit as any);

      await reportErrorToComment({ error: 'Test error' });

      expect(createOctokitSpy).toHaveBeenCalledWith('token-123');
      expect(mockOctokit.rest.issues.updateComment).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        comment_id: 123,
        body: '❌ Test error',
      });
      expect(fetchWorkflowRunInfoSpy).not.toHaveBeenCalled();
    });

    it('should format error with title when provided', async () => {
      process.env.PULLFROG_PROGRESS_COMMENT_ID = '456';
      const mockOctokit = {
        rest: {
          issues: {
            updateComment: vi.fn().mockResolvedValue({}),
          },
        },
      };
      const mockRepoContext = { owner: 'test-owner', name: 'test-repo' };

      getGitHubInstallationTokenSpy.mockReturnValue('token-123');
      parseRepoContextSpy.mockReturnValue(mockRepoContext);
      createOctokitSpy.mockReturnValue(mockOctokit as any);

      await reportErrorToComment({
        error: 'Test error',
        title: 'Error Title',
      });

      expect(mockOctokit.rest.issues.updateComment).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        comment_id: 456,
        body: 'Error Title\n\nTest error',
      });
    });

    it('should fetch comment ID from database when not in env var', async () => {
      process.env.GITHUB_RUN_ID = 'run-123';
      const mockWorkflowRunInfo = {
        progressCommentId: '789',
        issueNumber: null,
      };
      const mockOctokit = {
        rest: {
          issues: {
            updateComment: vi.fn().mockResolvedValue({}),
          },
        },
      };
      const mockRepoContext = { owner: 'test-owner', name: 'test-repo' };

      fetchWorkflowRunInfoSpy.mockResolvedValue(mockWorkflowRunInfo);
      getGitHubInstallationTokenSpy.mockReturnValue('token-123');
      parseRepoContextSpy.mockReturnValue(mockRepoContext);
      createOctokitSpy.mockReturnValue(mockOctokit as any);

      await reportErrorToComment({ error: 'Test error' });

      expect(fetchWorkflowRunInfoSpy).toHaveBeenCalledWith('run-123');
      expect(process.env.PULLFROG_PROGRESS_COMMENT_ID).toBe('789');
      expect(mockOctokit.rest.issues.updateComment).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        comment_id: 789,
        body: '❌ Test error',
      });
    });

    it('should cache comment ID in env var after fetching from database', async () => {
      process.env.GITHUB_RUN_ID = 'run-456';
      const mockWorkflowRunInfo = {
        progressCommentId: '999',
        issueNumber: null,
      };
      const mockOctokit = {
        rest: {
          issues: {
            updateComment: vi.fn().mockResolvedValue({}),
          },
        },
      };
      const mockRepoContext = { owner: 'test-owner', name: 'test-repo' };

      fetchWorkflowRunInfoSpy.mockResolvedValue(mockWorkflowRunInfo);
      getGitHubInstallationTokenSpy.mockReturnValue('token-123');
      parseRepoContextSpy.mockReturnValue(mockRepoContext);
      createOctokitSpy.mockReturnValue(mockOctokit as any);

      await reportErrorToComment({ error: 'Test error' });

      expect(process.env.PULLFROG_PROGRESS_COMMENT_ID).toBe('999');
    });

    it('should return early when no comment ID is available', async () => {
      const mockOctokit = {
        rest: {
          issues: {
            updateComment: vi.fn().mockResolvedValue({}),
          },
        },
      };

      getGitHubInstallationTokenSpy.mockReturnValue('token-123');
      parseRepoContextSpy.mockReturnValue({ owner: 'test-owner', name: 'test-repo' });
      createOctokitSpy.mockReturnValue(mockOctokit as any);

      await reportErrorToComment({ error: 'Test error' });

      expect(fetchWorkflowRunInfoSpy).not.toHaveBeenCalled();
      expect(mockOctokit.rest.issues.updateComment).not.toHaveBeenCalled();
    });

    it('should return early when env var comment ID is invalid', async () => {
      process.env.PULLFROG_PROGRESS_COMMENT_ID = 'invalid';
      const mockOctokit = {
        rest: {
          issues: {
            updateComment: vi.fn().mockResolvedValue({}),
          },
        },
      };

      getGitHubInstallationTokenSpy.mockReturnValue('token-123');
      parseRepoContextSpy.mockReturnValue({ owner: 'test-owner', name: 'test-repo' });
      createOctokitSpy.mockReturnValue(mockOctokit as any);

      await reportErrorToComment({ error: 'Test error' });

      expect(fetchWorkflowRunInfoSpy).not.toHaveBeenCalled();
      expect(mockOctokit.rest.issues.updateComment).not.toHaveBeenCalled();
    });

    it('should handle database fetch failure gracefully', async () => {
      process.env.GITHUB_RUN_ID = 'run-123';
      const mockOctokit = {
        rest: {
          issues: {
            updateComment: vi.fn().mockResolvedValue({}),
          },
        },
      };

      fetchWorkflowRunInfoSpy.mockRejectedValue(new Error('Database error'));
      getGitHubInstallationTokenSpy.mockReturnValue('token-123');
      parseRepoContextSpy.mockReturnValue({ owner: 'test-owner', name: 'test-repo' });
      createOctokitSpy.mockReturnValue(mockOctokit as any);

      await reportErrorToComment({ error: 'Test error' });

      expect(fetchWorkflowRunInfoSpy).toHaveBeenCalledWith('run-123');
      expect(mockOctokit.rest.issues.updateComment).not.toHaveBeenCalled();
    });

    it('should not fetch from database when run ID is not available', async () => {
      const mockOctokit = {
        rest: {
          issues: {
            updateComment: vi.fn().mockResolvedValue({}),
          },
        },
      };

      getGitHubInstallationTokenSpy.mockReturnValue('token-123');
      parseRepoContextSpy.mockReturnValue({ owner: 'test-owner', name: 'test-repo' });
      createOctokitSpy.mockReturnValue(mockOctokit as any);

      await reportErrorToComment({ error: 'Test error' });

      expect(fetchWorkflowRunInfoSpy).not.toHaveBeenCalled();
      expect(mockOctokit.rest.issues.updateComment).not.toHaveBeenCalled();
    });

    it('should not update comment when workflow run info has no progressCommentId', async () => {
      process.env.GITHUB_RUN_ID = 'run-123';
      const mockWorkflowRunInfo = {
        progressCommentId: null,
        issueNumber: null,
      };
      const mockOctokit = {
        rest: {
          issues: {
            updateComment: vi.fn().mockResolvedValue({}),
          },
        },
      };

      fetchWorkflowRunInfoSpy.mockResolvedValue(mockWorkflowRunInfo);
      getGitHubInstallationTokenSpy.mockReturnValue('token-123');
      parseRepoContextSpy.mockReturnValue({ owner: 'test-owner', name: 'test-repo' });
      createOctokitSpy.mockReturnValue(mockOctokit as any);

      await reportErrorToComment({ error: 'Test error' });

      expect(fetchWorkflowRunInfoSpy).toHaveBeenCalledWith('run-123');
      expect(mockOctokit.rest.issues.updateComment).not.toHaveBeenCalled();
    });

    it('should not update comment when progressCommentId is not a valid number', async () => {
      process.env.GITHUB_RUN_ID = 'run-123';
      const mockWorkflowRunInfo = {
        progressCommentId: 'not-a-number',
        issueNumber: null,
      };
      const mockOctokit = {
        rest: {
          issues: {
            updateComment: vi.fn().mockResolvedValue({}),
          },
        },
      };

      fetchWorkflowRunInfoSpy.mockResolvedValue(mockWorkflowRunInfo);
      getGitHubInstallationTokenSpy.mockReturnValue('token-123');
      parseRepoContextSpy.mockReturnValue({ owner: 'test-owner', name: 'test-repo' });
      createOctokitSpy.mockReturnValue(mockOctokit as any);

      await reportErrorToComment({ error: 'Test error' });

      expect(fetchWorkflowRunInfoSpy).toHaveBeenCalledWith('run-123');
      expect(mockOctokit.rest.issues.updateComment).not.toHaveBeenCalled();
    });

    it('should prefer env var comment ID over database fetch', async () => {
      process.env.PULLFROG_PROGRESS_COMMENT_ID = '123';
      process.env.GITHUB_RUN_ID = 'run-123';
      const mockOctokit = {
        rest: {
          issues: {
            updateComment: vi.fn().mockResolvedValue({}),
          },
        },
      };
      const mockRepoContext = { owner: 'test-owner', name: 'test-repo' };

      getGitHubInstallationTokenSpy.mockReturnValue('token-123');
      parseRepoContextSpy.mockReturnValue(mockRepoContext);
      createOctokitSpy.mockReturnValue(mockOctokit as any);

      await reportErrorToComment({ error: 'Test error' });

      expect(fetchWorkflowRunInfoSpy).not.toHaveBeenCalled();
      expect(mockOctokit.rest.issues.updateComment).toHaveBeenCalledWith(
        expect.objectContaining({
          comment_id: 123,
        })
      );
    });
  });
});
