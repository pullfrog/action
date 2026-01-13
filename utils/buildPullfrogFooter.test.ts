import {
  buildPullfrogFooter,
  stripExistingFooter,
  PULLFROG_DIVIDER,
  type BuildPullfrogFooterParams,
} from './buildPullfrogFooter.ts';

describe('PULLFROG_DIVIDER', () => {
  it('should have the correct value', () => {
    expect(PULLFROG_DIVIDER).toBe('<!-- PULLFROG_DIVIDER_DO_NOT_REMOVE_PLZ -->');
  });
});

describe('buildPullfrogFooter', () => {
  it('should build footer with only default parts', () => {
    const result = buildPullfrogFooter({});

    expect(result).toContain(PULLFROG_DIVIDER);
    expect(result).toContain('[pullfrog.com](https://pullfrog.com)');
    expect(result).toContain('[𝕏](https://x.com/pullfrogai)');
    expect(result).toContain('<sup>');
  });

  it('should include "Triggered by Pullfrog" when triggeredBy is true', () => {
    const result = buildPullfrogFooter({ triggeredBy: true });

    expect(result).toContain(PULLFROG_DIVIDER);
    expect(result).toContain('Triggered by [Pullfrog](https://pullfrog.com)');
    expect(result).toContain('[pullfrog.com](https://pullfrog.com)');
    expect(result).toContain('[𝕏](https://x.com/pullfrogai)');
  });

  it('should include agent info when provided', () => {
    const agent = {
      displayName: 'Claude Code',
      url: 'https://claude.com',
    };
    const result = buildPullfrogFooter({ agent });

    expect(result).toContain(PULLFROG_DIVIDER);
    expect(result).toContain('Using [Claude Code](https://claude.com)');
    expect(result).toContain('[pullfrog.com](https://pullfrog.com)');
    expect(result).toContain('[𝕏](https://x.com/pullfrogai)');
  });

  it('should include workflow run link when provided', () => {
    const workflowRun = {
      owner: 'test-owner',
      repo: 'test-repo',
      runId: '123456',
    };
    const result = buildPullfrogFooter({ workflowRun });

    expect(result).toContain(PULLFROG_DIVIDER);
    expect(result).toContain(
      '[View workflow run](https://github.com/test-owner/test-repo/actions/runs/123456)'
    );
    expect(result).toContain('[pullfrog.com](https://pullfrog.com)');
    expect(result).toContain('[𝕏](https://x.com/pullfrogai)');
  });

  it('should include job ID in workflow run URL when provided', () => {
    const workflowRun = {
      owner: 'test-owner',
      repo: 'test-repo',
      runId: '123456',
      jobId: '789',
    };
    const result = buildPullfrogFooter({ workflowRun });

    expect(result).toContain(PULLFROG_DIVIDER);
    expect(result).toContain(
      '[View workflow run](https://github.com/test-owner/test-repo/actions/runs/123456/job/789)'
    );
  });

  it('should include custom parts when provided', () => {
    const customParts = ['[Custom Link](https://example.com)', 'Another part'];
    const result = buildPullfrogFooter({ customParts });

    expect(result).toContain(PULLFROG_DIVIDER);
    expect(result).toContain('[Custom Link](https://example.com)');
    expect(result).toContain('Another part');
    expect(result).toContain('[pullfrog.com](https://pullfrog.com)');
    expect(result).toContain('[𝕏](https://x.com/pullfrogai)');
  });

  it('should include all parts when all options are provided', () => {
    const params: BuildPullfrogFooterParams = {
      triggeredBy: true,
      agent: {
        displayName: 'Claude Code',
        url: 'https://claude.com',
      },
      workflowRun: {
        owner: 'test-owner',
        repo: 'test-repo',
        runId: '123456',
        jobId: '789',
      },
      customParts: ['[Custom](https://example.com)'],
    };
    const result = buildPullfrogFooter(params);

    expect(result).toContain(PULLFROG_DIVIDER);
    expect(result).toContain('Triggered by [Pullfrog](https://pullfrog.com)');
    expect(result).toContain('Using [Claude Code](https://claude.com)');
    expect(result).toContain('[Custom](https://example.com)');
    expect(result).toContain(
      '[View workflow run](https://github.com/test-owner/test-repo/actions/runs/123456/job/789)'
    );
    expect(result).toContain('[pullfrog.com](https://pullfrog.com)');
    expect(result).toContain('[𝕏](https://x.com/pullfrogai)');
  });

  it('should format parts with correct separators', () => {
    const result = buildPullfrogFooter({
      triggeredBy: true,
      agent: {
        displayName: 'Test Agent',
        url: 'https://test.com',
      },
    });

    expect(result).toContain(PULLFROG_DIVIDER);
    // Check that parts are separated by " ｜ "
    const partsSection = result.match(/<sup>.*<\/sup>/s)?.[0] || '';
    expect(partsSection).toContain('Triggered by [Pullfrog](https://pullfrog.com) ｜ Using [Test Agent](https://test.com) ｜ [pullfrog.com](https://pullfrog.com) ｜ [𝕏](https://x.com/pullfrogai)');
  });

  it('should include frog logo in the footer', () => {
    const result = buildPullfrogFooter({});

    expect(result).toContain(PULLFROG_DIVIDER);
    expect(result).toContain('<picture>');
    expect(result).toContain('pullfrog.com/logos/frog');
    expect(result).toContain('alt="Pullfrog"');
  });

  it('should start with PULLFROG_DIVIDER', () => {
    const result = buildPullfrogFooter({});

    expect(result.trimStart().startsWith(PULLFROG_DIVIDER)).toBe(true);
  });

  it('should handle empty customParts array', () => {
    const result = buildPullfrogFooter({ customParts: [] });

    expect(result).toContain(PULLFROG_DIVIDER);
    expect(result).toContain('[pullfrog.com](https://pullfrog.com)');
    expect(result).toContain('[𝕏](https://x.com/pullfrogai)');
    expect(result).not.toContain('Triggered by');
    expect(result).not.toContain('Using');
  });

  it('should handle multiple custom parts', () => {
    const customParts = [
      '[Link 1](https://example.com/1)',
      '[Link 2](https://example.com/2)',
      '[Link 3](https://example.com/3)',
    ];
    const result = buildPullfrogFooter({ customParts });

    expect(result).toContain(PULLFROG_DIVIDER);
    expect(result).toContain('[Link 1](https://example.com/1)');
    expect(result).toContain('[Link 2](https://example.com/2)');
    expect(result).toContain('[Link 3](https://example.com/3)');
  });
});

