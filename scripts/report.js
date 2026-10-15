/**
 * Activity report — one Excel workbook covering every account.
 *
 *   npm run report                       # data/reports/activity-<date>.xlsx
 *   node scripts/report.js --out x.xlsx  # somewhere else
 *   node scripts/report.js --anonymise   # drop email and name
 *
 * Four sheets:
 *   Summary    totals across all accounts, as live formulas over Per user
 *   Per user   one row per account
 *   Daily      completions and applications by date, for a trend
 *   Notes      what each number means, and what it does not
 *
 * The Notes sheet is not padding. "Internships applied to" counts apply links
 * opened, because the app hands you to an employer's own site and never sees
 * what happens next — a number labelled without that caveat would be read as
 * submitted applications, and it is not the same thing.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import * as store from '../server/store.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const args = process.argv.slice(2);
const anonymise = args.includes('--anonymise') || args.includes('--anonymize');
const outFlag = args.indexOf('--out');
const today = new Date().toISOString().slice(0, 10);
const outPath = path.resolve(
  outFlag >= 0 && args[outFlag + 1] ? args[outFlag + 1] : path.join(root, 'data', 'reports', `activity-${today}.xlsx`),
);

const FONT = 'Arial';
const users = store.activityByUser();
const events = store.activityEvents();

const wb = new ExcelJS.Workbook();
wb.creator = 'Elevate Internships';
wb.created = new Date();

/** Header styling shared by every table. */
function styleHeader(row) {
  row.font = { name: FONT, bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
  row.alignment = { vertical: 'middle' };
  row.height = 22;
}

const shortDate = (iso) => (iso ? String(iso).slice(0, 10) : '');

// ---------------------------------------------------------------- Per user --
const perUser = wb.addWorksheet('Per user', { views: [{ state: 'frozen', ySplit: 1 }] });

const columns = [
  { header: 'Account', key: 'id', width: 10 },
  ...(anonymise ? [] : [
    { header: 'Email', key: 'email', width: 34 },
    { header: 'Name', key: 'name', width: 18 },
  ]),
  { header: 'Signed up', key: 'created_at', width: 13 },
  { header: 'Logins', key: 'login_count', width: 10 },
  { header: 'Last login', key: 'last_login_at', width: 13 },
  { header: 'Certifications completed', key: 'certifications_completed', width: 24 },
  { header: 'Internships applied to', key: 'internships_applied', width: 22 },
  { header: 'Items on ledger', key: 'ledger_items', width: 16 },
  { header: 'Last completion', key: 'last_completion_at', width: 15 },
  { header: 'Last application', key: 'last_application_at', width: 16 },
];
perUser.columns = columns;
styleHeader(perUser.getRow(1));

for (const u of users) {
  perUser.addRow({
    ...u,
    created_at: shortDate(u.created_at),
    last_login_at: shortDate(u.last_login_at),
    last_completion_at: shortDate(u.last_completion_at),
    last_application_at: shortDate(u.last_application_at),
  });
}

perUser.eachRow((row, i) => {
  if (i === 1) return;
  row.font = { name: FONT };
});
if (users.length) perUser.autoFilter = { from: 'A1', to: { row: 1, column: columns.length } };

/** Column letter for a key on the Per user sheet, so formulas cannot drift. */
const colLetter = (key) => {
  const idx = columns.findIndex((c) => c.key === key);
  return perUser.getColumn(idx + 1).letter;
};
const lastRow = users.length + 1;
const sumOf = (key) =>
  users.length ? `SUM('Per user'!${colLetter(key)}2:${colLetter(key)}${lastRow})` : '0';

// ----------------------------------------------------------------- Summary --
const summary = wb.addWorksheet('Summary');
summary.getColumn(1).width = 34;
summary.getColumn(2).width = 16;

summary.addRow(['Elevate Internships — activity']).font = { name: FONT, bold: true, size: 16 };
summary.addRow([`Generated ${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC`]).font = {
  name: FONT, italic: true, color: { argb: 'FF5B6B80' },
};
summary.addRow([]);

const head = summary.addRow(['Metric', 'Total']);
styleHeader(head);

// Totals are formulas over the Per user sheet, so editing or extending that
// sheet keeps these honest rather than freezing today's number in place.
const rows = [
  ['Accounts created', users.length ? `COUNTA('Per user'!A2:A${lastRow})` : '0'],
  ['Logins', sumOf('login_count')],
  ['Certifications completed', sumOf('certifications_completed')],
  ['Internships applied to', sumOf('internships_applied')],
  ['Items added to ledgers', sumOf('ledger_items')],
];
for (const [label, formula] of rows) {
  const r = summary.addRow([label]);
  r.font = { name: FONT };
  r.getCell(2).value = { formula, result: undefined };
  r.getCell(2).font = { name: FONT, bold: true };
  r.getCell(2).numFmt = '#,##0';
}

summary.addRow([]);
const avg = summary.addRow(['Average per account']);
avg.font = { name: FONT, bold: true };
for (const [label, key] of [
  ['Logins per account', 'login_count'],
  ['Certifications per account', 'certifications_completed'],
  ['Internships per account', 'internships_applied'],
]) {
  const r = summary.addRow([label]);
  r.font = { name: FONT };
  // Guarded: no accounts means no division.
  r.getCell(2).value = {
    formula: users.length ? `IFERROR(${sumOf(key)}/COUNTA('Per user'!A2:A${lastRow}),0)` : '0',
    result: undefined,
  };
  r.getCell(2).numFmt = '0.0';
  r.getCell(2).font = { name: FONT };
}

if (!users.length) {
  summary.addRow([]);
  const note = summary.addRow(['No accounts yet — every total above is zero.']);
  note.font = { name: FONT, italic: true, color: { argb: 'FF8A5308' } };
}

// ------------------------------------------------------------------- Daily --
const daily = wb.addWorksheet('Daily', { views: [{ state: 'frozen', ySplit: 1 }] });
daily.columns = [
  { header: 'Date', key: 'date', width: 14 },
  { header: 'Certifications completed', key: 'certs', width: 24 },
  { header: 'Internships applied to', key: 'apps', width: 22 },
];
styleHeader(daily.getRow(1));

const byDay = new Map();
for (const e of events) {
  const d = shortDate(e.at);
  if (!d) continue;
  if (!byDay.has(d)) byDay.set(d, { certs: 0, apps: 0 });
  byDay.get(d)[e.kind === 'certification' ? 'certs' : 'apps'] += 1;
}
for (const date of [...byDay.keys()].sort()) {
  const row = daily.addRow({ date, ...byDay.get(date) });
  row.font = { name: FONT };
}
if (!byDay.size) {
  const r = daily.addRow({ date: 'No activity recorded yet' });
  r.font = { name: FONT, italic: true, color: { argb: 'FF8A5308' } };
}

// ------------------------------------------------------------------- Notes --
const notes = wb.addWorksheet('Notes');
notes.getColumn(1).width = 30;
notes.getColumn(2).width = 96;

notes.addRow(['How to read this report']).font = { name: FONT, bold: true, size: 14 };
notes.addRow([]);
const nh = notes.addRow(['Metric', 'What it counts']);
styleHeader(nh);

const definitions = [
  ['Accounts created', 'Every account currently in the database. Deleted accounts are gone entirely and are not counted.'],
  ['Logins', 'Times a session was started: password sign-in, sign-up, and a sign-in that followed a password reset. Counted per account, not per device.'],
  ['Certifications completed', 'Items a person ticked off their ledger. Self-reported — the app cannot confirm a course was finished with the provider.'],
  ['Internships applied to', 'Apply links opened. The app hands you to the employer\'s own site and cannot see what happens there, so this counts applications STARTED, not submitted. Repeat clicks on the same posting count once.'],
  ['Items added to ledgers', 'Certifications on a ledger, whether or not completed.'],
  ['Last login / completion / application', 'Most recent date for that account. Blank means it has not happened.'],
];
for (const [term, meaning] of definitions) {
  const r = notes.addRow([term, meaning]);
  r.font = { name: FONT };
  r.getCell(1).font = { name: FONT, bold: true };
  r.getCell(2).alignment = { wrapText: true, vertical: 'top' };
  r.height = 32;
}

notes.addRow([]);
const limits = notes.addRow(['Limitations']);
limits.font = { name: FONT, bold: true, size: 12 };
for (const line of [
  'Guests are not included. Anyone who has not made an account keeps their ledger in their own browser, and none of it reaches the server.',
  'Login history starts from when login counting was added; sessions before that left no record, because the sessions table only holds live sessions.',
  'An apply click is not proof of an application, and a completion is not proof of a certificate.',
]) {
  const r = notes.addRow(['', line]);
  r.font = { name: FONT };
  r.getCell(2).alignment = { wrapText: true, vertical: 'top' };
  r.height = 30;
}

notes.addRow([]);
const priv = notes.addRow(['Personal data']);
priv.font = { name: FONT, bold: true, size: 12 };
const privLine = notes.addRow([
  '',
  anonymise
    ? 'Generated with --anonymise: no email addresses or names are included.'
    : 'This file contains email addresses. It is personal data — store it accordingly, and do not circulate it more widely than needed. Run with --anonymise to leave identities out.',
]);
privLine.font = { name: FONT, bold: !anonymise, color: { argb: anonymise ? 'FF475569' : 'FF8A5308' } };
privLine.getCell(2).alignment = { wrapText: true, vertical: 'top' };
privLine.height = 34;

// -------------------------------------------------------------------- write --
fs.mkdirSync(path.dirname(outPath), { recursive: true });
await wb.xlsx.writeFile(outPath);

const totals = users.reduce(
  (a, u) => ({
    logins: a.logins + (u.login_count || 0),
    certs: a.certs + (u.certifications_completed || 0),
    apps: a.apps + (u.internships_applied || 0),
  }),
  { logins: 0, certs: 0, apps: 0 },
);

console.log(`Wrote ${path.relative(root, outPath)}`);
console.log(`  accounts                 ${users.length}`);
console.log(`  logins                   ${totals.logins}`);
console.log(`  certifications completed ${totals.certs}`);
console.log(`  internships applied to   ${totals.apps}`);
if (!anonymise) console.log('  (includes email addresses — run with --anonymise to omit)');
