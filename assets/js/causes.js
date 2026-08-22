// causes.js — extract a case's CAUSES OF ACTION from its complaint /
// cross-complaint / counterclaim documents' OCR'd caption pages ONLY.
//
// Owner's hard rule: causes of action come ONLY from the complaint and the
// cross-complaint/counterclaim (or, in probate/other matters, the operative
// petition). They are NEVER inferred from tentative rulings or unrelated
// documents.
//
// By California Rule of Court 2.111(3), the causes of action are listed in the
// RIGHT-HAND COLUMN of the complaint's caption page, as a numbered list under a
// "COMPLAINT FOR ..." heading, e.g.
//     COMPLAINT FOR DAMAGES
//     1. VIOLATION OF THE SONG-BEVERLY CONSUMER WARRANTY ACT (Civ. Code §§ 1790 et seq.)
//     2. CIVIL PENALTY FOR WILLFUL VIOLATION (Civ. Code § 1794(c))
//     ...
// This module pulls that enumerated list (label + optional statute) in order,
// and also recognises the "FIRST CAUSE OF ACTION (Breach of Contract)" body
// style as a secondary signal.
//
// Pure ES module: no imports, no DOM, no build step. LF line endings.
//
// ---------------------------------------------------------------------------
// Real data shapes this is written against (verified 2026-06-04):
//
// archive/cases/<case>.json:
//   { case_number, case_title, court, cause_of_action,   // cause_of_action is
//     docket_entries:[{date_filed,description,doc_id,has_document,fee}],
//     documents:[{doc_id,description,filed,is_available,sha256,bytes_len,
//                 content_type,asset_name,release_tag}],
//     ... }
//   - documents[] may be empty even when docket_entries[] have has_document.
//   - The join from a docket entry to its captured bytes/OCR is by doc_id:
//     docket_entries[i].doc_id === documents[j].doc_id; documents[j].sha256 is
//     the content hash. OCR lives at data/ocr/<sha256>.json.
//
// data/ocr/<sha256>.json:
//   { sha256, source_path, bytes, engine, engine_version, page_count,
//     char_count, mean_confidence, text, extracted_at }
//   - `text` holds the full OCR'd plain text. fetchOcr() must return that string
//     (callers read the file / asset and hand back the `text` field).
// ---------------------------------------------------------------------------

'use strict';

// ----------------------------- small utilities -----------------------------

function isStr(x) {
  return typeof x === 'string' && x.length > 0;
}

function asArray(x) {
  return Array.isArray(x) ? x : [];
}

// Collapse runs of whitespace (including newlines) to single spaces, trim.
function squish(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}

