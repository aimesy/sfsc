const htmlEscapeMap = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const CASE_STATE_LABELS = {
  complete: 'entirely complete',
  discovered: 'discovered, not scanned',
  essential: 'complaint and orders captured',
  indexed: 'indexed',
  'not-found': 'no matching case-number response',
  'no-docs': 'docket only',
  'partial-docs': 'partial docs',
  restricted: 'court-restricted (unavailable)',
  'summary-only': 'docket complete',
};

const CASE_STATE_ICON_CLASSES = {
  complete: 'cs-case-state-check',
  discovered: 'cs-case-state-discovered',
  essential: 'cs-case-state-ring',
  indexed: 'cs-case-state-indexed',
  'not-found': 'cs-case-state-not-found',
  'no-docs': 'cs-case-state-summary',
  'partial-docs': 'cs-case-state-partial',
  restricted: 'cs-case-state-restricted',
  'summary-only': 'cs-case-state-dot',
};

const CASE_STATE_LEGEND = [
  ['complete', 'complete'],
  ['essential', 'core docs'],
  ['partial-docs', 'partial docs'],
  ['no-docs', 'docket only'],
  ['summary-only', 'docket complete'],
  ['indexed', 'indexed'],
  ['discovered', 'discovered'],
  ['restricted', 'restricted'],
];

const DISCOVERED_LIKE_STATE_KEYS = new Set(['discovered', 'indexed']);

const CASE_PREFIX_GROUP_ORDER = ['Civil', 'Family', 'Probate', 'Appeals', 'Criminal', 'Legacy', 'Other'];

const CASE_PREFIX_COURT_CODES = {
  A: 'Appeals',
  C: 'Civil',
  F: 'Family',
  P: 'Probate',
};

const CASE_PREFIX_TYPE_NAMES = {
  AC: 'CARE Act Cases',
  AD: 'Adoption',
  AO: 'Mental Health - Assisted Outpatient Treatment',
  CH: 'Harassment',
  CN: 'Conservatorship',
  CS: 'Child Support',
  DI: 'Dissolution',
  DV: 'Domestic Violence',
  DW: 'Deposited Wills',
  DX: 'Deposited Wills',
  ED: 'Elder and Dependent Abuse',
  ES: 'Estate',
  GC: 'General Civil',
  GN: 'Guardianship',
  HO: 'Mental Health - Hold',
  JC: 'Judicial Council Coordinated Cases',
  JD: 'Juvenile Dependency',
  JW: 'Juvenile Criminal',
  LD: 'Juvenile Custody',
  LM: 'Civil Limited',
  MH: 'Mental Health',
  MS: 'Miscellaneous',
  NC: 'Name Change',
  PF: 'Petition',
  PP: 'Criminal/Traffic',
  PT: 'Parentage',
  SD: 'Summary Dissolution',
  SM: 'Small Claims',
  TR: 'Trust',
  UD: 'Unlawful Detainer',
  WH: 'Writ of Habeas Corpus',
};

