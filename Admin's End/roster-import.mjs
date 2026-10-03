const MAX_ROSTER_ROWS = 1000;
const GROUPS = new Set(['Regular', 'Literary Club', 'Editorial Board']);

function csvRows(text) {
  const rows = []; let row = []; let field = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (char !== '\r') field += char;
  }
  if (quoted) throw new Error('CSV contains an unclosed quoted value.');
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter(values => values.some(value => value.trim()));
}

function key(value) { return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_'); }
function fromObject(value, aliases) {
  const entries = new Map(Object.entries(value || {}).map(([name, field]) => [key(name), field]));
  for (const alias of aliases) if (entries.has(alias)) return entries.get(alias);
  return '';
}
function normalizeRow(raw, index) {
  const text = value => String(value ?? '').trim();
  const admNo = text(fromObject(raw, ['adm_no', 'admission_no', 'admission_number', 'admno', 'admission', 'student_id']));
  const name = text(fromObject(raw, ['name', 'student_name', 'full_name']));
  const email = text(fromObject(raw, ['email', 'email_address', 'google_email'])).toLowerCase();
  const studentClass = text(fromObject(raw, ['class', 'grade', 'standard']));
  const section = text(fromObject(raw, ['section', 'division']));
  const suppliedGroup = text(fromObject(raw, ['group', 'student_group']));
  const group = GROUPS.has(suppliedGroup) ? suppliedGroup : 'Regular';
  if (!admNo) throw new Error(`Row ${index + 1}: admission number is required.`);
  if (admNo.length > 40) throw new Error(`Row ${index + 1}: admission number exceeds 40 characters.`);
  if (name.length > 100 || studentClass.length > 20 || section.length > 10) throw new Error(`Row ${index + 1}: a field exceeds its allowed length.`);
  if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320)) throw new Error(`Row ${index + 1}: email address is invalid.`);
  return { adm_no: admNo, name, email, class: studentClass, section, group };
}

export function parseRosterText(text, format = 'csv') {
  let inputRows;
  if (format === 'json') {
    let parsed;
    try { parsed = JSON.parse(text); } catch { throw new Error('The JSON file is not valid.'); }
    inputRows = Array.isArray(parsed) ? parsed : parsed?.students || parsed?.rows || parsed?.data;
    if (!Array.isArray(inputRows)) throw new Error('JSON must be an array or contain a students, rows, or data array.');
  } else {
    const table = csvRows(text);
    if (table.length < 2) throw new Error('CSV must contain a header and at least one student row.');
    const headers = table.shift();
    inputRows = table.map(values => Object.fromEntries(headers.map((header, column) => [header, values[column] || ''])));
  }
  if (!inputRows.length) throw new Error('The roster contains no student rows.');
  if (inputRows.length > MAX_ROSTER_ROWS) throw new Error(`Import at most ${MAX_ROSTER_ROWS} students at a time.`);
  const rows = inputRows.map(normalizeRow);
  const seen = new Set();
  for (const [index, row] of rows.entries()) {
    const id = row.adm_no.toLowerCase();
    if (seen.has(id)) throw new Error(`Row ${index + 1}: duplicate admission number ${row.adm_no}.`);
    seen.add(id);
  }
  return rows;
}

export async function parseRosterFile(file) {
  const extension = String(file?.name || '').toLowerCase().split('.').pop();
  if (extension === 'mdb' || extension === 'accdb') throw new Error('Direct Microsoft Access import requires a machine-specific database driver. Export the Access table or query as CSV, then import that CSV here.');
  if (!['csv', 'json'].includes(extension)) throw new Error('Choose a .csv or .json roster file.');
  if (file.size > 2 * 1024 * 1024) throw new Error('Roster files must be 2 MB or smaller.');
  return parseRosterText(await file.text(), extension);
}

export function rosterImportErrorMessage(error) {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || 'The roster could not be imported.');
  if (code.includes('permission-denied') || /missing or insufficient permissions/i.test(message)) {
    return 'Roster access is not enabled in this Firebase project. In Control Center, copy the current Firestore rules, then paste and publish them in Firebase Console → Firestore Database → Rules. Sign out and back in to Admin before retrying.';
  }
  return message;
}

export { MAX_ROSTER_ROWS };
