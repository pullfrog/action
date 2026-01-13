import { redactSecrets, containsSecrets } from './secrets.ts';
import * as github from './github.ts';

vi.mock('../external.ts', () => ({
  agentsManifest: {
    claude: {
      displayName: 'Claude Code',
      apiKeyNames: ['ANTHROPIC_API_KEY'],
      url: 'https://claude.com/claude-code',
    },
    codex: {
      displayName: 'Codex CLI',
      apiKeyNames: ['OPENAI_API_KEY'],
      url: 'https://platform.openai.com/docs/guides/codex',
    },
    opencode: {
      displayName: 'OpenCode',
      apiKeyNames: [],
      url: 'https://opencode.ai',
    },
  },
}));

describe('secrets', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.spyOn(github, 'getGitHubInstallationToken').mockImplementation(() => {
      throw new Error('Token not set');
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = originalEnv;
  });

  describe('redactSecrets', () => {
    it('should return content unchanged when no secrets are present', () => {
      const content = 'This is a normal message without secrets';
      expect(redactSecrets(content)).toBe(content);
    });

    it('should redact provided secrets', () => {
      const content = 'My API key is secret123';
      const secrets = ['secret123'];
      const result = redactSecrets(content, secrets);

      expect(result).toBe('My API key is [REDACTED_SECRET]');
      expect(result).not.toContain('secret123');
    });

    it('should redact multiple occurrences of the same secret', () => {
      const content = 'secret123 is used here and secret123 is used there';
      const secrets = ['secret123'];
      const result = redactSecrets(content, secrets);

      expect(result).toBe(
        '[REDACTED_SECRET] is used here and [REDACTED_SECRET] is used there'
      );
      expect(result).not.toContain('secret123');
    });

    it('should redact multiple different secrets', () => {
      const content = 'Key1 is secret1 and Key2 is secret2';
      const secrets = ['secret1', 'secret2'];
      const result = redactSecrets(content, secrets);

      expect(result).toBe('Key1 is [REDACTED_SECRET] and Key2 is [REDACTED_SECRET]');
      expect(result).not.toContain('secret1');
      expect(result).not.toContain('secret2');
    });

    it('should redact secrets from environment variables', () => {
      process.env.ANTHROPIC_API_KEY = 'env-secret-key';
      const content = 'The key is env-secret-key';

      const result = redactSecrets(content);

      expect(result).toBe('The key is [REDACTED_SECRET]');
      expect(result).not.toContain('env-secret-key');
    });

    it('should redact secrets from multiple agent API keys', () => {
      process.env.ANTHROPIC_API_KEY = 'anthropic-key';
      process.env.OPENAI_API_KEY = 'openai-key';
      const content = 'Keys: anthropic-key and openai-key';

      const result = redactSecrets(content);

      expect(result).toBe('Keys: [REDACTED_SECRET] and [REDACTED_SECRET]');
      expect(result).not.toContain('anthropic-key');
      expect(result).not.toContain('openai-key');
    });

    it('should redact OpenCode API_KEY environment variables', () => {
      process.env.SOME_API_KEY = 'opencode-key-1';
      process.env.ANOTHER_API_KEY = 'opencode-key-2';
      const content = 'OpenCode keys: opencode-key-1 and opencode-key-2';

      const result = redactSecrets(content);

      expect(result).toBe('OpenCode keys: [REDACTED_SECRET] and [REDACTED_SECRET]');
      expect(result).not.toContain('opencode-key-1');
      expect(result).not.toContain('opencode-key-2');
    });

    it('should redact GitHub installation token', () => {
      const token = 'github-token-123';
      vi.spyOn(github, 'getGitHubInstallationToken').mockReturnValue(token);
      const content = 'Token is github-token-123';

      const result = redactSecrets(content);

      expect(result).toBe('Token is [REDACTED_SECRET]');
      expect(result).not.toContain('github-token-123');
    });

    it('should combine provided secrets with environment secrets', () => {
      process.env.ANTHROPIC_API_KEY = 'env-key';
      const content = 'Keys: env-key and provided-key';
      const providedSecrets = ['provided-key'];

      const result = redactSecrets(content, providedSecrets);

      expect(result).toBe('Keys: [REDACTED_SECRET] and [REDACTED_SECRET]');
      expect(result).not.toContain('env-key');
      expect(result).not.toContain('provided-key');
    });

    it('should handle secrets with special regex characters', () => {
      const secrets = ['secret.key', 'secret+key', 'secret*key', 'secret(key)'];
      const content = 'Keys: secret.key, secret+key, secret*key, secret(key)';

      const result = redactSecrets(content, secrets);

      expect(result).toBe(
        'Keys: [REDACTED_SECRET], [REDACTED_SECRET], [REDACTED_SECRET], [REDACTED_SECRET]'
      );
      expect(result).not.toContain('secret.key');
      expect(result).not.toContain('secret+key');
      expect(result).not.toContain('secret*key');
      expect(result).not.toContain('secret(key)');
    });

    it('should handle empty secrets array', () => {
      const content = 'This is a normal message';
      const result = redactSecrets(content, []);

      expect(result).toBe(content);
    });

    it('should handle empty string secrets', () => {
      const content = 'This is a normal message';
      const secrets = ['', 'valid-secret'];
      const result = redactSecrets(content, secrets);

      expect(result).toBe(content);
    });

    it('should ignore errors when getGitHubInstallationToken throws', () => {
      vi.spyOn(github, 'getGitHubInstallationToken').mockImplementation(() => {
        throw new Error('Token not available');
      });
      const content = 'This is a normal message';

      expect(() => redactSecrets(content)).not.toThrow();
      expect(redactSecrets(content)).toBe(content);
    });
  });

  describe('containsSecrets', () => {
    it('should return false when no secrets are present', () => {
      const content = 'This is a normal message without secrets';
      expect(containsSecrets(content)).toBe(false);
    });

    it('should return true when provided secret is present', () => {
      const content = 'My API key is secret123';
      const secrets = ['secret123'];
      expect(containsSecrets(content, secrets)).toBe(true);
    });

    it('should return false when provided secret is not present', () => {
      const content = 'This is a normal message';
      const secrets = ['secret123'];
      expect(containsSecrets(content, secrets)).toBe(false);
    });

    it('should return true when any of multiple secrets is present', () => {
      const content = 'Key is secret1';
      const secrets = ['secret1', 'secret2'];
      expect(containsSecrets(content, secrets)).toBe(true);
    });

    it('should return false when none of multiple secrets are present', () => {
      const content = 'This is a normal message';
      const secrets = ['secret1', 'secret2'];
      expect(containsSecrets(content, secrets)).toBe(false);
    });

    it('should detect secrets from environment variables', () => {
      process.env.ANTHROPIC_API_KEY = 'env-secret-key';
      const content = 'The key is env-secret-key';

      expect(containsSecrets(content)).toBe(true);
    });

    it('should not detect secrets when environment variable is not in content', () => {
      process.env.ANTHROPIC_API_KEY = 'env-secret-key';
      const content = 'This is a normal message';

      expect(containsSecrets(content)).toBe(false);
    });

    it('should detect secrets from multiple agent API keys', () => {
      process.env.ANTHROPIC_API_KEY = 'anthropic-key';
      process.env.OPENAI_API_KEY = 'openai-key';
      const content = 'Keys: anthropic-key and openai-key';

      expect(containsSecrets(content)).toBe(true);
    });

    it('should detect OpenCode API_KEY environment variables', () => {
      process.env.SOME_API_KEY = 'opencode-key';
      const content = 'OpenCode key: opencode-key';

      expect(containsSecrets(content)).toBe(true);
    });

    it('should detect GitHub installation token', () => {
      const token = 'github-token-123';
      vi.spyOn(github, 'getGitHubInstallationToken').mockReturnValue(token);
      const content = 'Token is github-token-123';

      expect(containsSecrets(content)).toBe(true);
    });

    it('should not detect GitHub installation token when not in content', () => {
      const token = 'github-token-123';
      vi.spyOn(github, 'getGitHubInstallationToken').mockReturnValue(token);
      const content = 'This is a normal message';

      expect(containsSecrets(content)).toBe(false);
    });

    it('should use only provided secrets when provided', () => {
      process.env.ANTHROPIC_API_KEY = 'env-key';
      const content = 'Key is env-key';
      const providedSecrets = ['other-key'];

      // When secrets are provided, getAllSecrets() is not called
      // So it should only check provided secrets
      expect(containsSecrets(content, providedSecrets)).toBe(false);
    });

    it('should use environment secrets when no secrets provided', () => {
      process.env.ANTHROPIC_API_KEY = 'env-key';
      const content = 'Key is env-key';

      // When secrets are not provided, getAllSecrets() is called
      expect(containsSecrets(content)).toBe(true);
    });

    it('should handle empty secrets array', () => {
      const content = 'This is a normal message';
      expect(containsSecrets(content, [])).toBe(false);
    });

    it('should handle empty string secrets', () => {
      const content = 'This is a normal message';
      const secrets = ['', 'valid-secret'];
      expect(containsSecrets(content, secrets)).toBe(false);
    });

    it('should return true when empty string secret is in content', () => {
      const content = 'This is a normal message';
      const secrets = ['', 'normal'];
      expect(containsSecrets(content, secrets)).toBe(true);
    });

    it('should ignore errors when getGitHubInstallationToken throws', () => {
      vi.spyOn(github, 'getGitHubInstallationToken').mockImplementation(() => {
        throw new Error('Token not available');
      });
      const content = 'This is a normal message';

      expect(() => containsSecrets(content)).not.toThrow();
      expect(containsSecrets(content)).toBe(false);
    });

    it('should handle partial secret matches correctly', () => {
      const content = 'The secret key is secret123';
      const secrets = ['secret123'];
      expect(containsSecrets(content, secrets)).toBe(true);
    });

    it('should not match partial strings that are not exact secrets', () => {
      const content = 'The secret key is secret123';
      const secrets = ['secret1234'];
      expect(containsSecrets(content, secrets)).toBe(false);
    });
  });
});