// Normalise a date-ish string to 'YYYY-MM-DD' or null.
// Accepts '2024-04-30', '2024-04-30 11:18:18', 'APR-30-2024', etc.
function toIsoDate(s) {
  if (!isStr(s)) return null;
  const t = s.trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // MON-DD-YYYY (court ROA style)
  m = t.match(/^([A-Za-z]{3})-(\d{1,2})-(\d{4})/);
  if (m) {
    const months = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
    };
    const mm = months[m[1].toLowerCase()];
    if (mm) return `${m[3]}-${mm}-${String(m[2]).padStart(2, '0')}`;
  }
  // MM/DD/YYYY
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    return `${m[3]}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
  }
  return null;
}

// ----------------------------- doc classification ---------------------------

// A docket/document row's description matches a "real" complaint/cross/petition
// pleading filing, not an answer, summons, order, motion, demurrer, etc. about
// one. We keep the test conservative on the negative side.
const NEG_DESC =
  /\b(answer(?:ed)?\b|summons|order(?:s|ed)?\b|notice\b|declaration\b|opposition\b|reply\b|demurrer\b|motion\b|stipulation\b|memorandum\b|points and authorities\b|proof of service\b|dismiss(?:al|ed)?\b|request for (?:dismissal|judicial notice)\b|case management\b|amend(?:ed|ment) (?:order|judgment)\b|judgment\b|substitution\b|ex parte application\b|objection\b|supplement(?:al)?\b|response\b|joinder\b|verification\b|certificate\b|cover sheet\b)/i;

const COMPLAINT_DESC = /\bcomplaint\b/i;
const CROSS_DESC = /\bcross-?\s*complaint\b|\bcounter-?\s*claim\b/i;
const PETITION_DESC = /\bpetition\b/i;

// "Operative-ness" ordering for complaints: later/amended preferred.
function complaintRank(desc) {
  const u = (desc || '').toUpperCase();
  // higher = more operative (latest amended). Crude ordinal extraction.
  let r = 0;
  if (/\bFIFTH\b|\b5(?:TH)?\b\s*AMEND/.test(u)) r = 5;
  else if (/\bFOURTH\b|\b4(?:TH)?\b\s*AMEND/.test(u)) r = 4;
  else if (/\bTHIRD\b|\b3(?:RD)?\b\s*AMEND/.test(u)) r = 3;
  else if (/\bSECOND\b|\b2(?:ND)?\b\s*AMEND/.test(u)) r = 2;
  else if (/\bFIRST\b|\b1(?:ST)?\b\s*AMEND|\bAMENDED\b/.test(u)) r = 1;
  return r;
}

// Does this row describe the *filing of* a pleading (vs. something about it)?
function describesPleadingFiling(desc, kindRe) {
  if (!isStr(desc)) return false;
  if (!kindRe.test(desc)) return false;
  // Court metadata appended after the filing label often mentions later
  // summons, service, conference, or order events. Classify the filing head,
  // not those suffixes, and ignore a narrow "per ... order" annotation that
  // can appear inside an amended-complaint label.
  const filingHead = desc
    .split(/\b(?:TRANSACTION ID|FILED BY)\b/i, 1)[0]
    .replace(/\*+\s*PER\b.{0,80}?\bORDER\s*\*+/gi, ' ');
  if (NEG_DESC.test(filingHead)) return false;
  return true;
}

/**
 * Find the complaint / cross-complaint / petition document rows for a case and
 * attach each one's sha256 (when captured). Synchronous; no OCR fetched.
 *
 * @param {object} rec - a case record (archive/cases/<case>.json shape)
 * @returns {{complaint: object[], crossComplaint: object[], petition: object[]}}
 *          each docRow is { doc_id, description, filed, sha256|null,
 *                           is_available, rank } sorted operative-first.
 */
export function findPleadingDocs(rec) {
  const out = { complaint: [], crossComplaint: [], petition: [] };
  if (!rec || typeof rec !== 'object') return out;

  const docs = asArray(rec.documents);
  const docket = asArray(rec.docket_entries);

  // Map doc_id -> document row (carries sha256) for joins.
  const byId = new Map();
  for (const d of docs) {
    if (d && isStr(d.doc_id)) byId.set(String(d.doc_id), d);
  }

  // Build a unified candidate list: every documents[] row, plus any
  // docket_entries[] row that has_document but is NOT already in documents[]
  // (so we can still surface a complaint that exists as a docket entry even if
  // its bytes were never captured -> sha256 null).
  const seen = new Set();
  const candidates = [];
  for (const d of docs) {
    if (!d) continue;
    const id = isStr(d.doc_id) ? String(d.doc_id) : `doc#${candidates.length}`;
    seen.add(id);
    candidates.push({
      doc_id: isStr(d.doc_id) ? d.doc_id : null,
      description: isStr(d.description) ? d.description : '',
      filed: toIsoDate(d.filed) || toIsoDate(d.date_filed),
      sha256: isStr(d.sha256) ? d.sha256 : null,
      is_available: d.is_available !== false,
    });
  }
  for (const e of docket) {
    if (!e || !isStr(e.doc_id)) continue;
    const id = String(e.doc_id);
    if (seen.has(id)) continue;
    seen.add(id);
    const joined = byId.get(id);
    candidates.push({
      doc_id: e.doc_id,
      description: isStr(e.description) ? e.description : '',
      filed: toIsoDate(e.date_filed) || toIsoDate(e.filed),
      sha256: joined && isStr(joined.sha256) ? joined.sha256 : null,
      is_available: joined ? joined.is_available !== false : !!e.has_document,
    });
  }

  for (const c of candidates) {
    const desc = c.description;
    const isCross = CROSS_DESC.test(desc);
    // cross-complaint
    if (isCross && describesPleadingFiling(desc, CROSS_DESC)) {
      out.crossComplaint.push({ ...c, rank: complaintRank(desc) });
      continue;
    }
    // plain complaint (exclude cross)
    if (!isCross && describesPleadingFiling(desc, COMPLAINT_DESC)) {
      out.complaint.push({ ...c, rank: complaintRank(desc) });
      continue;
    }
    // petition (probate / other) — exclude accounting/instruction sub-petitions
    if (PETITION_DESC.test(desc) && describesPleadingFiling(desc, PETITION_DESC) && !isCross) {
      const u = desc.toUpperCase();
      // skip clearly non-initiating petitions
      if (/\bACCOUNTING PETITION\b/.test(u)) continue;
      out.petition.push({ ...c, rank: complaintRank(desc) });
    }
  }

  // Order operative-first: highest amendment rank first, then latest filed.
  const cmp = (a, b) => {
    if (b.rank !== a.rank) return b.rank - a.rank;
    const fa = a.filed || '';
    const fb = b.filed || '';
    if (fa !== fb) return fb < fa ? -1 : 1;
    return 0;
  };
  out.complaint.sort(cmp);
  out.crossComplaint.sort(cmp);
  out.petition.sort(cmp);
  return out;
}

