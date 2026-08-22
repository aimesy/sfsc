// Real-data test for causes.js. Run from repo root:
//   node assets/js/causes.test.mjs
// Loads real archive/cases/<case>.json records, supplies a fetchOcr that reads
// data/ocr/<sha>.json from disk (returning its `text` field), and prints the
// extracted causes for each case.

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  extractCausesOfAction,
  findPleadingDocs,
  parseCausesFromCaption,
} from './causes.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CASES = path.resolve(process.env.SFSC_CASES_DIR || path.join(ROOT, 'archive', 'cases'));
const OCR = path.resolve(process.env.SFSC_OCR_DIR || path.join(ROOT, 'data', 'ocr'));
const DATA_REPO = process.env.SFSC_DATA_REPO ? path.resolve(process.env.SFSC_DATA_REPO) : '';
const DATA_REF = process.env.SFSC_DATA_REF || 'HEAD';

async function loadCase(cn) {
  const clean = String(cn || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const paths = [`archive/cases/${clean}.json`];
  const m = clean.match(/^([A-Z]+)(\d{2})/);
  if (m) paths.unshift(`archive/cases/${m[1]}/${m[2]}/${clean}.json`);
  for (const repoPath of paths) {
    const localPath = path.join(CASES, repoPath.replace(/^archive\/cases\//, ''));
    if (existsSync(localPath)) return JSON.parse(await readFile(localPath, 'utf8'));
    if (DATA_REPO) {
      try {
        return JSON.parse(execFileSync('git', ['-C', DATA_REPO, 'show', `${DATA_REF}:${repoPath}`], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }));
      } catch {}
    }
  }
  throw new Error(`not found in ${CASES}${DATA_REPO ? ` or ${DATA_REPO}@${DATA_REF}` : ''}`);
}

// fetchOcr: sha -> full OCR text (the `text` field) or null.
async function fetchOcr(sha) {
  if (!sha) return null;
  const p = path.join(OCR, `${sha}.json`);
  if (!existsSync(p)) return null;
  try {
    const o = JSON.parse(await readFile(p, 'utf8'));
    return typeof o.text === 'string' ? o.text : null;
  } catch {
    return null;
  }
}

function fmtCauses(arr) {
  if (!arr.length) return '   (none)';
  return arr
    .map((c) => `   ${c.n}. ${c.label}${c.statute ? `  [${c.statute}]` : ''}`)
    .join('\n');
}

const CASE_NUMBERS = [
  'CGC24614279', // single-cause Prop 65 (text-layer OCR)
  'CGC21597275', // FAC: BREACH OF CONTRACT / IMPLIED COVENANT / FRAUD / CONVERSION (inline)
  'CGC20582454', // 2AC class action, 9 wage causes (wrapped lines + inline statutes)
  'CGC24620755', // FAC pro-se: UCL/FAL/CLRA with parenthetical statutes (nested parens)
  'CGC22598433', // 3AC FEHA disability, ~10 causes
  'PES24307468', // probate AMENDED PETITION FOR: [1].. [2].. enumerated causes
  'PES24306932', // standard probate petition (PETITION FOR PROBATE OF WILL ...)
  '963660',      // no documents[] captured at all
];

let exit = 0;
let loadedRealCases = 0;
for (const cn of CASE_NUMBERS) {
  let rec;
  try {
    rec = await loadCase(cn);
  } catch (e) {
    console.log(`\n### ${cn}: COULD NOT LOAD (${e.message})`);
    continue;
  }
  loadedRealCases += 1;
  const pleadings = findPleadingDocs(rec);
  console.log(`\n### ${cn}  "${rec.case_title || ''}"`);
  console.log(
    `   pleading docs -> complaint:${pleadings.complaint.length} ` +
      `cross:${pleadings.crossComplaint.length} petition:${pleadings.petition.length}`
  );
  const op = (pleadings.complaint[0] || pleadings.petition[0]);
  if (op) {
    console.log(
      `   operative: ${op.doc_id} filed=${op.filed} sha=${op.sha256 ? op.sha256.slice(0, 12) + '…' : 'NOT CAPTURED'}`
    );
  }
  const res = await extractCausesOfAction(rec, fetchOcr);
  console.log(
    `   kind=${res.kind} filed=${res.filed} source=${res.source} available=${res.available}` +
      (res.petitionFor ? ` petitionFor="${res.petitionFor}"` : '') +
      (res.note ? `\n   note: ${res.note}` : '')
  );
  console.log('   COMPLAINT causes:');
  console.log(fmtCauses(res.complaint));
  if (res.crossComplaint.length) {
    console.log('   CROSS-COMPLAINT causes:');
    console.log(fmtCauses(res.crossComplaint));
  }
}
if (loadedRealCases !== CASE_NUMBERS.length) {
  console.log(`\nFAIL  loaded ${loadedRealCases}/${CASE_NUMBERS.length} real case fixtures`);
  exit = 1;
}

// ---- a couple of pure-parser sanity assertions on inline strings ----
function assert(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) exit = 1;
}
console.log('\n--- pure parseCausesFromCaption assertions ---');
const inline =
  'FIRST AMENDED COMPLAINT FOR DAMAGES FOR:  1. BREACH OF CONTRACT 2. BREACH OF THE IMPLIED COVENANT AND FAIR DEALING 3. FRAUDULENT INDUCEMENT 4. CONVERSION   DEMAND FOR JURY TRIAL      PARTIES 1. Plaintiff Archetype Lighting Sales, LLC';
const pc = parseCausesFromCaption(inline);
assert('inline list yields 4 causes', pc.length === 4);
assert('inline #1 is Breach of Contract', pc[0] && /breach of contract/i.test(pc[0].label));
assert('inline #4 trimmed to Conversion (no jury/parties bleed)', pc[3] && /^conversion$/i.test(pc[3].label));

const parened =
  'COMPLAINT \n 1. UCL (B.P.C. §§ 17200 et seq.) \n2. FAL (B.P.C. §§ 17500 et seq.) \n3. CLRA (Civil Code § 1770(a)(5)) \n6. Fraud (Concealment) \nJURY TRIAL DEMANDED \nINTRODUCTION \n1. Defendant owns and operates an arcade';
const pp = parseCausesFromCaption(parened);
assert('parenthetical-statute list parses', pp.length >= 3);
assert('statute captured for #1 (nested-paren safe)', pp[0] && pp[0].statute && /17200/.test(pp[0].statute));

const bodyOnly =
  'Plaintiff alleges: \n FACTS COMMON TO ALL CAUSES OF ACTION \n 1. Plaintiff is a corporation. 2. Defendant is an individual. 3. Venue is proper.';
const bo = parseCausesFromCaption(bodyOnly);
assert('body-paragraph numbers are NOT treated as causes', bo.length === 0);

const residencyList = 'COMPLAINT FOR DAMAGES 1. RESIDENCY VERIFIED 2. BREACH OF CONTRACT DEMAND FOR JURY TRIAL';
const rv = parseCausesFromCaption(residencyList);
assert('residency verified is not treated as a cause', rv.length === 1 && /breach of contract/i.test(rv[0].label));

const adminList = 'COMPLAINT FOR DAMAGES 1. CIVIL CASE COVER SHEET 2. PROOF OF SERVICE 3. NEGLIGENCE DEMAND FOR JURY TRIAL';
const al = parseCausesFromCaption(adminList);
assert('admin caption labels are not treated as causes', al.length === 1 && /negligence/i.test(al[0].label));

const residencyFallback = await extractCausesOfAction({
  case_number: 'CGC00000000',
  cause_of_action: 'RESIDENCY VERIFIED',
  docket_entries: [{ doc_id: '1', description: 'COMPLAINT', has_document: true }],
  documents: [],
}, async () => null);
assert('residency verified fallback is suppressed', residencyFallback.complaint.length === 0 && residencyFallback.source === 'none');

const categoryFallback = await extractCausesOfAction({
  case_number: 'CGC00000001',
  cause_of_action: 'OTHER NON EXEMPT COMPLAINTS (VERIFIED)',
  docket_entries: [{ doc_id: '1', description: 'COMPLAINT', has_document: true }],
  documents: [],
}, async () => null);
assert('generic verified complaint category fallback is suppressed', categoryFallback.complaint.length === 0 && categoryFallback.source === 'none');

const parentheticalFallback = await extractCausesOfAction({
  case_number: 'CGC00000002',
  cause_of_action: 'OTHER NON EXEMPT COMPLAINTS (VERIFIED COMPLAINT FOR REFUND OF TRANSFER TAX)',
  docket_entries: [{ doc_id: '1', description: 'COMPLAINT', has_document: true }],
  documents: [],
}, async () => null);
assert('real complaint-for parenthetical fallback still works', parentheticalFallback.complaint.length === 1 && /refund of transfer tax/i.test(parentheticalFallback.complaint[0].label));

const noSummonsComplaint = findPleadingDocs({
  documents: [{
    doc_id: 'prop65',
    description: 'OTHER NON EXEMPT COMPLAINTS, COMPLAINT (TRANSACTION ID # 210078372) FILED BY PLAINTIFF EPPS, JAY AS TO DEFENDANT WALMART INC. NO SUMMONS ISSUED, JUDICIAL COUNCIL CIVIL CASE COVER SHEET NOT FILED',
  }],
});
assert('complaint filing survives appended no-summons metadata', noSummonsComplaint.complaint.length === 1);

const perOrderComplaint = findPleadingDocs({
  documents: [{
    doc_id: 'third-amended',
    description: '3RD AMENDED COMPLAINT ***PER MAR 9, 2023 ORDER*** (TRANSACTION ID # 210031473) FILED BY PLAINTIFF BERTA MD, SCOTT',
  }],
});
assert('amended complaint filing survives per-order annotation', perOrderComplaint.complaint.length === 1);

const relatedComplaintDocs = findPleadingDocs({
  documents: [
    { doc_id: 'answer', description: 'ANSWER TO COMPLAINT (TRANSACTION ID # 1) FILED BY DEFENDANT' },
    { doc_id: 'demurrer', description: 'DEMURRER TO 2ND AMENDED COMPLAINT (TRANSACTION ID # 2) FILED BY DEFENDANT' },
    { doc_id: 'order', description: 'ORDER ON STIPULATION FOR LEAVE TO FILE SECOND AMENDED COMPLAINT' },
  ],
});
assert('answer, demurrer, and order remain excluded as pleadings', relatedComplaintDocs.complaint.length === 0);

process.exit(exit);
