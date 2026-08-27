/**
 * Pull table references out of a blob of SQL.
 *
 * Matches are only kept when the name exists in the DDL set — that filter is
 * what removes aliases, CTE names, derived tables and keyword noise from what
 * is otherwise a deliberately loose set of regexes.
 */

const READ_PATTERNS = [
  /\bfrom\s+`?([A-Za-z_$][\w$]*)`?/gi,
  /\b(?:straight_)?join\s+`?([A-Za-z_$][\w$]*)`?/gi,
];
const WRITE_PATTERNS = [
  /\binsert\s+(?:ignore\s+)?into\s+`?([A-Za-z_$][\w$]*)`?/gi,
  /\breplace\s+into\s+`?([A-Za-z_$][\w$]*)`?/gi,
  /\bupdate\s+`?([A-Za-z_$][\w$]*)`?/gi,
  /\bdelete\s+from\s+`?([A-Za-z_$][\w$]*)`?/gi,
];

/** Strip comments and placeholders; mark interpolated table names as dynamic. */
export function normalizeSql(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/#\{[^}]*\}/g, '?')
    .replace(/\$\{[^}]*\}/g, ' __DYNAMIC__ ');
}

function collect(sql, patterns, known, out) {
  for (const re of patterns) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(sql)) !== null) {
      const name = m[1].toUpperCase();
      if (known.has(name)) out.add(name);
    }
  }
}

export function extractTableRefs(sql, knownTables) {
  const reads = new Set();
  const writes = new Set();
  collect(sql, READ_PATTERNS, knownTables, reads);
  collect(sql, WRITE_PATTERNS, knownTables, writes);
  // A table written to is not also reported as read via its own UPDATE/DELETE clause.
  for (const t of writes) reads.delete(t);
  return { reads: [...reads], writes: [...writes], hasDynamicTable: sql.includes('__DYNAMIC__') };
}
