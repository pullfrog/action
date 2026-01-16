import { Inputs } from './payload.ts';

describe('Inputs schema', () => {
  it('only prompt is required', () => {
    const result = Inputs.assert({prompt: 'test prompt'});
    expect(result).toEqual({prompt: 'test prompt'});
    expect(() => Inputs.assert({})).toThrow();
  });

  it.each([
    ['web', 'enabled'],
    ['web', 'disabled'],
    ['web', undefined],
    ['search', 'enabled'],
    ['search', 'disabled'],
    ['search', undefined],
    ['write', 'enabled'],
    ['write', 'disabled'],
    ['write', undefined],
    ['bash', 'enabled'],
    ['bash', 'restricted'],
    ['bash', 'disabled'],
    ['bash', undefined],
    ['effort', 'mini'],
    ['effort', 'auto'],
    ['effort', 'max'],
    ['agent', 'claude'],
    ['agent', 'codex'],
    ['agent', 'cursor'],
    ['agent', 'gemini'],
    ['agent', 'opencode'],
    ['agent', null],
  ] as const)('should accept %s for %s', (prop, value) => {
    const input = {prompt: 'test', [prop]: value};
    expect(() => Inputs.assert(input)).not.toThrow();
  });


  it.each([
    ['web'],
    ['search'],
    ['write'],
    ['bash'],
    ['effort'],
    ['agent'],
  ] as const)('should reject invalid %s values', (prop) => {
    const input = {prompt: 'test', [prop]: 'invalid' as any};
    expect(() => Inputs.assert(input)).toThrow();
  });

});