// ----------------------------- caption parser -------------------------------

// Words/phrases that mark the END of a caption cause list (anything from here
// on is not a cause of action).
const STOP_PHRASES = [
  'DEMAND FOR JURY',
  'DEMAND FOR A JURY',
  'JURY TRIAL DEMAND',
  'JURY TRIAL',
  'JURY DEMAND',
  'REQUEST FOR INJUNCT',
  'REQUEST FOR JURY',
  'AMOUNT DEMANDED',
  'UNLIMITED CIVIL',
  'LIMITED CIVIL',
  'DEMAND EXCEEDS',
  'DEMAND UNDER',
  'INTRODUCTION',
  'NATURE OF THE ACTION',
  'NATURE OF ACTION',
  'GENERAL ALLEGATIONS',
  'FACTS COMMON TO',
  'COMMON ALLEGATIONS',
  'PRELIMINARY ALLEGATIONS',
  'PRELIMINARY STATEMENT',
  'PARTIES AND',
  'THE PARTIES',
  'SUMMARY OF',
  'STATEMENT OF FACTS',
  'JURISDICTION AND VENUE',
  'VENUE AND JURISDICTION',
  'EXEMPT FROM FILING',
  'COMPLAINT FOR DAMAGES CASE NO', // running footer
];

// Tokens that are never a cause label on their own (defensive filtering).
const JUNK_LABEL = /^(and|et al\.?|inclusive|et seq\.?|page \d+ of \d+|demand for jury trial|jury trial demanded|parties|introduction|summary|facts|exhibit\b.*|attachment\b.*)$/i;

// Court/admin labels and category shells that sometimes appear near the caption
// or in the docket's broad Cause of Action field. They are useful metadata, but
// they are not pleaded causes and should not become `cause:` pills.
const NON_CAUSE_LABEL = /^(?:residency verified|verified|verification|civil case cover sheet|case management\b.*|proof of service\b.*|summons(?: and complaint)?(?:\b.*)?|notice(?:\b.*)?|other non[- ]exempt complaints?|exempt collections\b.*|complaint(?: for damages)?|damages|money|will deposited\b.*|custody order\b.*|domestic violence prevention\b.*|statement of registration\b.*|register of out of state\b.*|sister state judgment\b.*|summary judgment\b.*|labor judgment\b.*|criminal appeal\b.*|small claims appeal\b.*|notice to creditors\b.*)$/i;

function looksLikeBodyAllegation(label) {
  const s = squish(label);
  if (!s) return true;
  if (s.length > 180) return true;
  if (/[.!?]\s+[A-Z]/.test(s)) return true;
  const lower = s.toLowerCase();
  if (/\b(?:at all times|is informed and believes|venue is proper|jurisdiction is proper|realleges|reallege|incorporates?|incorporate by reference)\b/.test(lower)) return true;
  if (/^(?:plaintiff|plaintiffs|defendant|defendants|cross-complainant|cross-complainants|cross-defendant|cross-defendants|petitioner|petitioners|respondent|respondents)\b/.test(lower)) {
    if (/\b(?:is|are|was|were|has|have|alleges?|contends?|claims?|owns?|operates?|resides?|seeks?|brings?|files?|entered|failed|refused)\b/.test(lower)) return true;
  }
  if (/^\d+\s+(?:plaintiff|defendant|petitioner|respondent)\b/i.test(s)) return true;
  return false;
}

function plausibleCauseLabel(label) {
  const s = squish(label);
  if (!s || s.length < 3) return false;
  if (JUNK_LABEL.test(s) || NON_CAUSE_LABEL.test(s) || startsStop(s)) return false;
  if (looksLikeBodyAllegation(s)) return false;
  return true;
}

