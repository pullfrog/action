import { log } from "./cli.ts";

/**
 * Normalize environment variables to uppercase.
 * This handles case-insensitive env var names (e.g., `anthropic_api_key` -> `ANTHROPIC_API_KEY`).
 *
 * If there are conflicts (same key with different capitalizations but different values),
 * logs a warning and keeps the uppercase version.
 */
export function normalizeEnv(): void {
  const upperKeys = new Map<string, string[]>();

  // group keys by their uppercase form
  for (const key of Object.keys(process.env)) {
    const upper = key.toUpperCase();
    const existing = upperKeys.get(upper) || [];
    existing.push(key);
    upperKeys.set(upper, existing);
  }

  // process each group
  for (const [upperKey, keys] of upperKeys) {
    if (keys.length === 1) {
      const key = keys[0];
      if (key !== upperKey) {
        // single key, just needs uppercasing
        process.env[upperKey] = process.env[key];
        delete process.env[key];
      }
      continue;
    }

    // multiple keys with different capitalizations
    const values = keys.map((k) => process.env[k]);
    const uniqueValues = new Set(values);

    if (uniqueValues.size > 1) {
      // conflict: different values for different capitalizations
      log.warning(
        `env var conflict: ${keys.join(", ")} have different values. using uppercase ${upperKey}.`
      );
    }

    // prefer the uppercase version if it exists, otherwise use the first one
    const preferredKey = keys.find((k) => k === upperKey) || keys[0];
    const preferredValue = process.env[preferredKey];

    // delete all variants
    for (const key of keys) {
      delete process.env[key];
    }

    // set the uppercase version
    process.env[upperKey] = preferredValue;
  }
}