const CASE_PREFIX_METADATA = {
  AJD: ['Appeals', 'Juvenile Dependency'],
  AJW: ['Appeals', 'Juvenile Criminal'],
  ALM: ['Appeals', 'Civil Limited', 2002],
  APP: ['Appeals', 'Appeals'],
  CAC: ['Civil', 'CARE Act Cases'],
  CCH: ['Civil', 'Harassment'],
  CGC: ['Civil', 'General Civil'],
  CJC: ['Civil', 'Judicial Council Coordinated Cases'],
  CNC: ['Civil', 'Name Change'],
  CPF: ['Civil', 'Petition'],
  CMS: ['Civil', 'Miscellaneous', 1987],
  CSM: ['Civil', 'Small Claims'],
  CUD: ['Civil', 'Unlawful Detainer'],
  DPO: ['Family', 'Declaration of Domestic Partnership', 2001],
  FAD: ['Family', 'Adoption'],
  FCS: ['Family', 'Child Support'],
  FDI: ['Family', 'Dissolution'],
  FDV: ['Family', 'Domestic Violence'],
  FJD: ['Family', 'Juvenile Dependency Mediation'],
  FLD: ['Family', 'Juvenile Custody'],
  FMS: ['Family', 'Miscellaneous'],
  FPT: ['Family', 'Parentage'],
  FSD: ['Family', 'Summary Dissolution'],
  PAO: ['Probate', 'Mental Health - Assisted Outpatient Treatment'],
  PCN: ['Probate', 'Conservatorship'],
  PDW: ['Probate', 'Deposited Wills'],
  PDX: ['Probate', 'Deposited Wills'],
  PED: ['Probate', 'Elder and Dependent Abuse', 2013],
  PES: ['Probate', 'Estate'],
  PGN: ['Probate', 'Guardianship'],
  PHO: ['Probate', 'Mental Health - Hold'],
  PMH: ['Probate', 'Mental Health'],
  PPF: ['Probate', 'Petition', 1999],
  PTR: ['Probate', 'Trust'],
  PWH: ['Probate', 'Writ of Habeas Corpus'],
  CRI: ['Criminal', 'Criminal'],
};

function derivedCasePrefixMetadata(code) {
  if (!/^[A-Z][A-Z0-9]{2}$/.test(code)) return null;
  const group = CASE_PREFIX_COURT_CODES[code[0]];
  const name = CASE_PREFIX_TYPE_NAMES[code.slice(1)];
  return group && name ? [group, name] : null;
}

const finiteNumberOrZero = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const nonNegativeNumberOrZero = (value) => Math.max(0, finiteNumberOrZero(value));

function normalizedPrefix(value) {
  const text = String(value ?? '').trim();
  if (!text || text === '(none)') return '(none)';
  return text.toUpperCase().replace(/[^A-Z0-9]/g, '') || '(none)';
}

export function caseDirectoryPrefixInfo(prefix) {
  const code = normalizedPrefix(prefix);
  if (code === '(none)') {
    return {
      code,
      group: 'Legacy',
      name: 'No Prefix / Legacy',
      label: 'No Prefix / Legacy',
      retiredYear: null,
      groupSort: CASE_PREFIX_GROUP_ORDER.indexOf('Legacy'),
    };
  }
  const official = CASE_PREFIX_METADATA[code] || derivedCasePrefixMetadata(code);
  if (!official) {
    return {
      code,
      group: 'Other',
      name: code,
      label: code,
      retiredYear: null,
      groupSort: CASE_PREFIX_GROUP_ORDER.indexOf('Other'),
    };
  }
  const [group, name, retiredYear = null] = official;
  return {
    code,
    group,
    name,
    retiredYear,
    label: group === 'Criminal' ? 'Criminal' : `${group} - ${name}`,
    groupSort: CASE_PREFIX_GROUP_ORDER.indexOf(group),
  };
}

export function caseDirectoryPrefixLabel(prefix) {
  const info = caseDirectoryPrefixInfo(prefix);
  return info.code === '(none)' ? info.label : `${info.label} (${info.code})`;
}

export function compareCaseDirectoryPrefixGroups(a, b) {
  const ai = CASE_PREFIX_GROUP_ORDER.indexOf(String(a || ''));
  const bi = CASE_PREFIX_GROUP_ORDER.indexOf(String(b || ''));
  const as = ai < 0 ? CASE_PREFIX_GROUP_ORDER.length : ai;
  const bs = bi < 0 ? CASE_PREFIX_GROUP_ORDER.length : bi;
  return (as - bs) || String(a || '').localeCompare(String(b || ''));
}

export function compareCaseDirectoryPrefixCodes(a, b) {
  const ai = caseDirectoryPrefixInfo(a);
  const bi = caseDirectoryPrefixInfo(b);
  return compareCaseDirectoryPrefixGroups(ai.group, bi.group)
    || ai.label.localeCompare(bi.label)
    || ai.code.localeCompare(bi.code);
}

