"use strict";

// Renamed teammate migrations may already exist under their original filenames.
// Adopt only a verified schema; never infer success from a table name alone.
const expected = require('./legacy-migration-shapes.json');
const targets = {
  '022_notifications.sql': { tables: ['notification'] },
  '023_standing_engine.sql': { tables: ['standing_change'], columns: ['warning_after_missed', 'suspension_after_missed', 'expulsion_after_missed'] },
};
const normalize = value => value.replace(/public\./g, '').replace(/\s+/g, ' ').trim();
async function shape(client, filename) {
  const target = targets[filename];
  const tables = [...target.tables, ...(target.columns ? ['constitution'] : [])];
  const {rows: columns} = await client.query(`SELECT c.relname AS table_name,a.attname AS column_name,
    format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS required,
    coalesce(pg_get_expr(d.adbin,d.adrelid),'') AS default_value
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
    LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
    WHERE n.nspname='public' AND c.relname=ANY($1::text[]) ORDER BY c.relname,a.attname`, [tables]);
  const {rows: constraints} = await client.query(`SELECT c.relname AS table_name,pg_get_constraintdef(k.oid) AS definition,k.convalidated AS validated
    FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY($1::text[])`, [tables]);
  const {rows: indexes} = await client.query(`SELECT tablename AS table_name,indexdef AS definition FROM pg_indexes WHERE schemaname='public' AND tablename=ANY($1::text[])`, [target.tables]);
  const {rows: triggers} = await client.query(`SELECT c.relname AS table_name,t.tgname AS name,t.tgenabled AS enabled,
    pg_get_triggerdef(t.oid) AS definition,p.prosrc AS body
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_proc p ON p.oid=t.tgfoid WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND NOT t.tgisinternal`, [target.tables]);
  const sort = rows => rows.map(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k,typeof v==='string'?normalize(v):v]))).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return {
    columns: sort(columns.filter(r=>r.table_name!=='constitution' || target.columns.includes(r.column_name))),
    constraints: sort(constraints.filter(r=>r.table_name!=='constitution' || /warning_after_missed|suspension_after_missed|expulsion_after_missed/.test(r.definition))),
    indexes: sort(indexes.map(r=>({...r,definition:r.definition.slice(r.definition.indexOf(' USING '))}))),
    triggers: sort(triggers),
  };
}
// PostgreSQL 18 exposes column NOT NULL constraints in pg_constraint; older
// versions expose them only through pg_attribute.attnotnull, checked in columns.
// Do not ignore unvalidated constraints: those still require investigation.
function comparable(section, rows) {
  return rows.filter(r => section !== 'constraints' ||
    !(/^NOT NULL /.test(r.definition) && r.validated === true))
    .map(r => JSON.stringify(r)).sort();
}
async function adoptExisting(client, filename) {
  if (!targets[filename]) return false;
  const actual = await shape(client, filename);
  if (!actual.columns.length) return false;
  for (const section of ['columns','constraints','indexes','triggers']) {
    const found = comparable(section, actual[section]);
    const wanted = comparable(section, expected[filename][section]);
    if (JSON.stringify(found) !== JSON.stringify(wanted)) {
      const missing = wanted.filter(row => !found.includes(row));
      const unexpected = found.filter(row => !wanted.includes(row));
      throw new Error(`${filename}: existing teammate schema differs in ${section}.` +
        `\nExpected ${wanted.length} item(s); found ${found.length}.` +
        `\nMissing expected: ${missing.length ? missing.join('\n') : '(none)'}` +
        `\nUnexpected existing: ${unexpected.length ? unexpected.join('\n') : '(none)'}` +
        '\nNo changes were made by this migration. Do not reset the database or manually mark it applied. Share this schema-only diagnostic to resolve the difference.');
    }
  }
  return true;
}
module.exports = { adoptExisting, shape };
