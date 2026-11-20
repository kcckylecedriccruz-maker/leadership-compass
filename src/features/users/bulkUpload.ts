import readXlsxFile from 'read-excel-file/browser';
import writeXlsxFile from 'write-excel-file/browser';
import type { BulkLinkRow, BulkRow } from '@/features/users/userControl';
import { ROLES, type Role } from '@/lib/types';

// ---- Columns ------------------------------------------------------------------

export type ColumnKey =
  | 'fullName'
  | 'email'
  | 'role'
  | 'department'
  | 'position'
  | 'manager'
  | 'directReports'
  | 'peers'
  | 'groups'
  | 'sendInvite';

/** Template columns in order. "*" marks required columns; matching on upload ignores it. */
export const TEMPLATE_COLUMNS: { key: ColumnKey; title: string; width: number; required?: boolean }[] = [
  { key: 'fullName', title: 'Full name *', width: 26, required: true },
  { key: 'email', title: 'Email *', width: 32, required: true },
  { key: 'role', title: 'Role *', width: 12, required: true },
  { key: 'department', title: 'Department', width: 18 },
  { key: 'position', title: 'Position', width: 22 },
  { key: 'manager', title: 'Immediate manager (email)', width: 32 },
  { key: 'directReports', title: 'Direct reports (emails)', width: 40 },
  { key: 'peers', title: 'Peers (emails)', width: 40 },
  { key: 'groups', title: 'Groups', width: 24 },
  { key: 'sendInvite', title: 'Send invite', width: 12 },
];

// Header words people commonly use, after removing "*", brackets and extra spaces.
const HEADER_ALIASES: Record<string, ColumnKey> = {
  'full name': 'fullName',
  name: 'fullName',
  'employee name': 'fullName',
  email: 'email',
  'work email': 'email',
  'email address': 'email',
  role: 'role',
  department: 'department',
  dept: 'department',
  position: 'position',
  'job title': 'position',
  title: 'position',
  designation: 'position',
  'immediate manager': 'manager',
  manager: 'manager',
  'line manager': 'manager',
  'reports to': 'manager',
  'direct reports': 'directReports',
  'direct report': 'directReports',
  peers: 'peers',
  peer: 'peers',
  groups: 'groups',
  group: 'groups',
  'send invite': 'sendInvite',
  invite: 'sendInvite',
  'send invitation': 'sendInvite',
};

export const MAX_UPLOAD_ROWS = 500;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const EXAMPLE_DOMAIN = '@example.com';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ROLE_ALIASES: Record<string, Role> = {
  admin: 'admin',
  administrator: 'admin',
  employee: 'employee',
  staff: 'employee',
  // Older templates used these words; everyone is now an employee.
  manager: 'employee',
  'line manager': 'employee',
  assessor: 'employee',
  rater: 'employee',
  talent: 'employee',
  leader: 'employee',
};