describe('stripExistingFooter', () => {
  it('should return body unchanged when no footer exists', () => {
    const body = 'This is a comment without a footer.';
    const result = stripExistingFooter(body);

    expect(result).toBe(body);
  });

  it('should remove footer when PULLFROG_DIVIDER is present', () => {
    const body = `This is a comment.
${PULLFROG_DIVIDER}
<sup>footer content</sup>`;
    const result = stripExistingFooter(body);

    expect(result).toBe('This is a comment.');
    expect(result).not.toContain(PULLFROG_DIVIDER);
    expect(result).not.toContain('footer content');
  });

  it('should remove footer and trim trailing whitespace', () => {
    const body = `This is a comment.    
${PULLFROG_DIVIDER}
<sup>footer content</sup>`;
    const result = stripExistingFooter(body);

    expect(result).toBe('This is a comment.');
    expect(result).not.toContain('    ');
  });

  it('should handle footer at the start of body', () => {
    const body = `${PULLFROG_DIVIDER}
<sup>footer content</sup>`;
    const result = stripExistingFooter(body);

    expect(result).toBe('');
  });

  it('should handle footer in the middle of body', () => {
    const body = `First part
${PULLFROG_DIVIDER}
<sup>footer</sup>
More content`;
    const result = stripExistingFooter(body);

    expect(result).toBe('First part');
    expect(result).not.toContain('More content');
  });

  it('should handle multiple occurrences of divider (remove from first occurrence)', () => {
    const body = `Content
${PULLFROG_DIVIDER}
<sup>footer 1</sup>
More content
${PULLFROG_DIVIDER}
<sup>footer 2</sup>`;
    const result = stripExistingFooter(body);

    expect(result).toBe('Content');
    expect(result).not.toContain('More content');
    expect(result).not.toContain('footer 1');
    expect(result).not.toContain('footer 2');
  });

  it('should preserve content before divider exactly', () => {
    const body = `Line 1
Line 2
Line 3
${PULLFROG_DIVIDER}
<sup>footer</sup>`;
    const result = stripExistingFooter(body);

    expect(result).toBe(`Line 1
Line 2
Line 3`);
  });

  it('should handle empty body', () => {
    const result = stripExistingFooter('');

    expect(result).toBe('');
  });

  it('should handle body with only footer', () => {
    const body = `${PULLFROG_DIVIDER}
<sup>footer</sup>`;
    const result = stripExistingFooter(body);

    expect(result).toBe('');
  });
});
