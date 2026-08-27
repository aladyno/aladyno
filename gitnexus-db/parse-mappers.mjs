/**
 * Parse MyBatis mapper XML into { namespace, statements[] }, where each
 * statement carries the tables it reads and writes.
 */
import { readFileSync } from 'node:fs';
import { extractTableRefs, normalizeSql } from './extract-tables.mjs';

const STATEMENT = /<(select|insert|update|delete)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi;

/** Drop XML comments and dynamic-SQL tags, keeping their inner text. */
function toSql(fragment) {
  return normalizeSql(
    fragment
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<[^>]+>/g, ' '),
  );
}

export function parseMapperFile(absPath, repoRelPath, knownTables) {
  const xml = readFileSync(absPath, 'utf8');
  const namespace = /<mapper\s+namespace\s*=\s*"([^"]+)"/i.exec(xml)?.[1];
  if (!namespace) return null;

  const statements = [];
  STATEMENT.lastIndex = 0;
  let m;
  while ((m = STATEMENT.exec(xml)) !== null) {
    const [, kind, attrs, inner] = m;
    const id = /\bid\s*=\s*"([^"]+)"/i.exec(attrs)?.[1];
    if (!id) continue;

    const { reads, writes, hasDynamicTable } = extractTableRefs(toSql(inner), knownTables);
    statements.push({ id, kind: kind.toLowerCase(), reads, writes, hasDynamicTable });
  }

  return { namespace, xmlPath: repoRelPath, statements };
}