function normaliseHeader(value: string): string {
  return value
    .toLowerCase()
    .replace(/\*/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---- Template -------------------------------------------------------------------

const HEADER_STYLE = { fontWeight: 'bold', textColor: '#FFFFFF', backgroundColor: '#005B99' } as const;
const REQUIRED_STYLE = { fontWeight: 'bold', textColor: '#FFFFFF', backgroundColor: '#003A63' } as const;
const PROBLEM_STYLE = { backgroundColor: '#F8D7D3', textColor: '#9B1C12' } as const;
const LAST_ROW = MAX_UPLOAD_ROWS + 1;

// Column letters for the in-sheet checks (A = Full name ... J = Send invite).
const col = (key: ColumnKey) => TEMPLATE_COLUMNS.findIndex((c) => c.key === key) + 1;
const letter = (key: ColumnKey) => String.fromCharCode(64 + col(key));

function rangeOf(key: ColumnKey) {
  return { from: { row: 2, column: col(key) }, to: { row: LAST_ROW, column: col(key) } };
}

/** Red highlights inside Excel, so mistakes show while the sheet is being filled in. */
function inSheetChecks() {
  const A = letter('fullName');
  const B = letter('email');
  const C = letter('role');
  const F = letter('manager');
  const J = letter('sendInvite');
  const roleCheck = ['admin', 'administrator', 'employee', 'manager', 'assessor', 'talent']
    .map((role) => `LOWER(TRIM($${C}2))<>"${role}"`)
    .join(',');
  return [
    // Name missing while the row has an email.
    { cellRange: rangeOf('fullName'), condition: { formula: `=AND($${A}2="",$${B}2<>"")` }, style: PROBLEM_STYLE },
    // Email without "@", or used twice.
    {
      cellRange: rangeOf('email'),
      condition: { formula: `=AND($${B}2<>"",OR(ISERROR(SEARCH("@",$${B}2)),COUNTIF($${B}$2:$${B}$${LAST_ROW},$${B}2)>1))` },
      style: PROBLEM_STYLE,
    },
    // Role missing or not one of the allowed words.
    { cellRange: rangeOf('role'), condition: { formula: `=AND($${B}2<>"",OR($${C}2="",AND(${roleCheck})))` }, style: PROBLEM_STYLE },
    // Manager is the person themselves.
    { cellRange: rangeOf('manager'), condition: { formula: `=AND($${F}2<>"",LOWER(TRIM($${F}2))=LOWER(TRIM($${B}2)))` }, style: PROBLEM_STYLE },
    // Send invite other than Yes or No.
    {
      cellRange: rangeOf('sendInvite'),
      condition: { formula: `=AND($${J}2<>"",LOWER(TRIM($${J}2))<>"yes",LOWER(TRIM($${J}2))<>"no")` },
      style: PROBLEM_STYLE,
    },
  ];
}

const EXAMPLES: string[][] = [
  ['Juan Dela Cruz', `juan.delacruz${EXAMPLE_DOMAIN}`, 'employee', 'Sales', 'Sales Manager', '', '', '', 'Sales Team', 'Yes'],
  [
    'Maria Santos',
    `maria.santos${EXAMPLE_DOMAIN}`,
    'employee',
    'Sales',
    'Team Lead',
    `juan.delacruz${EXAMPLE_DOMAIN}`,
    `pedro.reyes${EXAMPLE_DOMAIN}, liza.gomez${EXAMPLE_DOMAIN}`,
    `ana.lim${EXAMPLE_DOMAIN}`,
    'Batch 1, Sales Team',
    'Yes',
  ],
  ['Pedro Reyes', `pedro.reyes${EXAMPLE_DOMAIN}`, 'employee', 'Sales', 'Sales Associate', '', '', '', 'Sales Team', 'Yes'],
  ['Liza Gomez', `liza.gomez${EXAMPLE_DOMAIN}`, 'employee', 'Sales', 'Sales Associate', '', '', '', '', 'No'],
  ['Ana Lim', `ana.lim${EXAMPLE_DOMAIN}`, 'employee', 'Marketing', 'Team Lead', '', '', '', '', 'Yes'],
];

/** Builds the bulk-upload template workbook, listing the groups that already exist. */
export function templateBlob(existingGroups: string[]): Promise<Blob> {
  const header = TEMPLATE_COLUMNS.map((c) => ({ value: c.title, ...(c.required ? REQUIRED_STYLE : HEADER_STYLE) }));
  const users = [header, ...EXAMPLES];

  const help: [string, string, string][] = [
    ['Full name', 'Yes', 'First and last name as it should appear in the app.'],
    ['Email', 'Yes', 'Work email; it is the person’s sign-in. Each email only once in the file.'],
    ['Role', 'Yes', `One of: ${ROLES.join(', ')}. Everyone is an employee who gives and receives feedback; only administrators can upload administrators.`],
    ['Department', 'No', 'Saved for everyone, up to 100 characters.'],
    ['Position', 'No', 'Job title, saved for everyone, up to 100 characters.'],
    [
      'Immediate manager',
      'No',
      'Email of the person they report to. Skip-level managers come automatically (the manager’s manager). The manager must already have an account or be a row in this file.',
    ],
    [
      'Direct reports',
      'No',
      'Emails of people who report to this person, separated by commas. Their immediate manager becomes this person.',
    ],
    ['Peers', 'No', 'Emails of colleagues who should give this person Peer feedback, separated by commas. Added as approved peers; no minimum or maximum.'],
    ['Groups', 'No', 'Group names separated by commas. Groups that do not exist yet are created.'],
    ['Send invite', 'No', 'Yes or No. Blank means Yes: the person gets an email to set their own password.'],
  ];

  const instructions = [
    [{ value: 'How to fill in the Users sheet', fontWeight: 'bold' as const, fontSize: 14 }],
    [''],
    [{ value: 'Column', ...HEADER_STYLE }, { value: 'Required', ...HEADER_STYLE }, { value: 'What to enter', ...HEADER_STYLE }],
    ...help.map((row) => [row[0], row[1], row[2]]),
    [''],
    [{ value: 'Good to know', fontWeight: 'bold' as const }],
    ['•', '', 'Cells turn red when something looks wrong (missing name, bad or repeated email, unknown role).'],
    ['•', '', 'People can refer to each other anywhere in the file; accounts are created first, then reporting lines.'],
    ['•', '', 'Reporting lines are set for everyone. A person’s manager can come from their own row or from someone else’s Direct reports column; the two must agree.'],
    ['•', '', 'Rating exclusions (exclude from rating others, being rated, or self) are set in the Org structure module.'],
    ['•', '', 'People who already have an account are skipped, unless you tick "Update people who already have an account".'],
    ['•', '', 'Delete the example rows (emails ending in @example.com); they are ignored anyway.'],
    ['•', '', `Up to ${MAX_UPLOAD_ROWS} people per file. Save as .xlsx.`],
    [''],
    [{ value: 'Existing groups', fontWeight: 'bold' as const }],
    ...(existingGroups.length > 0 ? existingGroups.map((name) => [name]) : [['(none yet)']]),
  ];

  return writeXlsxFile([
    {
      sheet: 'Users',
      data: users,
      columns: TEMPLATE_COLUMNS.map((c) => ({ width: c.width })),
      stickyRowsCount: 1,
      conditionalFormatting: inSheetChecks(),
    },
    { sheet: 'Instructions', data: instructions, columns: [{ width: 20 }, { width: 12 }, { width: 100 }] },
  ]).toBlob();
}

function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function downloadTemplate(existingGroups: string[]): Promise<void> {
  saveBlob(await templateBlob(existingGroups), 'leadership-compass-users-template.xlsx');
}

// ---- Parsing and checks -----------------------------------------------------------

export type KnownPerson = { email: string; role: Role; fullName: string };

export type ParsedRow = {
  row: number;
  fullName: string;
  email: string;
  roleText: string;
  role: Role | null;
  department: string;
  position: string;
  manager: string;
  directReports: string[];
  peers: string[];
  groups: string[];
  sendInvite: boolean;
  inviteText: string;
  /** Existing account this row refers to, if any. */
  existing: KnownPerson | null;
  /** Problems that stop this row from being uploaded. */
  errors: string[];
  /** Things worth knowing that do not stop the upload. */
  warnings: string[];
  /** Rows ignored on purpose (example rows, existing accounts when not updating). */
  skipReason: string | null;
};

export type ParseOptions = {
  known: Map<string, KnownPerson>;
  canCreateAdmins: boolean;
  updateExisting: boolean;
};

export type ParseResult =
  | { ok: true; rows: ParsedRow[]; ignoredColumns: string[] }
  | { ok: false; message: string };

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).replace(/\s+/g, ' ').trim();
}

