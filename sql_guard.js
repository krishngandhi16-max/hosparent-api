// Guard for the agent's `run_readonly_sql` tool.
//
// The READ ONLY transaction in db.js is the real enforcement layer; this is
// defense-in-depth so obviously-bad SQL never reaches the driver. It:
//   1. allows only a SINGLE statement (no `;` separators),
//   2. requires it to start with SELECT or WITH,
//   3. blocks write/DDL/dangerous keywords anywhere in the text.
// On any violation it throws; callers should surface the message to the model.

const FORBIDDEN = /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|call|do|merge|vacuum|reindex|comment|lock|nextval|setval|dblink|pg_read_file|pg_sleep|pg_ls_dir|lo_import|lo_export)\b/i;

function assertReadOnlySelect(sql) {
  const trimmed = String(sql == null ? '' : sql).trim();
  if (!trimmed) throw new Error('empty query');

  // strip a single trailing semicolon, then forbid any remaining separators
  const single = trimmed.replace(/;\s*$/, '');
  if (single.includes(';')) throw new Error('only a single statement is allowed');

  if (!/^(select|with)\b/i.test(single)) {
    throw new Error('only SELECT / WITH (read-only) queries are allowed');
  }
  if (FORBIDDEN.test(single)) {
    throw new Error('query contains a forbidden (write/DDL/dangerous) keyword');
  }
  return single;
}

module.exports = { assertReadOnlySelect };