function fallbackCauseEntry(label) {
  const pretty = prettyLabel(label);
  return plausibleCauseLabel(pretty) ? [{ n: 1, label: pretty }] : [];
}

const ORDINALS = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7,
  eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13,
  fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17,
  eighteenth: 18, nineteenth: 19, twentieth: 20, 'twenty-first': 21,
  'twenty-second': 22, 'twenty-third': 23, 'twenty-fourth': 24,
  'twenty-fifth': 25,
};

// Title-case-ish a mostly-uppercase label while keeping it readable. Leaves
// already mixed-case labels alone; lowercases ALL-CAPS words except short
// connectors and recognised acronyms.
const KEEP_UPPER = new Set([
  'UCL', 'FAL', 'CLRA', 'IIED', 'NIED', 'PAGA', 'FEHA', 'ADA', 'FMLA', 'CFRA',
  'WARN', 'RICO', 'TILA', 'FDCPA', 'FCRA', 'IWC', 'LLC', 'INC', 'LLP', 'PC',
  'USA', 'US', 'CA', 'DBA', 'DFEH', 'EDD', 'IRS', 'DOE', 'I', 'II', 'III', 'IV',
  'V', 'VI', 'VII', 'VIII', 'IX', 'X',
]);
const LOWER_WORDS = new Set([
  'of', 'the', 'and', 'or', 'a', 'an', 'to', 'in', 'for', 'on', 'with', 'by',
  'at', 'as', 'et', 'seq', 'per', 'under', 'from', 'into',
]);