function emails(value: string): string[] {
  return [...new Set(value.split(/[,;\n]/).map((v) => v.trim().toLowerCase()).filter(Boolean))];
}

function parseInvite(value: string): boolean | null {
  const v = value.toLowerCase();
  if (v === '' || ['yes', 'y', 'true', '1'].includes(v)) return true;
  if (['no', 'n', 'false', '0'].includes(v)) return false;
  return null;
}

/** Reads the uploaded workbook and checks every row. Nothing is sent to the server here. */
export async function parseUpload(file: File, options: ParseOptions): Promise<ParseResult> {
  if (!/\.xlsx$/i.test(file.name)) {
    return { ok: false, message: 'Upload an Excel .xlsx file. Save other formats (such as .xls or .csv) as .xlsx first.' };
  }
  if (file.size > MAX_FILE_BYTES) return { ok: false, message: 'The file is larger than 5 MB. Remove extra sheets or formatting.' };

  let sheets;
  try {
    sheets = await readXlsxFile(file);
  } catch {
    return { ok: false, message: 'This file could not be read as an Excel workbook.' };
  }
  const sheet = sheets.find((s) => s.sheet.trim().toLowerCase() === 'users') ?? sheets[0];
  if (!sheet || sheet.data.length === 0) return { ok: false, message: 'The workbook is empty.' };

  // The header row is the first row naming an Email column, so a title row above it is fine.
  const headerIndex = sheet.data.findIndex((row) => row.some((cell) => HEADER_ALIASES[normaliseHeader(cellText(cell))] === 'email'));
  if (headerIndex === -1) return { ok: false, message: 'No "Email" column was found. Use the template’s column titles.' };

  const columnOf = new Map<ColumnKey, number>();
  const ignoredColumns: string[] = [];
  sheet.data[headerIndex].forEach((cell, index) => {
    const title = cellText(cell);
    if (!title) return;
    const key = HEADER_ALIASES[normaliseHeader(title)];
    if (!key) ignoredColumns.push(title);
    else if (!columnOf.has(key)) columnOf.set(key, index);
  });
  for (const column of TEMPLATE_COLUMNS.filter((c) => c.required)) {
    if (!columnOf.has(column.key)) return { ok: false, message: `The "${column.title.replace(' *', '')}" column is missing.` };
  }

  const get = (row: unknown[], key: ColumnKey) => {
    const index = columnOf.get(key);
    return index === undefined ? '' : cellText(row[index]);
  };

  // ---- Pass 1: each row on its own.
  const rows: ParsedRow[] = [];
  const seen = new Map<string, number>();
  sheet.data.slice(headerIndex + 1).forEach((raw, offset) => {
    const rowNumber = headerIndex + offset + 2; // Excel's own row number
    const values = Object.fromEntries(TEMPLATE_COLUMNS.map((c) => [c.key, get(raw, c.key)])) as Record<ColumnKey, string>;
    if (Object.values(values).every((v) => !v)) return; // blank line

    const email = values.email.toLowerCase();
    const role = ROLE_ALIASES[values.role.toLowerCase()] ?? null;
    const invite = parseInvite(values.sendInvite);
    const errors: string[] = [];
    const warnings: string[] = [];
    let skipReason: string | null = null;

    if (!values.fullName) errors.push('Full name is missing.');
    else if (values.fullName.length > 200) errors.push('Full name is longer than 200 characters.');
    if (!email) errors.push('Email is missing.');
    else if (!EMAIL_PATTERN.test(email) || email.length > 254) errors.push('Email is not valid.');
    if (!values.role) errors.push('Role is missing.');
    else if (!role) errors.push(`Role "${values.role}" is not one of ${ROLES.join(', ')}.`);
    else if (role === 'admin' && !options.canCreateAdmins) errors.push('Only an administrator can upload administrators.');
    if (values.department.length > 100) errors.push('Department is longer than 100 characters.');
    if (values.position.length > 100) errors.push('Position is longer than 100 characters.');
    if (invite === null) errors.push('Send invite must be Yes or No.');

    const manager = values.manager.toLowerCase();
    const directReports = emails(values.directReports);
    const peers = emails(values.peers);
    const groups = values.groups
      .split(/[,;]/)
      .map((g) => g.trim())
      .filter(Boolean);
    if (groups.some((g) => g.length > 100)) errors.push('A group name is longer than 100 characters.');
    if (groups.length > 20) errors.push('At most 20 groups per person.');

    const existing = email ? options.known.get(email) ?? null : null;
    if (email.endsWith(EXAMPLE_DOMAIN)) skipReason = 'Example row from the template.';
    else if (existing && !options.updateExisting) skipReason = 'Already has an account.';
    else if (email && seen.has(email)) errors.push(`Same email as row ${seen.get(email)}.`);
    if (email && !seen.has(email)) seen.set(email, rowNumber);

    if (existing && options.updateExisting && role && existing.role !== role) {
      warnings.push(`Role stays ${existing.role}; change roles in User control.`);
    }
    if (existing && existing.role === 'admin' && !options.canCreateAdmins && options.updateExisting) {
      errors.push('Only an administrator can update an administrator.');
    }

    rows.push({
      row: rowNumber,
      fullName: values.fullName,
      email,
      roleText: values.role,
      role,
      department: values.department,
      position: values.position,
      manager,
      directReports,
      peers,
      groups: groups.slice(0, 20),
      sendInvite: invite ?? true,
      inviteText: values.sendInvite,
      existing,
      errors,
      warnings,
      skipReason,
    });
  });

  if (rows.length === 0) return { ok: false, message: 'No people were found under the column titles.' };
  if (rows.length > MAX_UPLOAD_ROWS) {
    return { ok: false, message: `The file has ${rows.length} people; upload at most ${MAX_UPLOAD_ROWS} at a time.` };
  }

  // ---- Pass 2: references between people.
  const inFile = new Map(rows.filter((r) => r.email && !r.skipReason?.startsWith('Example')).map((r) => [r.email, r]));
  const describe = (email: string): string | null => {
    const target = inFile.get(email);
    if (target) {
      if (target.errors.length > 0) return `${email} is in row ${target.row}, which has problems.`;
      return null;
    }
    if (options.known.has(email)) return null;
    return `${email} is not in this file and has no account.`;
  };

  for (const r of rows) {
    if (r.skipReason) continue;
    if (r.manager) {
      if (!EMAIL_PATTERN.test(r.manager)) r.errors.push('Immediate manager email is not valid.');
      else if (r.manager === r.email) r.errors.push('A person cannot be their own immediate manager.');
      else {
        const problem = describe(r.manager);
        if (problem) r.errors.push(`Immediate manager: ${problem}`);
      }
    }
    for (const [list, label] of [
      [r.directReports, 'Direct report'],
      [r.peers, 'Peer'],
    ] as const) {
      for (const email of list) {
        if (!EMAIL_PATTERN.test(email)) r.errors.push(`${label} "${email}" is not a valid email.`);
        else if (email === r.email) r.errors.push(`${label}: a person cannot be listed against themselves.`);
        else if (email === r.manager) r.errors.push(`${label} ${email} is already the immediate manager.`);
        else {
          const problem = describe(email);
          if (problem) r.errors.push(`${label}: ${problem}`);
        }
      }
    }
    const both = r.directReports.filter((e) => r.peers.includes(e));
    if (both.length > 0) r.errors.push(`${both.join(', ')} is listed as both direct report and peer.`);
  }

  // Combine both ways of stating a reporting line: "my manager is X" and "X's direct reports include me".
  const active = rows.filter((r) => !r.skipReason && r.email);
  const managerOf = new Map<string, string>();
  const claimedBy = new Map<string, string>();
  for (const r of active) {
    if (r.manager && r.manager !== r.email) managerOf.set(r.email, r.manager);
  }
  for (const r of active) {
    for (const report of r.directReports) {
      if (report === r.email) continue;
      const earlier = claimedBy.get(report);
      if (earlier && earlier !== r.email) {
        r.errors.push(`${report} is also listed as a direct report of ${earlier}; a person has one immediate manager.`);
        continue;
      }
      claimedBy.set(report, r.email);
      const stated = managerOf.get(report);
      if (stated && stated !== r.email) {
        r.errors.push(`${report} lists ${stated} as their immediate manager, not this person.`);
      } else if (!stated) {
        managerOf.set(report, r.email);
      }
    }
  }

  // A reporting loop (A reports to B, B reports to A) is almost always a typo.
  for (const r of active) {
    if (!managerOf.has(r.email)) continue;
    const path = [r.email];
    let next = managerOf.get(r.email);
    while (next && !path.includes(next) && path.length < 50) {
      path.push(next);
      next = managerOf.get(next);
    }
    if (next === r.email) r.errors.push(`Reporting loop: ${[...path, r.email].join(' → ')}.`);
  }

  return { ok: true, rows, ignoredColumns };
}

