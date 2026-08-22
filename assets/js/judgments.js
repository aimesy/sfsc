const JUDGMENT_MANIFEST_URL = './data/judgments/manifest.json';
const JUDGMENT_RAW_BASE_URL = 'https://raw.githubusercontent.com/aimesy/sfsc-data/master/data/judgments/';
const EXPECTED_MANIFEST = Object.freeze({
  schema_versions: Object.freeze([1, 2, 4]),
  shard_pattern: 'shards/{shard}.json',
  hash_algorithm: 'sha256_first_byte',
  rule_id: 'sfsc.strict_judgment_end_state',
});
const EXPECTED_SHARD_SCHEMA_VERSION = 1;
const MANIFEST_PROVENANCE_SCHEMA_VERSIONS = new Set([4]);
const SEMANTIC_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const GIT_COMMIT_PATTERN = /^[0-9a-f]{40}$/i;

let manifestPromise = null;
const shardPromises = new Map();

export function normalizeJudgmentCaseNumber(value) {
  return String(value ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

export async function judgmentShardForCase(caseNumber) {
  const normalized = normalizeJudgmentCaseNumber(caseNumber);
  if (!normalized) return '';
  const bytes = new TextEncoder().encode(normalized);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return digest[0].toString(16).padStart(2, '0');
}

export function escapeJudgmentHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function label(value) {
  return String(value ?? '')
    .replace(/[_/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const EVENT_KIND_LABELS = Object.freeze({
  amended_judgment: 'Amended judgment',
  appeal_affirmed: 'Appeal affirmed',
  appeal_dismissed: 'Appeal dismissed',
  appeal_mixed: 'Mixed appellate disposition',
  appeal_modified: 'Appeal modified',
  appeal_reference: 'Appeal reference',
  appeal_reversed: 'Appeal reversed',
  default_judgment: 'Default judgment',
  'declaratory/injunctive': 'Declaratory or injunctive judgment',
  dismissal: 'Dismissal',
  family_custody_modification: 'Child custody modification',
  family_custody_order: 'Child custody order',
  family_judgment: 'Family judgment',
  family_order_reference: 'Family-order reference',
  family_property_judgment: 'Family property judgment',
  family_restraining_order: 'Family restraining order',
  family_support_modification: 'Support modification',
  family_support_order: 'Support order',
  judgment: 'Judgment',
  judgment_of_dismissal: 'Judgment of dismissal',
  judgment_reference: 'Judgment reference',
  monetary_judgment: 'Money judgment',
  partial_satisfaction: 'Partial satisfaction',
  possession: 'Possession judgment',
  probate_account_order: 'Probate account order',
  probate_decree: 'Probate decree',
  probate_discharge_order: 'Probate discharge order',
  probate_letters_order: 'Probate letters order',
  probate_order_reference: 'Probate-order reference',
  renewal: 'Judgment renewal',
  renewal_reference: 'Renewal reference',
  satisfaction: 'Satisfaction',
  satisfaction_reference: 'Satisfaction reference',
  take_nothing: 'Take-nothing judgment',
  unknown_end_state: 'Unresolved judgment reference',
  vacatur: 'Vacatur',
  vacatur_reference: 'Vacatur reference',
  writ_denied: 'Writ denied',
  writ_dismissed: 'Writ dismissed',
  writ_disposition: 'Writ disposition',
  writ_granted: 'Writ granted',
  writ_interim_order: 'Interim writ order',
  writ_reference: 'Writ reference',
});

const DOMAIN_LABELS = Object.freeze({
  appellate_disposition: 'Appellate disposition',
  child_custody: 'Child custody',
  child_support: 'Child support',
  criminal_sentence: 'Criminal sentence',
  declaratory_injunctive: 'Declaratory or injunctive',
  dismissal: 'Dismissal',
  domestic_violence_restraint: 'Domestic violence restraint',
  family_property: 'Family property',
  family_status: 'Family status',
  money_judgment: 'Money judgment',
  nonoperative_reference: 'Nonoperative reference',
  partial_satisfaction: 'Partial satisfaction',
  possession: 'Possession',
  probate_account: 'Probate account',
  probate_discharge: 'Probate discharge',
  probate_distribution: 'Probate distribution',
  probate_letters: 'Probate letters',
  renewal: 'Renewal',
  satisfaction: 'Satisfaction',
  spousal_support: 'Spousal support',
  take_nothing: 'Take nothing',
  unknown_end_state: 'Unresolved reference',
  vacatur: 'Vacatur',
  writ_petition: 'Writ petition',
});

function eventKindLabel(value) {
  const key = String(value ?? '').trim();
  return EVENT_KIND_LABELS[key] || label(key) || 'Event';
}

function canonicalOutcomeComponents(...values) {
  for (const value of values) {
    if (!Array.isArray(value)) continue;
    const components = value.map((item) => String(item ?? '').trim()).filter(Boolean);
    if (components.length) return components;
  }
  return [];
}

function outcomeComponentsText(components) {
  return canonicalOutcomeComponents(components).map(label).join(' + ');
}

function observedDispositionLabel(kind, components) {
  const observed = outcomeComponentsText(components);
  if (!observed) return eventKindLabel(kind);
  return observed.charAt(0).toUpperCase() + observed.slice(1);
}

const EVENT_RESULT_LABELS = Object.freeze({
  amended_judgment: 'Amended judgment entered',
  appeal_affirmed: 'Judgment or order affirmed on appeal',
  appeal_dismissed: 'Appeal dismissed',
  appeal_modified: 'Judgment or order modified on appeal',
  appeal_reversed: 'Judgment or order reversed on appeal',
  criminal_sentence: 'Criminal sentence entered',
  criminal_sentence_modification: 'Criminal sentence modified',
  default_judgment: 'Default judgment entered',
  'declaratory/injunctive': 'Declaratory or injunctive judgment entered',
  dismissal: 'Dismissal entered',
  family_judgment: 'Family law judgment entered',
  family_property_judgment: 'Family property judgment entered',
  family_restraining_order: 'Domestic violence restraining order entered',
  judgment: 'Judgment entered',
  judgment_of_dismissal: 'Judgment of dismissal entered',
  monetary_judgment: 'Money judgment entered',
  name_change_decree: 'Name change decree entered',
  partial_satisfaction: 'Partial satisfaction of judgment on file',
  possession: 'Possession judgment entered',
  probate_account_order: 'Probate account order entered',
  probate_decree: 'Probate decree entered',
  probate_discharge_order: 'Probate discharge order entered',
  probate_distribution_order: 'Probate distribution order entered',
  probate_letters_order: 'Probate letters order entered',
  remittitur: 'Remittitur issued',
  renewal: 'Renewal of judgment on file',
  satisfaction: 'Satisfaction of judgment on file',
  take_nothing: 'Take nothing judgment entered',
  vacatur: 'Judgment or order vacated',
  writ_denied: 'Writ denied',
  writ_dismissed: 'Writ petition dismissed',
  writ_disposition: 'Writ disposition entered',
  writ_granted: 'Writ granted',
  writ_interim_order: 'Interim writ order entered',
});

const DOMAIN_RESULT_LABELS = Object.freeze({
  appellate_disposition: 'Appellate disposition entered',
  child_custody: 'Child custody order entered',
  child_support: 'Child support order entered',
  criminal_sentence: 'Criminal sentence entered',
  declaratory_injunctive: 'Declaratory or injunctive judgment entered',
  dismissal: 'Dismissal entered',
  domestic_violence_restraint: 'Domestic violence restraining order entered',
  family_property: 'Family property judgment entered',
  family_status: 'Family law judgment entered',
  family_support: 'Family support order entered',
  money_judgment: 'Money judgment entered',
  name_change: 'Name change decree entered',
  partial_satisfaction: 'Partial satisfaction of judgment on file',
  possession: 'Possession judgment entered',
  probate_account: 'Probate account order entered',
  probate_discharge: 'Probate discharge order entered',
  probate_distribution: 'Probate distribution order entered',
  probate_letters: 'Probate letters order entered',
  renewal: 'Renewal of judgment on file',
  satisfaction: 'Satisfaction of judgment on file',
  spousal_support: 'Spousal support order entered',
  take_nothing: 'Take nothing judgment entered',
  vacatur: 'Judgment or order vacated',
  writ_petition: 'Writ disposition entered',
});

const FAMILY_SUPPORT_DOMAINS = Object.freeze([
  ['child_support', 'Child support'],
  ['spousal_support', 'Spousal support'],
  ['family_support', 'Family support'],
]);

function joinNatural(items) {
  if (items.length < 2) return items[0] || '';
  if (items.length === 2) return `${items[0]} and ${items[1].toLowerCase()}`;
  return `${items.slice(0, -1).join(', ')}, and ${items.at(-1).toLowerCase()}`;
}

function supportLabelForDomains(domainSet, currentDomain = '') {
  const current = FAMILY_SUPPORT_DOMAINS.find(([domain]) => domain === currentDomain);
  if (current) return current[1];
  const present = FAMILY_SUPPORT_DOMAINS.filter(([domain]) => domainSet.has(domain)).map(([, text]) => text);
  if (present.length === 2 && present.includes('Child support') && present.includes('Spousal support')) {
    return 'Child and spousal support';
  }
  return joinNatural(present);
}

function relatedFamilyOrderLabel(kind, domainSet, currentDomain) {
  const support = supportLabelForDomains(domainSet, currentDomain);
  const hasCustody = domainSet.has('child_custody');
  if (kind === 'family_support_order') {
    if (support && hasCustody) return `${support} and custody order entered`;
    return `${support || 'Support'} order entered`;
  }
  if (kind === 'family_custody_order') {
    if (support) return `${support} and custody order entered`;
    return 'Child custody order entered';
  }
  if (kind === 'family_support_modification') {
    if (support && hasCustody) return `${support} modified; custody order also on file`;
    return `${support || 'Support'} order modified`;
  }
  if (kind === 'family_custody_modification') {
    if (support) return `Child custody modified; ${support.toLowerCase()} order also on file`;
    return 'Child custody order modified';
  }
  return '';
}

/**
 * Turn canonical outcome fields into a concise result for readers. This only
 * interprets the extractor's enums; it never classifies or rewrites docket text.
 */
export function dispositionResultLabel({
  eventKind = '',
  dispositionDomain = '',
  dispositionDomains = [],
  outcomeComponents = [],
  wholeCaseTerminated = false,
} = {}) {
  const kind = String(eventKind || '').trim();
  const currentDomain = String(dispositionDomain || '').trim();
  const domains = [...new Set([
    ...(Array.isArray(dispositionDomains) ? dispositionDomains : []),
    currentDomain,
  ].map((item) => String(item || '').trim()).filter(Boolean))];
  const domainSet = new Set(domains);
  const familyLabel = relatedFamilyOrderLabel(kind, domainSet, currentDomain);
  if (familyLabel) return familyLabel;
  const components = canonicalOutcomeComponents(outcomeComponents).map(label).filter(Boolean);
  if ((kind === 'appeal_mixed' || kind === 'appeal_modified') && components.length) {
    return `Appeal resolved: ${joinNatural(components)}`;
  }
  if (wholeCaseTerminated && ['dismissal', 'judgment_of_dismissal'].includes(kind)) {
    return 'Case dismissed';
  }
  if (EVENT_RESULT_LABELS[kind]) return EVENT_RESULT_LABELS[kind];
  if (DOMAIN_RESULT_LABELS[currentDomain]) return DOMAIN_RESULT_LABELS[currentDomain];
  const firstKnownDomain = domains.find((domain) => DOMAIN_RESULT_LABELS[domain]);
  if (firstKnownDomain) return DOMAIN_RESULT_LABELS[firstKnownDomain];
  const fallback = eventKindLabel(kind || currentDomain);
  return fallback && fallback !== 'Event' ? `${fallback} recorded` : 'Disposition recorded';
}

const TERMINATED_CLOSURE_STATES = new Set(['terminated', 'closed', 'whole_case_terminated']);
const OPEN_CLOSURE_STATES = new Set(['open', 'active', 'pending', 'affirmatively_open']);

function normalizedState(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[ -]+/g, '_');
}

function canonicalSummary(record) {
  if (!record || typeof record !== 'object') return {};
  const summary = record.summary && typeof record.summary === 'object'
    ? record.summary
    : record.operative_summary && typeof record.operative_summary === 'object'
      ? record.operative_summary
      : {};
  return summary;
}

function canonicalEvents(record) {
  return Array.isArray(record?.events) ? record.events.filter((event) => event && typeof event === 'object') : [];
}

function canonicalEventForHash(events, hash) {
  if (!hash) return null;
  return events.find((event) => [event.entry_hash, event.source_row_hash, event.source_evidence_hash].includes(hash)) || null;
}

function canonicalCurrentEvent(summary, events) {
  for (const key of ['latest_dispositive_event_hash', 'selected_event_hash', 'current_judgment_event_hash', 'actual_judgment_event_hash']) {
    const found = canonicalEventForHash(events, summary[key]);
    if (found) return found;
  }
  const operative = events.filter((event) => ['operative', 'superseding'].includes(event.status));
  return operative[operative.length - 1] || null;
}

function validatedClosureEvent(summary, events) {
  const closureHash = String(summary.case_closure_event_hash || '').trim();
  if (!closureHash) return null;
  const event = canonicalEventForHash(events, closureHash);
  if (!event) return null;
  const status = normalizedState(event.status);
  const currentEffect = normalizedState(event.current_effect);
  const finality = normalizedState(event.finality);
  const singlePetitionNameChange = (
    normalizedState(event.event_kind) === 'name_change_decree'
    && String(summary.case_closure_basis || '').trim() === 'observed_single_petition:name_change_decree'
  );
  return (
    ['operative', 'superseding'].includes(status)
    && currentEffect === 'operative'
    && (normalizedState(event.disposition_scope) === 'case' || singlePetitionNameChange)
    && finality === 'terminal'
    && event.is_final_disposition === true
    && normalizedState(event.case_closure_effect) === 'closes_case'
  ) ? event : null;
}

/**
 * Consumer projection of the canonical outcome record.
 *
 * This function never classifies raw docket text.  It also never treats a
 * disposition event as proof that the whole case closed unless the canonical
 * summary explicitly supplies `case_closure_status`.
 */
export function canonicalCaseStatusSummary(record, baseSummary = null) {
  const base = baseSummary && typeof baseSummary === 'object' ? baseSummary : {};
  const summary = canonicalSummary(record);
  const events = canonicalEvents(record);
  const operative = events.filter((event) => ['operative', 'superseding'].includes(event.status));
  const current = canonicalCurrentEvent(summary, events);
  const groups = Array.isArray(summary.disposition_groups) ? summary.disposition_groups : [];
  const domains = Array.isArray(summary.disposition_domains)
    ? summary.disposition_domains.filter(Boolean)
    : [...new Set(operative.flatMap((event) => event.disposition_domains || [event.disposition_domain]).filter(Boolean))];
  const closureStatus = String(summary.case_closure_status || record?.case_closure_status || '').trim();
  const closureEffect = String(summary.case_closure_effect || record?.case_closure_effect || '').trim();
  const closureBasis = String(summary.case_closure_basis || record?.case_closure_basis || '').trim();
  const normalizedClosureStatus = normalizedState(closureStatus);
  const closureEvent = validatedClosureEvent(summary, events);
  const validatedTermination = (
    TERMINATED_CLOSURE_STATES.has(normalizedClosureStatus)
    && normalizedState(closureEffect) === 'closes_case'
    && closureEvent !== null
  );
  const vacated = Boolean(summary.judgment_is_vacated)
    || groups.some((group) => ['vacated', 'set_aside'].includes(normalizedState(group?.current_effect || group?.current_state)));
  const wholeCaseTerminated = validatedTermination && !vacated;
  const canonicalOpen = OPEN_CLOSURE_STATES.has(normalizedClosureStatus);
  const explicitOpen = base.case_status === 'affirmatively_open' && base.affirmatively_open;
  const hasEvidence = operative.length > 0 || groups.length > 0;
  const currentKind = String(current?.event_kind || summary.latest_dispositive_event_kind || summary.selected_event_kind || '').trim();
  const currentComponents = canonicalOutcomeComponents(
    current?.outcome_components,
    summary.latest_dispositive_outcome_components,
  );
  const currentDate = String(current?.entry_date || summary.latest_dispositive_event_date || '').trim();
  const currentDomain = String(current?.disposition_domain || '').trim();
  const hasCurrentFinal = !vacated && (
    groups.some((group) => group?.is_current_final === true || (
      group?.is_current_final === undefined
      && group?.is_final
      && !['vacated', 'superseded', 'reversed', 'set_aside'].includes(normalizedState(group?.current_effect || group?.current_state))
    ))
    || operative.some((event) => event.is_final_disposition
      && !['vacated', 'superseded', 'reversed', 'set_aside'].includes(normalizedState(event.current_effect))
      && !['vacatur', 'renewal', 'satisfaction', 'partial_satisfaction'].includes(event.event_kind))
  );
  const satisfied = Boolean(summary.judgment_is_satisfied);
  const resultLabel = dispositionResultLabel({
    eventKind: currentKind,
    dispositionDomain: currentDomain,
    dispositionDomains: domains,
    outcomeComponents: currentComponents,
    wholeCaseTerminated,
  });
  let caseStatus = 'unknown';
  let statusLabel = 'Unknown / no final disposition detected';
  if (base.no_data) {
    caseStatus = 'unavailable';
    statusLabel = base.status_label || 'No data';
  } else if (satisfied) {
    caseStatus = 'judgment_satisfied';
    statusLabel = 'Satisfaction of judgment on file';
  } else if (wholeCaseTerminated) {
    caseStatus = 'case_terminated';
    statusLabel = resultLabel;
  } else if (vacated && hasEvidence) {
    caseStatus = 'disposition_vacated';
    statusLabel = 'Prior disposition vacated or set aside';
  } else if (hasEvidence) {
    caseStatus = 'disposition_evidence';
    statusLabel = resultLabel;
  } else if (canonicalOpen || explicitOpen) {
    caseStatus = 'affirmatively_open';
    statusLabel = base.status_label || `Court status: ${label(closureStatus)}`;
  }
  const sourceText = String(current?.source_text || '').trim();
  const finalityLabel = base.no_data
    ? 'No data'
    : wholeCaseTerminated
      ? `${resultLabel}${currentDate ? ` on ${currentDate}` : ''}${closureBasis ? ` (${label(closureBasis)})` : ''}`
      : hasEvidence
        ? `${resultLabel}${currentDate ? ` on ${currentDate}` : ''}; closure of the entire case not established`
        : 'Unknown / no final disposition detected';
  return {
    ...base,
    status_domain: String(summary.case_model || record?.case_model || base.status_domain || 'unknown'),
    case_status: caseStatus,
    status_label: statusLabel,
    status_label_html: '',
    status_detail: sourceText || (hasEvidence ? 'Open the canonical outcome evidence below for the exact retained source row.' : base.status_detail || ''),
    no_data: Boolean(base.no_data),
    has_disposition_evidence: hasEvidence,
    has_final_disposition: hasCurrentFinal,
    has_current_final_disposition: hasCurrentFinal,
    whole_case_terminated: wholeCaseTerminated,
    affirmatively_open: Boolean(canonicalOpen || explicitOpen),
    final_disposition_type: currentKind || currentDomain,
    final_disposition_date: currentDate,
    finality_label: finalityLabel,
    judgment_entered: Boolean(summary.current_judgment_event_hash || summary.actual_judgment_event_hash) && !vacated,
    judgment_is_vacated: vacated,
    satisfied,
    disposition_domains: domains,
    disposition_groups: groups,
    current_event_hash: String(current?.entry_hash || summary.latest_dispositive_event_hash || ''),
    current_event_kind: currentKind,
    outcome_components: currentComponents,
    current_disposition_domain: currentDomain,
    case_closure_status: closureStatus || 'unknown',
    case_closure_effect: closureEffect || (wholeCaseTerminated ? 'closes_case' : 'unknown'),
    case_closure_basis: closureBasis,
    case_closure_evidence_valid: Boolean(closureEvent),
    outcome_rule_id: String(record?.rule_id || ''),
    outcome_rule_version: String(record?.rule_version || ''),
    appeal_status: 'unknown_not_computed_from_outcome_evidence',
    appeal_label: 'Not computed from canonical outcome evidence',
    scan_warning: base.scan_warning || null,
    signals: {
      ...(base.signals || {}),
      canonicalDisposition: current,
      canonicalEvents: operative,
    },
  };
}

function domainLabel(value) {
  const key = String(value ?? '').trim();
  return DOMAIN_LABELS[key] || label(key) || 'Domain not stated';
}

function money(value) {
  const raw = String(value ?? '').trim().replace(/,/g, '');
  const match = raw.match(/^(-?)(\d+)(\.\d+)?$/);
  if (!match) return raw || 'not stated';
  const whole = match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${match[1]}$${whole}${match[3] || ''}`;
}

function confidence(value) {
  if (value === null || value === undefined || value === '') return 'not stated';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return `${(numeric * 100).toFixed(numeric === 1 ? 0 : 1)}%`;
}

function kv(labelText, valueHtml) {
  return `<div class="cs-kv"><div class="cs-kv-label">${escapeJudgmentHtml(labelText)}</div><div class="cs-kv-val">${valueHtml}</div></div>`;
}

function badge(value, extra = '') {
  return `<span class="cs-badge${extra ? ` ${extra}` : ''}">${escapeJudgmentHtml(label(value) || 'not stated')}</span>`;
}

function eventForHash(events, hash) {
  if (!hash) return null;
  return events.find((event) =>
    event && (event.entry_hash === hash || event.source_row_hash === hash || event.source_evidence_hash === hash)
  ) || null;
}

function eventReviewText(event) {
  const reasons = Array.isArray(event?.review_reasons) ? event.review_reasons.filter(Boolean) : [];
  return reasons.length ? reasons.map(label).join('; ') : 'none recorded';
}

function renderDispositionGroupsProvenance(summary) {
  const groups = Array.isArray(summary?.disposition_groups) ? summary.disposition_groups : [];
  if (!groups.length) return '';
  const rows = groups.map((group, index) => {
    const row = group && typeof group === 'object' ? group : {};
    const domain = domainLabel(row.disposition_domain);
    const scope = label(row.disposition_scope) || 'scope not stated';
    const latestKind = eventKindLabel(row.latest_event_kind);
    const components = outcomeComponentsText(row.outcome_components);
    const latestDate = String(row.latest_event_date ?? '');
    const amount = row.current_amount == null ? '' : money(row.current_amount);
    return `<details class="cs-packet-member" data-judgment-disposition="${escapeJudgmentHtml(index)}">`
      + `<summary><span>${escapeJudgmentHtml(latestDate || 'no date')}</span><span class="cs-packet-code">${escapeJudgmentHtml(domain)}</span><span class="cs-packet-member-title">${escapeJudgmentHtml(latestKind)}</span><span class="mono">${escapeJudgmentHtml(amount)}</span></summary>`
      + `<div class="cs-packet-member-body">`
      + `<div class="cs-kv-grid">`
      + kv('case model', escapeJudgmentHtml(label(row.case_model) || 'not stated'))
      + kv('scope', escapeJudgmentHtml(scope))
      + (components ? kv('observed outcome components', escapeJudgmentHtml(components)) : '')
      + kv('unit key', `<span class="mono">${escapeJudgmentHtml(row.disposition_unit_key || 'not recorded')}</span>`)
      + kv('latest event hash', `<span class="mono">${escapeJudgmentHtml(row.latest_event_hash || 'not recorded')}</span>`)
      + kv('events', escapeJudgmentHtml(String(row.event_count ?? 0)))
      + kv('final events', escapeJudgmentHtml(String(row.final_event_count ?? 0)))
      + kv('modifiable', stateValue(Boolean(row.is_modifiable), 'modifiable', 'not marked modifiable'))
      + kv('modifications', stateValue(Boolean(row.has_modifications), 'modification recorded', 'none recorded'))
      + kv('review', stateValue(Boolean(row.review_required), 'review required', 'no review flags'))
      + `</div></div></details>`;
  }).join('');
  return `<div class="cs-section-note">${escapeJudgmentHtml(groups.length)} disposition track${groups.length === 1 ? '' : 's'} from operative source events.</div>`
    + `<div class="cs-packet-members" data-judgment-disposition-groups>${rows}</div>`;
}

function docketIndexFromSourcePath(sourcePath) {
  const match = String(sourcePath ?? '').match(/\["docket_entries"\]\[(\d+)\]/);
  return match ? Number(match[1]) : -1;
}

function documentForEvent(event, context = {}) {
  const documents = Array.isArray(context.documents) ? context.documents : [];
  const docketEvents = Array.isArray(context.docketEvents) ? context.docketEvents : [];
  const directId = String(event?.entry_doc_id ?? '').trim();
  let docketEntry = null;
  const sourceIndex = docketIndexFromSourcePath(event?.source_path);
  if (sourceIndex >= 0 && sourceIndex < docketEvents.length) docketEntry = docketEvents[sourceIndex];
  const docketId = String(docketEntry?.doc_id ?? '').trim();
  const ids = [directId, docketId].filter(Boolean);
  for (const id of ids) {
    const found = documents.find((document) => String(document?.doc_id ?? '') === id);
    if (found) return found;
  }
  const sourceText = String(event?.source_text ?? '').replace(/\s+/g, ' ').trim();
  if (sourceText) {
    const found = documents.find((document) => String(document?.description ?? '').replace(/\s+/g, ' ').trim() === sourceText);
    if (found) return found;
  }
  return null;
}

function judgmentDocumentLink(event, context = {}) {
  const document = documentForEvent(event, context);
  const key = String(document?.sha256 || document?.doc_id || event?.entry_doc_id || '').trim();
  const caseNumber = String(context.caseNumber ?? event?.case_number ?? '').trim();
  if (!key || !caseNumber) return '';
  const href = `#/case/${encodeURIComponent(caseNumber)}/document/${encodeURIComponent(key)}`;
  return `<a class="cs-action-btn cs-link" data-judgment-document href="${escapeJudgmentHtml(href)}">Document preview / OCR</a>`;
}

function renderEvent(event, index, context = {}) {
  const row = event && typeof event === 'object' ? event : {};
  const status = label(row.status) || 'unknown';
  const kind = eventKindLabel(row.event_kind);
  const components = outcomeComponentsText(row.outcome_components);
  const domain = domainLabel(row.disposition_domain);
  const sourceText = String(row.source_text ?? '');
  const entryDate = String(row.entry_date ?? '');
  const evidenceHash = String(row.source_evidence_hash ?? '');
  const rowHash = String(row.source_row_hash ?? row.entry_hash ?? '');
  const rowAmount = row.satisfied_amount ?? row.total_amount;
  const amount = rowAmount == null ? '' : ` ${money(rowAmount)}`;
  const documentLink = judgmentDocumentLink(row, context);
  const meta = [
    `<time class="mono">${escapeJudgmentHtml(entryDate || 'no date')}</time>`,
    badge(status),
    badge(kind),
    `<span>${escapeJudgmentHtml(domain)}</span>`,
    amount ? `<span class="mono">${escapeJudgmentHtml(amount.trim())}</span>` : '',
  ].filter(Boolean).join('');
  return `<article class="cs-judgment-event" data-judgment-event="${escapeJudgmentHtml(index)}" data-judgment-evidence="${escapeJudgmentHtml(evidenceHash || rowHash)}">`
    + `<header class="cs-judgment-event-head">${meta}</header>`
    + `<div class="cs-judgment-docket-entry"><b>Docket entry</b><pre class="mono" data-judgment-source-text>${escapeJudgmentHtml(sourceText)}</pre></div>`
    + (components ? `<div class="cs-judgment-event-components">${escapeJudgmentHtml(components)}</div>` : '')
    + (documentLink ? `<div class="cs-judgment-event-actions">${documentLink}</div>` : '')
    + `</article>`;
}

function renderEventProvenance(event, index) {
  const row = event && typeof event === 'object' ? event : {};
  const evidenceHash = String(row.source_evidence_hash ?? '');
  const rowHash = String(row.source_row_hash ?? row.entry_hash ?? '');
  return `<details class="cs-packet-member" data-judgment-provenance-event="${escapeJudgmentHtml(index)}">`
    + `<summary><span>${escapeJudgmentHtml(String(row.entry_date ?? '') || 'no date')}</span><span class="cs-packet-code">${escapeJudgmentHtml(label(row.status) || 'unknown')}</span><span class="cs-packet-member-title">${escapeJudgmentHtml(eventKindLabel(row.event_kind))}</span><span>${escapeJudgmentHtml(domainLabel(row.disposition_domain))}</span></summary>`
    + `<div class="cs-packet-member-body"><div class="cs-kv-grid">`
    + kv('case model', escapeJudgmentHtml(label(row.case_model) || 'not stated'))
    + kv('all domains', escapeJudgmentHtml((Array.isArray(row.disposition_domains) ? row.disposition_domains : []).map(domainLabel).join('; ') || domainLabel(row.disposition_domain)))
    + kv('scope', escapeJudgmentHtml(label(row.disposition_scope) || 'not stated'))
    + kv('unit key', `<span class="mono">${escapeJudgmentHtml(row.disposition_unit_key || 'not recorded')}</span>`)
    + kv('modification', stateValue(Boolean(row.is_modification), 'modification', 'not marked modification'))
    + kv('document', `<span class="mono">${escapeJudgmentHtml(row.entry_doc_id || 'not recorded')}</span>`)
    + kv('source path', `<span class="mono">${escapeJudgmentHtml(row.source_path || 'not recorded')}</span>`)
    + kv('evidence hash', `<span class="mono">${escapeJudgmentHtml(evidenceHash || 'not recorded')}</span>`)
    + kv('row hash', `<span class="mono">${escapeJudgmentHtml(rowHash || 'not recorded')}</span>`)
    + kv('confidence', escapeJudgmentHtml(confidence(row.confidence)))
    + kv('review', escapeJudgmentHtml(eventReviewText(row)))
    + kv('rule', `<span class="mono">${escapeJudgmentHtml(row.rule_id || 'not recorded')}</span>`)
    + `</div></div></details>`;
}

function stateValue(active, activeLabel, inactiveLabel) {
  return badge(active ? activeLabel : inactiveLabel, active ? '' : 'cs-src');
}

function renderReview(summary, events) {
  const reasons = [];
  if (summary.review_required) reasons.push('summary conflict');
  const conflicts = Array.isArray(summary.conflicts) ? summary.conflicts : [];
  conflicts.forEach((item) => {
    const reason = item && typeof item === 'object' ? item.reason : item;
    if (reason) reasons.push(label(reason));
  });
  events.forEach((event) => {
    (Array.isArray(event?.review_reasons) ? event.review_reasons : []).forEach((reason) => {
      if (reason) reasons.push(label(reason));
    });
  });
  const unique = [...new Set(reasons)];
  return unique.length ? `review required: ${unique.join('; ')}` : 'no review flags';
}

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function firstPresent(...values) {
  return values.find(hasValue) ?? null;
}

function amountValue(summary) {
  return firstPresent(
    summary.recorded_judgment_amount,
    summary.latest_renewal_total_amount,
    summary.actual_judgment_total_amount,
    summary.original_judgment_total_amount
  );
}

function percentText(value) {
  if (!hasValue(value)) return '';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  const pct = numeric <= 1 ? numeric * 100 : numeric;
  return `${pct.toFixed(Math.abs(pct - Math.round(pct)) < 0.05 ? 0 : 1)}%`;
}

function satisfactionLabel(summary) {
  const explicit = String(summary?.satisfaction_status_label || '').trim();
  const state = String(summary?.satisfaction_state || '').trim().toLowerCase();
  if (summary?.judgment_is_satisfied || state === 'completely_satisfied' || /^(?:completely\s+)?satisfied$/i.test(explicit)) {
    return 'Satisfaction of judgment on file';
  }
  if (state === 'unsatisfied' || /^unsatisfied$/i.test(explicit)) {
    return 'No current full satisfaction recorded';
  }
  if (explicit) return explicit;
  const satisfiedAmount = summary?.satisfaction_amount;
  const basisAmount = summary?.satisfaction_basis_amount ?? amountValue(summary);
  const pct = percentText(summary?.satisfaction_percent);
  if (hasValue(satisfiedAmount) && hasValue(basisAmount)) {
    return `${pct || 'partially'} satisfied (${money(satisfiedAmount)}/${money(basisAmount)})`;
  }
  if (hasValue(satisfiedAmount)) return `partially satisfied (${money(satisfiedAmount)} recorded)`;
  return 'No current full satisfaction recorded';
}

const SATISFACTION_NOT_APPLICABLE_KINDS = new Set([
  'declaratory/injunctive',
  'name_change_decree',
  'take_nothing',
]);
const FALLBACK_SATISFACTION_APPLICABLE_KINDS = new Set([
  'amended_judgment',
  'default_judgment',
  'dismissal',
  'judgment',
  'judgment_of_dismissal',
  'monetary_judgment',
  'possession',
  'stipulated_judgment',
]);

function capitalizeSentence(value) {
  const text = String(value || '').trim().replace(/[.]+$/, '');
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}.` : '';
}

function fallbackSatisfactionText(summary) {
  if (!fallbackHasFinalSignal(summary)) return '';
  const kind = String(summary.final_disposition_type || '').trim().toLowerCase().replace(/[ -]+/g, '_');
  if (summary.satisfaction_date || summary.satisfied) return 'Satisfaction of judgment on file.';
  if (summary.name_change_decree_entered || !FALLBACK_SATISFACTION_APPLICABLE_KINDS.has(kind)) return '';
  return 'No current full satisfaction recorded.';
}

function postureSatisfactionText(model, fallbackSummary) {
  if (model.referenceOnly) return fallbackSatisfactionText(fallbackSummary);
  if (SATISFACTION_NOT_APPLICABLE_KINDS.has(model.kind)) return '';
  const state = String(model.summary?.satisfaction_state || '').trim();
  const explicit = String(model.summary?.satisfaction_status_label || '').trim();
  if (!state && !explicit) return '';
  return capitalizeSentence(satisfactionLabel(model.summary));
}

function judgmentDescriptionModel(record) {
  const source = record && typeof record === 'object' ? record : {};
  const hasSummary = Boolean(source.summary && typeof source.summary === 'object');
  const summary = hasSummary ? source.summary : {};
  const events = Array.isArray(source.events) ? source.events : [];
  if (!events.length && !Object.keys(summary).length) {
    return {
      empty: true,
      summary,
      events,
      nature: 'No extracted judgment/end-state events are recorded for this case.',
      amountDescription: 'Final amount: not stated.',
      satisfactionText: 'not applicable',
      effectDescription: '',
      sourceDescription: 'No judgment source rows were found in the generated judgment shard.',
      reviewText: 'no review flags',
      dispositionDomains: '',
      recordedAmount: null,
    };
  }

  const operativeEvent = events.find((event) => ['operative', 'superseding'].includes(event?.status));
  const currentEvent = eventForHash(events, summary.actual_judgment_event_hash)
    || eventForHash(events, summary.current_judgment_event_hash)
    || eventForHash(events, summary.selected_event_hash)
    || operativeEvent
    || events[0]
    || {};
  const hasOperativeJudgment = Boolean(
    summary.actual_judgment_event_hash
    || summary.current_judgment_event_hash
    || summary.actual_judgment_kind
    || summary.current_judgment_total_amount
    || summary.original_judgment_total_amount
    || summary.recorded_judgment_amount
    || Number(summary.final_disposition_count || 0) > 0
    || operativeEvent
  );
  const referenceOnly = events.length > 0 && !hasOperativeJudgment;
  const finalEvent = eventForHash(events, summary.latest_dispositive_event_hash)
    || eventForHash(events, summary.selected_event_hash)
    || currentEvent;
  const kind = referenceOnly ? 'judgment_reference' : (hasSummary
    ? (summary.actual_judgment_kind || currentEvent.event_kind || summary.selected_event_kind || 'judgment')
    : (currentEvent.event_kind || 'judgment_reference'));
  const finalKind = referenceOnly ? 'judgment_reference' : (summary.latest_dispositive_event_kind || finalEvent.event_kind || kind);
  const finalComponents = canonicalOutcomeComponents(
    summary.latest_dispositive_outcome_components,
    finalEvent.outcome_components,
  );
  const finalDate = String(summary.latest_dispositive_event_date || finalEvent.entry_date || '');
  const currentDate = String(currentEvent.entry_date || '');
  const finalLabel = observedDispositionLabel(finalKind, finalComponents);
  const judgmentLabel = eventKindLabel(kind);
  const dispositionDomains = Array.isArray(summary.disposition_domains)
    ? summary.disposition_domains.map(domainLabel).filter(Boolean).join('; ')
    : '';
  const recordedAmount = amountValue(summary);
  const takeNothing = kind === 'take_nothing' || finalKind === 'take_nothing'
    || (Array.isArray(summary.disposition_domains) && summary.disposition_domains.includes('take_nothing'));
  let amountDescription;
  if (takeNothing) {
    amountDescription = 'Final amount: take nothing.';
  } else if (hasValue(recordedAmount)) {
    amountDescription = `Final amount: ${money(recordedAmount)} recorded in the judgment/renewal source.`;
  } else {
    amountDescription = 'Final amount: not stated in extracted judgment rows.';
  }
  const satisfactionText = satisfactionLabel(summary);
  const effects = [];
  if (summary.judgment_is_vacated) effects.push('vacated');
  if (summary.judgment_has_party_limited_satisfaction) effects.push('party-limited satisfaction recorded');
  if (summary.judgment_has_party_limited_vacatur) effects.push('party-limited vacatur recorded');
  const reviewText = renderReview(summary, events);
  const finalDateText = finalDate ? ` on ${finalDate}` : '';
  const currentDateText = currentDate && currentDate !== finalDate ? ` on ${currentDate}` : '';
  const nature = referenceOnly
    ? 'no operative judgment was extracted; reference and rejected judgment source rows are retained for review.'
    : [
      `Final disposition: ${finalLabel}${finalDateText}.`,
      judgmentLabel && judgmentLabel !== finalLabel ? `Operative judgment: ${judgmentLabel}${currentDateText}.` : '',
      dispositionDomains ? `Tracks: ${dispositionDomains}.` : '',
    ].filter(Boolean).join(' ');
  const sourceDescription = [
    `${events.length} judgment/end-state source event${events.length === 1 ? '' : 's'}`,
    `${summary.disposition_group_count ?? 0} disposition track${Number(summary.disposition_group_count ?? 0) === 1 ? '' : 's'}`,
    `${summary.final_disposition_count ?? 0} final event${Number(summary.final_disposition_count ?? 0) === 1 ? '' : 's'}`,
  ].join('; ') + '.';
  return {
    empty: false,
    summary,
    events,
    currentEvent,
    finalEvent,
    referenceOnly,
    kind,
    finalKind,
    finalComponents,
    finalDate,
    currentDate,
    nature,
    amountDescription,
    satisfactionText,
    effectDescription: effects.join('; '),
    sourceDescription,
    reviewText,
    dispositionDomains,
    recordedAmount,
    prevailing: currentEvent.prevailing_party_text || 'not stated',
    liable: currentEvent.liable_party_text || 'not stated',
  };
}

function renderJudgmentSummary(record, mode = 'inline') {
  const model = judgmentDescriptionModel(record);
  if (model.empty) {
    return `<div class="cs-judgment-summary is-empty" data-judgment-state="no-case">${escapeJudgmentHtml(model.nature)}</div>`;
  }
  const compact = mode === 'table';
  const reviewBadge = model.reviewText.startsWith('review required') ? badge('review required') : '';
  const effect = model.effectDescription ? `<div>${escapeJudgmentHtml(model.effectDescription)}.</div>` : '';
  return `<div class="cs-judgment-summary${compact ? ' is-table' : ''}" data-judgment-state="ready">`
    + `<div class="cs-judgment-nature">${escapeJudgmentHtml(model.nature)}</div>`
    + `<div class="cs-judgment-amount">${escapeJudgmentHtml(model.amountDescription)}</div>`
    + `<div class="cs-judgment-satisfaction">Satisfaction: ${escapeJudgmentHtml(model.satisfactionText)}.</div>`
    + effect
    + (compact ? '' : `<div class="cs-judgment-source">${escapeJudgmentHtml(model.sourceDescription)} ${reviewBadge}</div>`)
    + `</div>`;
}

export function renderJudgmentPosture(record, fallbackSummary = null, context = {}) {
  const model = judgmentDescriptionModel(record);
  const satisfaction = postureSatisfactionText(model, fallbackSummary);
  const satisfactionHtml = satisfaction
    ? `<div class="cs-judgment-satisfaction">${escapeJudgmentHtml(satisfaction)}</div>`
    : '';
  return `<div class="cs-judgment-posture">`
    + satisfactionHtml
    + `<details class="cs-judgment-inline-details">`
    + `<summary>Judgment</summary>`
    + renderJudgmentRecord(record, context)
    + `</details>`
    + `</div>`;
}

export function renderJudgmentRecord(record, context = {}) {
  const model = judgmentDescriptionModel(record);
  const summary = model.summary;
  const events = model.events;
  if (model.empty) {
    return '<div class="cs-section-note" data-judgment-state="no-case">No extracted judgment events are recorded for this case.</div>';
  }
  const kind = model.kind;
  const takeNothing = kind === 'take_nothing' ? badge('take nothing') : badge(eventKindLabel(kind));
  const eventRows = events.map((event, index) => renderEvent(event, index, context)).join('');
  const recordedAmount = model.recordedAmount;

  const referenceNote = model.referenceOnly
    ? `<div class="cs-section-note">${escapeJudgmentHtml(model.nature)}</div>`
    : '';
  return `<div data-judgment-state="ready">`
    + referenceNote
    + `<div class="cs-kv-grid">`
    + kv('kind', takeNothing)
    + (model.finalComponents.length ? kv('observed outcome components', escapeJudgmentHtml(outcomeComponentsText(model.finalComponents))) : '')
    + kv('satisfaction', escapeJudgmentHtml(model.satisfactionText))
    + kv('vacated', stateValue(summary.judgment_is_vacated, 'vacated', 'not vacated'))
    + kv('party-limited effects', stateValue(
      Boolean(summary.judgment_has_party_limited_satisfaction || summary.judgment_has_party_limited_vacatur),
      'party-limited effect recorded',
      'none recorded'
    ))
    + kv('actual judgment amount', `<span class="mono">${escapeJudgmentHtml(money(summary.actual_judgment_total_amount ?? summary.original_judgment_total_amount))}</span>`)
    + kv('recorded judgment amount', `<span class="mono">${escapeJudgmentHtml(money(recordedAmount))}</span>`)
    + kv('latest renewal', `<span class="mono">${escapeJudgmentHtml(money(summary.latest_renewal_total_amount))}</span>`)
    + kv('prevailing party', escapeJudgmentHtml(model.prevailing))
    + kv('liable party', escapeJudgmentHtml(model.liable))
    + `</div>`
    + `<div class="cs-section-note">Docket entries supporting this judgment assessment. Reference and rejected rows are retained.</div>`
    + `<div class="cs-judgment-events" data-judgment-events>${eventRows}</div>`
    + `</div>`;
}

export function renderJudgmentProvenance(record) {
  const model = judgmentDescriptionModel(record);
  if (model.empty) {
    return '<div class="cs-section-note" data-judgment-state="no-case">No extracted judgment events are recorded for this case.</div>';
  }
  const { summary, events } = model;
  const currentEvent = model.currentEvent || {};
  const reviewText = model.reviewText;
  const eventRows = events.map(renderEventProvenance).join('');
  return `<div data-judgment-state="ready" data-judgment-provenance>`
    + `<div class="cs-kv-grid">`
    + kv('case model', escapeJudgmentHtml(label(summary.case_model) || label(currentEvent.case_model) || 'not stated'))
    + kv('domains', escapeJudgmentHtml(model.dispositionDomains || label(currentEvent.disposition_domain) || 'not stated'))
    + kv('tracks', escapeJudgmentHtml(String(summary.disposition_group_count ?? 0)))
    + kv('final events', escapeJudgmentHtml(String(summary.final_disposition_count ?? 0)))
    + kv('selected event hash', `<span class="mono">${escapeJudgmentHtml(summary.selected_event_hash || 'not recorded')}</span>`)
    + kv('latest event hash', `<span class="mono">${escapeJudgmentHtml(summary.latest_dispositive_event_hash || 'not recorded')}</span>`)
    + kv('confidence', escapeJudgmentHtml(confidence(currentEvent.confidence)))
    + kv('review', escapeJudgmentHtml(reviewText))
    + `</div>`
    + renderDispositionGroupsProvenance(summary)
    + `<div class="cs-section-note">${escapeJudgmentHtml(events.length)} retained judgment source event${events.length === 1 ? '' : 's'} with extraction metadata.</div>`
    + `<div class="cs-packet-members" data-judgment-provenance-events>${eventRows}</div>`
    + `</div>`;
}

export function judgmentPanelShell(caseNumber, view = 'panel') {
  const normalized = normalizeJudgmentCaseNumber(caseNumber);
  return `<div data-judgment-view="${escapeJudgmentHtml(view)}" data-judgment-case="${escapeJudgmentHtml(normalized)}"><div class="cs-section-note" data-judgment-state="loading">Loading judgment data...</div></div>`;
}

function compactJudgmentNoteHtml(message, state = 'unavailable') {
  return `<div class="cs-judgment-summary is-empty" data-judgment-state="${escapeJudgmentHtml(state)}">${escapeJudgmentHtml(message)}</div>`;
}

function unavailableHtml(message, view = 'panel') {
  if (view === 'table-summary' || view === 'posture') return compactJudgmentNoteHtml(message, 'unavailable');
  return `<div class="cs-section-note" data-judgment-state="unavailable">${escapeJudgmentHtml(message)}</div>`;
}

function dataStateErrorHtml(message, view = 'panel') {
  const text = String(message || 'Judgment data error: evidence could not be validated.');
  if (view === 'table-summary' || view === 'posture') return compactJudgmentNoteHtml(text, 'data-error');
  return `<div class="cs-section-note" data-judgment-state="data-error">${escapeJudgmentHtml(text)}</div>`;
}

function noCaseHtml(view = 'panel') {
  const message = 'No extracted judgment/end-state events are recorded for this case.';
  if (view === 'table-summary' || view === 'posture') return compactJudgmentNoteHtml(message, 'no-case');
  return `<div class="cs-section-note" data-judgment-state="no-case">${escapeJudgmentHtml(message)}</div>`;
}

function fallbackText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function fallbackHasFinalSignal(summary) {
  return Boolean(summary && typeof summary === 'object' && summary.has_final_disposition && !summary.no_data);
}

function fallbackAmountDescription(summary) {
  if (!fallbackHasFinalSignal(summary)) return 'Final amount: not stated.';
  if (summary.dismissal_entered && !summary.judgment_entered) {
    return 'Final amount: no money judgment amount detected in the extracted case-status signal.';
  }
  if (summary.satisfied && !summary.judgment_entered) {
    return 'Final amount: not stated in the extracted satisfaction signal.';
  }
  return 'Final amount: not stated in extracted ROA/document metadata.';
}

function fallbackSourceSnippet(summary) {
  const signals = summary?.signals || {};
  return fallbackText(
    summary?.status_detail
    || signals.judgment?.snippet
    || signals.dismissal?.snippet
    || signals.satisfaction?.snippet
    || signals.remittitur?.snippet
    || signals.appealNotice?.snippet
    || ''
  );
}

function fallbackJudgmentHtml(summary, view = 'panel') {
  if (!fallbackHasFinalSignal(summary)) return '';
  const finality = fallbackText(summary.finality_label || summary.status_label || 'Final disposition detected');
  const status = fallbackText(summary.status_label || '');
  const date = fallbackText(summary.final_disposition_date || summary.judgment_date || summary.dismissal_date || summary.satisfaction_date || '');
  const source = fallbackSourceSnippet(summary);
  const appeal = fallbackText(summary.appeal_label || '');
  const review = summary.scan_warning?.reason ? `Review: ${summary.scan_warning.reason}` : 'Review: no fallback warning flags.';
  const heading = `Final disposition from case ROA: ${finality}${date && !finality.includes(date) ? ` (${date})` : ''}.`;
  const fallbackSatisfaction = fallbackSatisfactionText(summary).replace(/[.]+$/, '');
  const summaryHtml = `<div class="cs-judgment-summary${view === 'table-summary' ? ' is-table' : ''}" data-judgment-state="case-status-fallback">`
    + `<div class="cs-judgment-nature">${escapeJudgmentHtml(heading)}</div>`
    + `<div class="cs-judgment-amount">${escapeJudgmentHtml(fallbackAmountDescription(summary))}</div>`
    + (fallbackSatisfaction ? `<div class="cs-judgment-satisfaction">${escapeJudgmentHtml(fallbackSatisfaction)}.</div>` : '')
    + (appeal ? `<div class="cs-judgment-source">${escapeJudgmentHtml(appeal)}</div>` : '')
    + `<div class="cs-judgment-source">Judgment shard has no case record; this panel is using the loaded full-case status signal.</div>`
    + `</div>`;
  if (view === 'table-summary') return summaryHtml;
  const detailBody = `<div class="cs-kv-grid">`
    + kv('status', escapeJudgmentHtml(status || finality))
    + kv('finality', escapeJudgmentHtml(finality))
    + kv('date', `<span class="mono">${escapeJudgmentHtml(date || 'not recorded')}</span>`)
    + kv('judgment shard', escapeJudgmentHtml('no matching case record'))
    + kv('review', escapeJudgmentHtml(review))
    + `</div>`
    + `<div class="cs-judgment-docket-entry"><b>Docket entry</b><pre class="mono" data-judgment-source-text>${escapeJudgmentHtml(source || 'No docket entry was available in the case-status fallback.')}</pre></div>`;
  const detailHtml = `<details class="cs-judgment-inline-details">`
    + `<summary>Judgment</summary>`
    + detailBody
    + `</details>`;
  if (view === 'posture') {
    const satisfaction = fallbackSatisfactionText(summary);
    const satisfactionHtml = satisfaction
      ? `<div class="cs-judgment-satisfaction">${escapeJudgmentHtml(satisfaction)}</div>`
      : '';
    return `<div class="cs-judgment-posture" data-judgment-state="case-status-fallback">${satisfactionHtml}${detailHtml}</div>`;
  }
  return `<div data-judgment-state="case-status-fallback">${summaryHtml}${detailHtml}</div>`;
}

function renderJudgmentForView(record, view = 'panel', fallbackSummary = null, context = {}) {
  if (view === 'table-summary') return renderJudgmentSummary(record, 'table');
  if (view === 'posture') return renderJudgmentPosture(record, fallbackSummary, context);
  if (view === 'provenance') return renderJudgmentProvenance(record);
  return renderJudgmentRecord(record, context);
}

async function fetchJson(url, fetchImpl) {
  const response = await fetchImpl(url, { credentials: 'same-origin' });
  if (!response || !response.ok) {
    const error = new Error(`judgment fetch failed: ${response?.status ?? 'no response'}`);
    error.status = response?.status;
    throw error;
  }
  return response.json();
}

export function validateJudgmentManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    return {
      ok: false,
      code: 'manifest_invalid',
      message: 'Judgment data error: the evidence manifest is missing or invalid.',
    };
  }
  if (!EXPECTED_MANIFEST.schema_versions.includes(manifest.schema_version)) {
    return {
      ok: false,
      code: 'manifest_schema_incompatible',
      message: `Judgment data error: manifest schema ${String(manifest.schema_version ?? 'missing')} is incompatible with this viewer.`,
    };
  }
  if (manifest.shard_pattern !== EXPECTED_MANIFEST.shard_pattern
      || manifest.hash_algorithm !== EXPECTED_MANIFEST.hash_algorithm) {
    return {
      ok: false,
      code: 'manifest_layout_incompatible',
      message: 'Judgment data error: the evidence manifest uses an incompatible shard layout.',
    };
  }
  if (MANIFEST_PROVENANCE_SCHEMA_VERSIONS.has(manifest.schema_version)) {
    if (manifest.rule_id !== EXPECTED_MANIFEST.rule_id) {
      return {
        ok: false,
        code: 'manifest_rule_incompatible',
        message: 'Judgment data error: the evidence manifest identifies an incompatible extraction rule.',
      };
    }
    if (!SEMANTIC_VERSION_PATTERN.test(String(manifest.rule_version || ''))) {
      return {
        ok: false,
        code: 'manifest_rule_version_invalid',
        message: 'Judgment data error: the evidence manifest has no valid extraction rule version.',
      };
    }
    if (!GIT_COMMIT_PATTERN.test(String(manifest.source_snapshot_id || ''))) {
      return {
        ok: false,
        code: 'manifest_source_snapshot_invalid',
        message: 'Judgment data error: the evidence manifest has no valid source snapshot.',
      };
    }
  }
  return { ok: true, code: '', message: '' };
}

function dataStateErrorResult(normalizedCaseNumber, validation, extra = {}) {
  return {
    status: 'data_state_error',
    normalizedCaseNumber,
    dataStateError: {
      code: validation.code || 'judgment_data_error',
      message: validation.message || 'Judgment data error: evidence could not be validated.',
    },
    ...extra,
  };
}

function canonicalDataStateErrorSummary(baseSummary, result) {
  const base = canonicalCaseStatusSummary(null, baseSummary);
  const error = result?.dataStateError || {};
  const message = String(error.message || 'Judgment data error: evidence could not be validated.');
  return {
    ...base,
    case_status: 'data_state_error',
    status_label: 'Judgment data error',
    status_label_html: '',
    status_detail: message,
    no_data: false,
    has_disposition_evidence: false,
    has_final_disposition: false,
    has_current_final_disposition: false,
    whole_case_terminated: false,
    affirmatively_open: false,
    finality_label: message,
    judgment_entered: false,
    judgment_is_vacated: false,
    satisfied: false,
    disposition_domains: [],
    disposition_groups: [],
    current_event_hash: '',
    current_event_kind: '',
    current_disposition_domain: '',
    case_closure_status: 'unknown',
    case_closure_effect: 'unknown',
    case_closure_basis: '',
    data_state_error: {
      code: String(error.code || 'judgment_data_error'),
      message,
    },
  };
}

function shardUrl(manifestUrl, pattern, shard) {
  const base = String(manifestUrl).replace(/[^/]*$/, '');
  return `${base}${pattern.replace('{shard}', shard)}`;
}

function rawShardUrl(rawBaseUrl, pattern, shard) {
  const base = String(rawBaseUrl || '').replace(/\/?$/, '/');
  return base ? `${base}${pattern.replace('{shard}', shard)}` : '';
}

async function fetchFirstJson(urls, fetchImpl) {
  let lastError = null;
  for (const url of urls) {
    if (!url) continue;
    try {
      return await fetchJson(url, fetchImpl);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('judgment fetch failed: no urls');
}

export async function loadJudgmentCase(caseNumber, options = {}) {
  const normalizedCaseNumber = normalizeJudgmentCaseNumber(caseNumber);
  if (!normalizedCaseNumber) return { status: 'missing_case_number', normalizedCaseNumber };
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const manifestUrl = options.manifestUrl || JUDGMENT_MANIFEST_URL;
  const rawBaseUrl = options.rawBaseUrl === undefined ? JUDGMENT_RAW_BASE_URL : options.rawBaseUrl;
  if (typeof fetchImpl !== 'function') return { status: 'unavailable', normalizedCaseNumber };

  const useCache = !options.fetchImpl && !options.manifestUrl;
  try {
    const loadManifest = () => fetchJson(manifestUrl, fetchImpl);
    let loadedNewManifest = false;
    if (useCache && !manifestPromise) {
      loadedNewManifest = true;
      manifestPromise = loadManifest().catch((error) => {
        manifestPromise = null;
        shardPromises.clear();
        throw error;
      });
    }
    const manifest = useCache
      ? await manifestPromise
      : await loadManifest();
    const manifestValidation = validateJudgmentManifest(manifest);
    if (!manifestValidation.ok) {
      if (useCache) {
        manifestPromise = null;
        shardPromises.clear();
      }
      return dataStateErrorResult(normalizedCaseNumber, manifestValidation);
    }
    if (useCache && loadedNewManifest) shardPromises.clear();

    const shard = await judgmentShardForCase(normalizedCaseNumber);
    const urls = [
      shardUrl(manifestUrl, manifest.shard_pattern, shard),
      rawShardUrl(rawBaseUrl, manifest.shard_pattern, shard),
    ].filter((url, index, arr) => url && arr.indexOf(url) === index);
    const cacheKey = `${manifestUrl}|${rawBaseUrl || ''}|${shard}`;
    const loadShard = () => fetchFirstJson(urls, fetchImpl);
    let payload;
    try {
      payload = useCache
        ? await (shardPromises.get(cacheKey) || (() => {
          const promise = loadShard().catch((error) => {
            shardPromises.delete(cacheKey);
            throw error;
          });
          shardPromises.set(cacheKey, promise);
          return promise;
        })())
        : await loadShard();
    } catch (error) {
      if (error?.status === 404) {
        return dataStateErrorResult(normalizedCaseNumber, {
          code: 'judgment_shard_unavailable',
          message: 'Judgment data error: the evidence shard is unavailable.',
        }, { shard });
      }
      throw error;
    }
    if (!payload || payload.schema_version !== EXPECTED_SHARD_SCHEMA_VERSION || !payload.cases || typeof payload.cases !== 'object') {
      if (useCache) shardPromises.delete(cacheKey);
      return dataStateErrorResult(normalizedCaseNumber, {
        code: 'shard_schema_incompatible',
        message: 'Judgment data error: the evidence shard is incompatible with this viewer.',
      }, { shard });
    }
    const record = payload.cases[normalizedCaseNumber];
    return record
      ? { status: 'ready', normalizedCaseNumber, shard, record }
      : { status: 'no_case', normalizedCaseNumber, shard };
  } catch {
    return dataStateErrorResult(normalizedCaseNumber, {
      code: 'judgment_data_unavailable',
      message: 'Judgment data error: evidence could not be loaded or validated.',
    });
  }
}

export async function hydrateJudgmentPanels(root, caseNumber, options = {}) {
  if (!root || typeof root.querySelectorAll !== 'function') return { status: 'no_root' };
  const targets = [...root.querySelectorAll('[data-judgment-view]')];
  if (!targets.length) return { status: 'no_targets' };
  const normalized = normalizeJudgmentCaseNumber(caseNumber);
  const fallbackStatus = options.fallbackStatus || options.fallbackSummary || null;
  const result = await loadJudgmentCase(normalized, options);
  const renderContext = {
    caseNumber: normalized,
    documents: Array.isArray(options.documents) ? options.documents : [],
    docketEvents: Array.isArray(options.docketEvents) ? options.docketEvents : [],
  };
  const canonicalStatus = result.status === 'data_state_error'
    ? canonicalDataStateErrorSummary(fallbackStatus, result)
    : canonicalCaseStatusSummary(
      result.status === 'ready' ? result.record : null,
      fallbackStatus,
    );
  targets.forEach((target) => {
    if (target.isConnected === false || target.dataset?.judgmentCase !== normalized) return;
    const view = target.dataset?.judgmentView || 'panel';
    if (result.status === 'ready') target.innerHTML = renderJudgmentForView(result.record, view, fallbackStatus, renderContext);
    else if (result.status === 'no_case' || result.status === 'missing_case_number') {
      target.innerHTML = fallbackJudgmentHtml(fallbackStatus, view) || noCaseHtml(view);
    }
    else if (result.status === 'data_state_error') {
      target.innerHTML = dataStateErrorHtml(result.dataStateError?.message, view);
    } else {
      target.innerHTML = unavailableHtml('Judgment data is not available.', view);
    }
  });
  if (typeof options.onCanonicalStatus === 'function') {
    options.onCanonicalStatus(canonicalStatus, result);
  }
  return result;
}

export function resetJudgmentCacheForTests() {
  manifestPromise = null;
  shardPromises.clear();
}