function prettyLabel(raw) {
  let s = squish(raw);
  if (!s) return s;
  // strip a leading conjunction / "and," the OCR sometimes glues on
  s = s.replace(/^(?:and|&)\s+/i, '');
  // strip trailing separators/connectors
  s = s.replace(/[\s;,.:]+$/g, '');
  s = s.replace(/\s+(?:and|&|;)\s*$/i, '');
  // If the string has lowercase letters already, assume it's intentionally
  // mixed case (e.g. "Fraud (Concealment)") and leave it.
  const hasLower = /[a-z]/.test(s.replace(/\([^)]*\)/g, ''));
  if (hasLower) return s;
  // ALL CAPS -> title-ish
  const words = s.split(/(\s+|[()§])/); // keep delimiters
  const out = words.map((w) => {
    if (/^\s+$/.test(w) || w === '(' || w === ')' || w === '§') return w;
    const bare = w.replace(/[^A-Za-z0-9'’\-]/g, '');
    if (!bare) return w;
    if (KEEP_UPPER.has(bare.toUpperCase())) return w; // acronym/roman
    const lw = bare.toLowerCase();
    if (LOWER_WORDS.has(lw)) return w.toLowerCase();
    // Title case, preserving any trailing punctuation captured in w
    return w.replace(bare, bare.charAt(0).toUpperCase() + bare.slice(1).toLowerCase());
  });
  let res = out.join('');
  // Always capitalise the first alphabetic char.
  res = res.replace(/[a-z]/, (c) => c.toUpperCase());
  return squish(res);
}

// Pull a statute citation out of a label. Returns {label, statute|undefined}.
// Recognises a trailing balanced parenthetical that looks like a citation, or
// an inline "<X> Code §..." clause.
function splitStatute(label) {
  let lab = label;
  let statute;

  // Trailing balanced parenthetical (handles nested parens like §1770(a)(5)).
  const tail = takeTrailingParen(lab);
  if (tail) {
    const inner = tail.inner;
    if (/§|\bcode\b|\bsection\b|\bstat\b|\bu\.?s\.?c\.?\b|\bb\.?p\.?c\.?\b|et seq/i.test(inner)) {
      statute = squish(inner);
      lab = tail.before;
    }
  }
  // Inline "... in violation of CAL. LAB. CODE §§ 510, et seq." style.
  if (!statute) {
    const m = lab.match(/\b(?:in violation of\s+)?((?:cal\.?\s+)?[a-z.&'’ ]*?\bcode\b[^;]*?(?:§+\s*[^;]+)?(?:et seq\.?)?)\s*;?\s*$/i);
    if (m && /§|et seq|code/i.test(m[1])) {
      const cand = squish(m[1]);
      // Only peel it off if there's a real label left.
      const rest = squish(lab.slice(0, m.index));
      if (rest.length >= 3) {
        statute = cand;
        lab = rest;
      }
    }
  }
  lab = squish(lab).replace(/[\s;,.]+$/g, '');
  const res = { label: lab };
  if (statute) res.statute = squish(statute).replace(/^[\s(]+|[\s)]+$/g, '');
  return res;
}

// If `s` ends with a balanced parenthetical group, return {before, inner}.
function takeTrailingParen(s) {
  const str = String(s);
  if (!str.trimEnd().endsWith(')')) return null;
  let i = str.length - 1;
  while (i >= 0 && /\s/.test(str[i])) i--;
  if (str[i] !== ')') return null;
  let depth = 0;
  let end = i;
  for (; i >= 0; i--) {
    const ch = str[i];
    if (ch === ')') depth++;
    else if (ch === '(') {
      depth--;
      if (depth === 0) {
        const inner = str.slice(i + 1, end);
        const before = str.slice(0, i);
        return { before, inner };
      }
    }
  }
  return null;
}

// Does the (squished) text begin a stop phrase?
function startsStop(text) {
  const u = squish(text).toUpperCase();
  for (const p of STOP_PHRASES) {
    if (u.startsWith(p)) return true;
  }
  return false;
}

// Heading anchor: a "(CROSS-)COMPLAINT" / "PETITION" pleading title near the top
// of the caption. We want the LAST such heading inside the caption window,
// because the right-column title (the one followed by the cause list) typically
// comes after the left-column attorney block in OCR order.
const HEADING_RE = new RegExp(
  '(?:(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\\s+|amended\\s+|verified\\s+|supplemental\\s+|class\\s+action\\s+|representative\\s+|joint\\s+)*' +
    '(cross-?\\s*complaint|complaint|petition)\\s*(?:for\\b[:\\s]*)?',
  'gi'
);

/**
 * Parse the enumerated causes-of-action list from a pleading's OCR caption.
 * PURE and testable. Returns [{ n, label, statute? }] in pleaded order, deduped.
 * Conservative: returns [] when no confident enumerated list is found.
 *
 * @param {string} ocrText - full OCR text of a complaint/cross-complaint/petition
 * @returns {{n:number,label:string,statute?:string}[]}
 */
export function parseCausesFromCaption(ocrText) {
  if (!isStr(ocrText)) return [];
  // Caption is on page 1; only look at a generous window from the top, but also
  // keep enough for the "FIRST CAUSE OF ACTION" body headers (secondary scan).
  const text = ocrText.replace(/ /g, ' ');
  const captionWindow = text.slice(0, 8000);

  const primary = parseEnumeratedList(captionWindow);
  const secondary = parseCauseOfActionHeaders(text);

  // Choose the better signal. Prefer the enumerated caption list when it is at
  // least as long as the header scan (it's the authoritative right-column list);
  // otherwise fall back to the COA headers.
  let chosen;
  if (primary.length && primary.length >= secondary.length) chosen = primary;
  else if (secondary.length) chosen = secondary;
  else chosen = primary; // possibly []

  return dedupeCauses(chosen);
}

// Core: locate the heading, then walk the enumerated items after it.
function parseEnumeratedList(win) {
  HEADING_RE.lastIndex = 0;
  const anchors = [];
  let m;
  while ((m = HEADING_RE.exec(win)) !== null) {
    anchors.push({ index: m.index, end: m.index + m[0].length, kind: m[1] });
    if (HEADING_RE.lastIndex === m.index) HEADING_RE.lastIndex++;
  }
  if (!anchors.length) {
    // No complaint/petition heading means we cannot distinguish a caption list
    // from numbered body allegations. Stay conservative and let the body-header
    // parser be the only fallback.
    return [];
  }

  // Try each anchor (last first — right column usually trails in OCR order) and
  // take the longest valid list found just after a heading.
  let best = [];
  for (let i = anchors.length - 1; i >= 0; i--) {
    const a = anchors[i];
    const list = walkEnumerated(win, a.end);
    if (list.length > best.length) best = list;
    // A clean >=2 list right at the heading is good enough; keep scanning for
    // a longer one but don't over-search.
  }
  return best;
}

// Starting at `from`, find the first enumerated marker "1." / "1)" / "[1]" and
// walk subsequent markers while the number increments by 1. Returns parsed
// causes. Tolerates the marker appearing a little after `from` (OCR may put line
// numbers / blank lines between heading and list).
function walkEnumerated(win, from) {
  const region = win.slice(from);

  // Marker regex: optional bracket, a 1-2 digit number, then . or ) or ] .
  // We deliberately exclude bare digits with no punctuation (those are line nos).
  const markerRe = /(?:^|[\s(\[])(\[?)(\d{1,2})(\]|[.)])/g;

  // Collect all candidate markers with positions.
  const marks = [];
  let mm;
  while ((mm = markerRe.exec(region)) !== null) {
    const num = parseInt(mm[2], 10);
    // position of the digit
    const at = mm.index + mm[0].indexOf(mm[2]);
    const afterMarker = mm.index + mm[0].length;
    const nextCh = region[afterMarker] || '';
    if (nextCh === ')' || nextCh === ']') continue;
    marks.push({ num, at, after: afterMarker, bracket: mm[1] === '[' });
  }
  if (!marks.length) return [];

  // Find a starting marker whose number is 1 (or, if no 1, the smallest leading
  // number) and that begins a run 1,2,3,... Allow the list to start within the
  // first part of the region only (caption, not deep body).
  let start = -1;
  for (let i = 0; i < marks.length; i++) {
    if (marks[i].num === 1 && marks[i].at < 1200) { start = i; break; }
  }
  if (start === -1) {
    // No "1." near the top — give up (avoids latching onto body paragraph runs).
    return [];
  }

  const causes = [];
  let expected = 1;
  let idx = start;
  let guard = 0;
  while (idx < marks.length && guard++ < 60) {
    const cur = marks[idx];
    if (cur.num !== expected) {
      // tolerate a single OCR hiccup: look ahead one marker for the expected num
      const nextSame = marks[idx + 1];
      if (nextSame && nextSame.num === expected) {
        idx++;
        continue;
      }
      break;
    }
    // Find where this item's text ends: at the next marker that is expected+1,
    // OR at a stop phrase, OR end of region.
    let nextStart = region.length;
    let j = idx + 1;
    for (; j < marks.length; j++) {
      if (marks[j].num === expected + 1) { nextStart = marks[j].at; break; }
      if (marks[j].at > cur.after) { nextStart = marks[j].at; break; }
      if (marks[j].num === 1 && marks[j].at - cur.after > 40) {
        // a reset to 1 (body paragraphs) — list ends here
        nextStart = marks[j].at;
        break;
      }
    }
    let segment = region.slice(cur.after, nextStart);

    // Truncate the segment at the first stop phrase.
    const cut = earliestStop(segment);
    if (cut >= 0) segment = segment.slice(0, cut);

    const label0 = squish(segment);
    if (plausibleCauseLabel(label0)) {
      const { label, statute } = splitStatute(label0);
      const pretty = prettyLabel(label);
      if (plausibleCauseLabel(pretty)) {
        const c = { n: expected, label: pretty };
        if (statute) c.statute = statute;
        causes.push(c);
      }
    } else if (causes.length) {
      // hit junk/stop after we already have items -> stop the list
      break;
    }

    // Advance to the marker that started the next item, if it was expected+1.
    if (nextStart < region.length && marks[j] && marks[j].num === expected + 1) {
      idx = j;
      expected += 1;
    } else {
      break; // no clean continuation
    }
  }

  // Require at least one real cause; single-cause complaints are valid.
  return causes;
}

// Index of the earliest stop phrase in `segment`, or -1.
function earliestStop(segment) {
  const u = segment.toUpperCase();
  let best = -1;
  for (const p of STOP_PHRASES) {
    const k = u.indexOf(p);
    if (k >= 0 && (best === -1 || k < best)) best = k;
  }
  return best;
}

// Secondary signal: scan the body for "<ORDINAL> CAUSE OF ACTION (label)" or
// "<ORDINAL> CAUSE OF ACTION\n(For Breach of Contract ...)" headers.
function parseCauseOfActionHeaders(text) {
  const causes = [];
  const seenN = new Set();
  const re =
    /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|twenty-first|twenty-second|twenty-third|twenty-fourth|twenty-fifth)\s+(?:and\s+\w+\s+)?cause[s]?\s+of\s+action\b/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const n = ORDINALS[m[1].toLowerCase()];
    if (!n || seenN.has(n)) continue;
    // Capture label: a trailing parenthetical on the same/next lines, or the
    // "(For X)" / "— X" that usually follows.
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 200);
    let label = '';
    const par = after.match(/^\s*[\(\[]\s*(?:for\s+)?([^)\]]{3,120})[\)\]]/i);
    if (par) {
      label = par[1];
    } else {
      const dash = after.match(/^\s*(?:[-–—:]\s*)?(?:for\s+)?([A-Z][^\n.;]{3,90})/);
      if (dash) label = dash[1];
    }
    label = squish(label).replace(/\b(against|by|as to)\b.*$/i, '');
    if (!label) continue;
    const { label: lab, statute } = splitStatute(label);
    const pretty = prettyLabel(lab);
    if (!plausibleCauseLabel(pretty)) continue;
    seenN.add(n);
    const c = { n, label: pretty };
    if (statute) c.statute = statute;
    causes.push(c);
  }
  causes.sort((a, b) => a.n - b.n);
  return causes;
}

