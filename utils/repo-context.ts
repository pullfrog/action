export interface RepoContext {
  owner: string;
  name: string;
}

/**
 * Resolve repository context from GITHUB_REPOSITORY environment variable.
 * Throws if not available.
 */
export function resolveRepoContext(): RepoContext {
  const githubRepo = process.env.GITHUB_REPOSITORY;
  if (!githubRepo) {
    throw new Error('GITHUB_REPOSITORY environment variable is required');
  }
  
  const [owner, name] = githubRepo.split('/');
  if (!owner || !name) {
    throw new Error(`Invalid GITHUB_REPOSITORY format: ${githubRepo}. Expected 'owner/repo'`);
  }
  
  return { owner, name };
}