/** Roles never change through an upload, so an existing account keeps its current role. */
export function effectiveRole(r: ParsedRow): Role | null {
  return r.existing ? r.existing.role : r.role;
}

export function isReady(r: ParsedRow): boolean {
  return r.errors.length === 0 && !r.skipReason && r.role !== null;
}

/** Phase 1 rows: accounts to create, or to update when that option is on. */
export function accountRows(rows: ParsedRow[]): BulkRow[] {
  return rows.filter(isReady).map((r) => ({
    row: r.row,
    fullName: r.fullName,
    email: r.email,
    role: r.role as Role,
    groups: r.groups,
    sendInvite: r.existing ? false : r.sendInvite,
    department: r.department,
    position: r.position,
    update: r.existing !== null,
  }));
}

/** Phase 2 rows: reporting lines and peers, for everyone. */
export function linkRows(rows: ParsedRow[], succeeded: Set<string>): BulkLinkRow[] {
  return rows
    .filter((r) => isReady(r) && succeeded.has(r.email))
    .filter((r) => r.manager || r.directReports.length > 0 || r.peers.length > 0)
    .map((r) => ({
      row: r.row,
      email: r.email,
      managerEmail: r.manager || null,
      directReports: r.directReports,
      peers: r.peers,
      department: r.department,
      position: r.position,
    }));
}

/** The rows with problems, with a Problems column, so they can be fixed and uploaded again. */
export async function downloadProblemRows(rows: ParsedRow[]): Promise<void> {
  const header = [...TEMPLATE_COLUMNS.map((c) => c.title), 'Problems'].map((value) => ({ value, ...HEADER_STYLE }));
  const problemRows = rows
    .filter((r) => r.errors.length > 0)
    .map((r) => [
      r.fullName,
      r.email,
      r.roleText,
      r.department,
      r.position,
      r.manager,
      r.directReports.join(', '),
      r.peers.join(', '),
      r.groups.join(', '),
      r.inviteText,
      { value: `Row ${r.row}: ${r.errors.join(' ')}`, textColor: '#9B1C12' },
    ]);
  const blob = await writeXlsxFile([header, ...problemRows], {
    sheet: 'Users',
    columns: [...TEMPLATE_COLUMNS.map((c) => ({ width: c.width })), { width: 70 }],
    stickyRowsCount: 1,
  }).toBlob();
  saveBlob(blob, 'users-to-fix.xlsx');
}