// Dedupe by normalised label, keep first (lowest n), renumber sequentially is
// NOT done — we preserve pleaded n. We only drop exact-ish duplicate labels.
function dedupeCauses(list) {
  const out = [];
  const seen = new Set();
  for (const c of list) {
    if (!c || !isStr(c.label)) continue;
    const key = c.label.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

// ----------------------------- petitionFor ----------------------------------

// Derive the relief a petition seeks from its description, e.g.
// "PETITION FOR PROBATE OF WILL AND FOR LETTERS TESTAMENTARY, NO WILL FILED ..."
// -> "Probate of Will and for Letters Testamentary".
function petitionForFromDesc(desc) {
  if (!isStr(desc)) return null;
  let s = squish(desc);
  // Drop common prefixes.
  s = s.replace(/^\s*(amended|second amended|first amended|verified|supplemental)\s+/i, '');
  const m = s.match(/\bpetition\s+(?:for|to)\b[:\s]*([^]*?)(?:\s+(?:filed by|\(transaction id|as to|no will filed|with will annexed|will annexed)\b|,|$)/i);
  let relief = m ? m[1] : null;
  if (!relief) {
    const m2 = s.match(/\bpetition\b[:\s]*([A-Za-z][^,(]{3,80})/i);
    relief = m2 ? m2[1] : null;
  }
  if (!relief) return null;
  relief = squish(relief).replace(/[\s,;:.]+$/g, '');
  // strip checkbox artefacts / brackets
  relief = relief.replace(/\[[^\]]*\]/g, ' ').replace(/[\[\]]/g, ' ');
  relief = squish(relief);
  if (!relief || relief.length < 3) return null;
  return prettyLabel(relief);
}

// Is this record a probate / petition matter (vs. a civil complaint)?
function looksLikePetitionCase(rec, pleadings) {
  const cn = (rec && rec.case_number ? String(rec.case_number) : '').toUpperCase();
  if (/^P(ES|ER|CN|TR|RO|FA|G)\b|^P(ES|ER|CN|TR|RO|FA|G)\d/.test(cn)) return true;
  // CGC + a petition pleading but no complaint pleading -> petition matter.
  if (pleadings.petition.length && !pleadings.complaint.length) return true;
  return false;
}

// ----------------------------- top-level API --------------------------------

/**
 * Extract causes of action for a case from its complaint / cross-complaint /
 * counterclaim (or operative petition) OCR captions ONLY.
 *
 * @param {object} rec - case record (archive/cases/<case>.json)
 * @param {(sha256:string)=>Promise<string|null>} fetchOcr - async; returns the
 *        full OCR `text` for a content hash, or null if unavailable.
 * @returns {Promise<{
 *   kind:'complaint'|'petition',
 *   filed:string|null,
 *   petitionFor:string|null,
 *   complaint:{n:number,label:string,statute?:string}[],
 *   crossComplaint:{n:number,label:string,statute?:string}[],
 *   source:'ocr'|'description'|'none',
 *   available:boolean,
 *   note?:string
 * }>}
 */
export async function extractCausesOfAction(rec, fetchOcr) {
  const fetch = typeof fetchOcr === 'function' ? fetchOcr : async () => null;
  const pleadings = findPleadingDocs(rec || {});
  const isPetition = looksLikePetitionCase(rec || {}, pleadings);
  const kind = isPetition ? 'petition' : 'complaint';

  // Operative pleading set for the chosen kind.
  const primaryDocs = isPetition && pleadings.petition.length
    ? pleadings.petition
    : pleadings.complaint;

  const result = {
    kind,
    filed: primaryDocs.length ? primaryDocs[0].filed || null : null,
    petitionFor: null,
    complaint: [],
    crossComplaint: [],
    source: 'none',
    available: false,
  };

  if (isPetition && primaryDocs.length) {
    result.petitionFor = petitionForFromDesc(primaryDocs[0].description);
  }

  // Helper: run OCR -> parse over a list of doc rows, union causes in order.
  async function causesFor(docRows) {
    // Prefer operative (already sorted operative-first). Try each captured doc
    // until we get a confident list; union across versions if partial.
    let got = [];
    let usedOcr = false;
    for (const d of docRows) {
      if (!d.sha256) continue;
      let txt = null;
      try {
        txt = await fetch(d.sha256);
      } catch (_e) {
        txt = null;
      }
      if (!isStr(txt)) continue;
      usedOcr = true;
      const parsed = parseCausesFromCaption(txt);
      if (parsed.length > got.length) got = parsed;
      if (got.length >= 1 && d.rank > 0) break; // operative amended w/ causes: done
    }
    return { causes: got, usedOcr };
  }

  const comp = await causesFor(primaryDocs);
  const cross = await causesFor(pleadings.crossComplaint);

  result.complaint = comp.causes;
  result.crossComplaint = cross.causes;

  const anyDocRows = primaryDocs.length || pleadings.crossComplaint.length;
  const anyCaptured = primaryDocs.some((d) => d.sha256) ||
    pleadings.crossComplaint.some((d) => d.sha256);
  const gotOcrCauses = result.complaint.length || result.crossComplaint.length;

  if (gotOcrCauses) {
    result.source = 'ocr';
    result.available = true;
  } else if (anyCaptured && (comp.usedOcr || cross.usedOcr)) {
    // OCR existed but no enumerated list was confidently found.
    // Fall back to the document description as a coarse cause label.
    const fb = descriptionFallback(rec, primaryDocs, isPetition);
    if (fb.length) {
      result.complaint = fb;
      result.source = 'description';
      result.available = true;
      result.note = 'no enumerated cause list found in OCR caption; using document description';
    } else {
      result.source = 'none';
      result.available = true; // doc is here, we just couldn't enumerate
      result.note = 'complaint captured but no cause list parsed';
    }
  } else if (anyDocRows && anyCaptured) {
    result.source = 'none';
    result.available = false;
    result.note = isPetition
      ? 'petition OCR not available'
      : 'complaint OCR not available';
  } else if (anyDocRows && !anyCaptured) {
    // Pleading exists in the docket but its bytes/OCR were never captured.
    const fb = descriptionFallback(rec, primaryDocs, isPetition);
    if (fb.length) {
      result.complaint = fb;
      result.source = 'description';
      result.available = false;
      result.note = 'complaint document not captured; causes inferred from docket description';
    } else {
      result.source = 'none';
      result.available = false;
      result.note = isPetition
        ? 'petition document not captured'
        : 'complaint document not captured';
    }
  } else {
    result.source = 'none';
    result.available = false;
    result.note = isPetition
      ? 'no petition document found'
      : 'no complaint document found';
  }

  return result;
}

// Coarse fallback: turn the operative pleading description (or rec.cause_of_action)
// into one or more cause entries. Used only when OCR can't yield an enumerated
// list. Honest, low-confidence.
function descriptionFallback(rec, docRows, isPetition) {
  // Probate: use petitionFor.
  if (isPetition) {
    const pf = docRows.length ? petitionForFromDesc(docRows[0].description) : null;
    if (pf) return [{ n: 1, label: pf }];
    return [];
  }
  // Civil: the case's own cause_of_action field sometimes carries the COA, e.g.
  // "OTHER NON EXEMPT COMPLAINTS (COMPLAINT FOR CIVIL PENALTIES AND INJUNCTIVE RELIEF)".
  const coa = rec && isStr(rec.cause_of_action) ? rec.cause_of_action : '';
  if (coa) {
    // Prefer the parenthetical "COMPLAINT FOR ..." if present.
    const m = coa.match(/complaint\s+for\s+([^)]+)/i);
    const fb = fallbackCauseEntry(m ? m[1] : coa.replace(/\(.*?\)/g, ''));
    if (fb.length) return fb;
  }
  // Else derive from the complaint description's "COMPLAINT FOR ..." clause.
  const desc = docRows.length ? docRows[0].description : '';
  const dm = desc.match(/complaint\s+for\s+([^,(]+)/i);
  if (dm) {
    const fb = fallbackCauseEntry(dm[1]);
    if (fb.length) return fb;
  }
  return [];
}