export function caseDirectoryEscapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => htmlEscapeMap[c]);
}

export function caseIndexState(row = {}) {
  const scanState = String(row?.scan_state || '').trim().toLowerCase();
  if (scanState === 'discovered') return { key: 'discovered', label: CASE_STATE_LABELS.discovered };
  if (scanState === 'not_found' || scanState === 'not-found') return { key: 'not-found', label: CASE_STATE_LABELS['not-found'] };
  if (scanState === 'restricted') return { key: 'restricted', label: CASE_STATE_LABELS.restricted };
  if (scanState === 'no_docs' || scanState === 'no-docs' || scanState === 'indexed_no_docs') {
    return { key: 'no-docs', label: CASE_STATE_LABELS['no-docs'] };
  }
  if (scanState === 'summary_only') {
    return { key: 'summary-only', label: CASE_STATE_LABELS['summary-only'] };
  }
  if (scanState === 'partial_docs') return { key: 'partial-docs', label: CASE_STATE_LABELS['partial-docs'] };
  if (scanState === 'indexed') return { key: 'indexed', label: CASE_STATE_LABELS.indexed };
  if (scanState === 'complete') return { key: 'complete', label: CASE_STATE_LABELS.complete };
  if (scanState === 'core_docs' || scanState === 'essential') return { key: 'essential', label: CASE_STATE_LABELS.essential };
  const docs = Number(row?.n_documents ?? row?.documents_total ?? row?.documents);
  const bytes = Number(row?.documents_bytes_count ?? row?.documents_with_bytes ?? row?.captured_documents);
  const deferred = Number(row?.documents_deferred_count ?? row?.deferred_documents);
  const byteScope = String(row?.document_byte_capture_scope || row?.byte_capture_scope || '').toLowerCase();
  if (String(row?.archive_status || '').toLowerCase() === 'discovered' && !row?.captured_at) {
    return { key: 'discovered', label: CASE_STATE_LABELS.discovered };
  }
  if (Number.isFinite(docs) && docs === 0 && row?.document_bytes_captured === true) {
    return { key: 'no-docs', label: CASE_STATE_LABELS['no-docs'] };
  }
  if (byteScope === 'docket-only' || (Number.isFinite(docs) && docs > 0 && Number.isFinite(bytes) && bytes === 0)) {
    return { key: 'summary-only', label: CASE_STATE_LABELS['summary-only'] };
  }
  if (Number.isFinite(deferred) && deferred > 0 && (!Number.isFinite(bytes) || bytes === 0)) {
    return { key: 'summary-only', label: CASE_STATE_LABELS['summary-only'] };
  }
  if (Number.isFinite(docs) && docs === 0) return { key: 'summary-only', label: CASE_STATE_LABELS['summary-only'] };
  if (Number.isFinite(docs) && docs > 0 && Number.isFinite(bytes) && bytes > 0) {
    return { key: 'partial-docs', label: CASE_STATE_LABELS['partial-docs'] };
  }
  if (row?.document_bytes_captured === true && Number.isFinite(docs) && docs > 0 && Number.isFinite(bytes) && bytes >= docs) {
    return { key: 'complete', label: CASE_STATE_LABELS.complete };
  }
  if (Number.isFinite(bytes) && bytes > 0 && row?.document_bytes_captured !== true) {
    return { key: 'essential', label: CASE_STATE_LABELS.essential };
  }
  return { key: 'indexed', label: CASE_STATE_LABELS.indexed };
}

export function caseStateIconHtml(state = {}) {
  const key = String(state?.key || '');
  const title = caseDirectoryEscapeHtml(state?.label || CASE_STATE_LABELS[key] || CASE_STATE_LABELS.indexed);
  const iconClass = CASE_STATE_ICON_CLASSES[key];
  if (iconClass) {
    return `<span class="cs-case-state" title="${title}" aria-label="${title}"><span class="${iconClass}"></span></span>`;
  }
  return `<span class="cs-case-state cs-case-state-empty" title="${title}" aria-label="${title}"></span>`;
}

