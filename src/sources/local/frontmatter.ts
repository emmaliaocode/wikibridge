// Minimal YAML-frontmatter splitter.
//
// We replaced `gray-matter` (which assumes Node — it touches `Buffer` at
// module load and crashes in browser contexts) with a hand-written parser
// that handles the only shape our spec needs: a leading `---` block of
// `key: value` lines terminated by another `---`. Values are treated as raw
// strings (optionally wrapped in matching quotes). Any unrecognised structure
// (nested mappings, lists, anchors, multi-line scalars) is preserved as the
// raw line's value, since v1 only consumes `title` from frontmatter.

export type FrontmatterResult = {
  data: Record<string, string>;
  body: string;
};

const DELIM_RE = /^---\s*\r?\n/;

export function parseFrontmatter(text: string): FrontmatterResult {
  if (!DELIM_RE.test(text)) {
    return { data: {}, body: text };
  }
  // Drop the opening "---\n".
  const after = text.replace(DELIM_RE, "");
  // Find the closing "---" on its own line.
  const endMatch = /\r?\n---\s*(?:\r?\n|$)/.exec(after);
  if (!endMatch) {
    // Malformed (no closing delimiter): pretend there was no frontmatter so
    // the body is rendered verbatim rather than silently swallowed.
    return { data: {}, body: text };
  }
  const yaml = after.slice(0, endMatch.index);
  const body = after.slice(endMatch.index + endMatch[0].length);
  return { data: parseYamlLines(yaml), body };
}

function parseYamlLines(yaml: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of yaml.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim();
    if (!key) continue;
    let value = line.slice(colon + 1).trim();
    // Strip a single pair of matching quotes (the spec's example wraps title
    // and sourceUrl bare, but we tolerate quoting).
    if (
      (value.startsWith(`"`) && value.endsWith(`"`)) ||
      (value.startsWith(`'`) && value.endsWith(`'`))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}