export function caseStateLegendHtml() {
  return `<span class="cs-case-legend" aria-label="Case index status legend">`
    + CASE_STATE_LEGEND.map(([key, label]) => (
      `<span class="cs-case-legend-item"><span class="cs-case-state" aria-hidden="true"><i class="${CASE_STATE_ICON_CLASSES[key]}"></i></span>${label}</span>`
    )).join('')
    + `</span>`;
}

export const casePlural = (n) => n.toLocaleString() + ' docket' + (n === 1 ? '' : 's');
export const discoveredPlural = (n) => n.toLocaleString() + ' discovered';
export const restrictedPlural = (n) => n.toLocaleString() + ' restricted';
export const notFoundPlural = (n) => n.toLocaleString() + ' no-match';

export function caseDirectoryCapturedCount(dir = {}) {
  if (dir && Object.prototype.hasOwnProperty.call(dir, 'case_count')) {
    return nonNegativeNumberOrZero(dir.case_count);
  }
  return nonNegativeNumberOrZero(dir?.source_counts?.case_index_rows);
}

export function caseDirectoryDiscoveredCount(dir = {}) {
  if (dir && Object.prototype.hasOwnProperty.call(dir, 'discovered_count')) {
    return nonNegativeNumberOrZero(dir.discovered_count);
  }
  const counts = dir?.scan_state_counts || {};
  return nonNegativeNumberOrZero(counts.discovered) + nonNegativeNumberOrZero(counts.indexed);
}

export function caseDirectoryRestrictedCount(dir = {}) {
  if (dir && Object.prototype.hasOwnProperty.call(dir, 'restricted_count')) {
    return nonNegativeNumberOrZero(dir.restricted_count);
  }
  return nonNegativeNumberOrZero(dir?.scan_state_counts?.restricted);
}

export function caseDirectoryNotFoundCount(dir = {}) {
  if (dir && Object.prototype.hasOwnProperty.call(dir, 'not_found_count')) {
    return nonNegativeNumberOrZero(dir.not_found_count);
  }
  return nonNegativeNumberOrZero(dir?.scan_state_counts?.not_found);
}

export function caseDirectoryCountLabel(dir = {}) {
  return caseDiscoveryPlural(
    caseDirectoryCapturedCount(dir),
    caseDirectoryDiscoveredCount(dir),
    caseDirectoryRestrictedCount(dir),
    caseDirectoryNotFoundCount(dir),
  );
}

export function caseDiscoveryPlural(caseCount, discoveredCount = 0, restrictedCount = 0, notFoundCount = 0) {
  const cases = nonNegativeNumberOrZero(caseCount);
  const restricted = nonNegativeNumberOrZero(restrictedCount);
  const notFound = nonNegativeNumberOrZero(notFoundCount);
  const discovered = finiteNumberOrZero(discoveredCount);
  let s = casePlural(cases);
  if (restricted > 0) s += ` + ${restrictedPlural(restricted)}`;
  if (notFound > 0) s += ` + ${notFoundPlural(notFound)}`;
  if (discovered > 0) s += ` + ${discoveredPlural(discovered)}`;
  return s;
}

export function caseRowsSummary(rows) {
  const list = Array.isArray(rows) ? rows : [];
  let discovered = 0;
  let restricted = 0;
  let notFound = 0;
  for (const row of list) {
    const key = caseIndexState(row).key;
    if (DISCOVERED_LIKE_STATE_KEYS.has(key)) discovered++;
    else if (key === 'restricted') restricted++;
    else if (key === 'not-found') notFound++;
  }
  return caseDiscoveryPlural(list.length - discovered - restricted - notFound, discovered, restricted, notFound);
}

export function caseRowOpenable(row = {}) {
  const key = caseIndexState(row).key;
  return !!String(row?.case_number || '').trim() && key !== 'discovered' && key !== 'not-found';
}

export function caseRowSelectable(row = {}) {
  return caseRowOpenable(row);
}
