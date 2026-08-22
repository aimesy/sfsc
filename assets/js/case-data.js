let CRIMINAL_CHARGE_TITLE_LOOKUP = { titles: {} };
let CRIMINAL_STATUTE_CURRENT_VERSION_LOOKUP = { sections: {} };
let criminalLookupPromise = null;
let criminalLookupsLoaded = false;

export function ensureCriminalLookups() {
  if (criminalLookupPromise) return criminalLookupPromise;
  criminalLookupPromise = Promise.all([
    import('./criminal-charge-titles.js?v=20260621-charge-title-versions'),
    import('./criminal-statute-current-versions.js?v=20260622-statute-version-links'),
  ]).then(([titles, versions]) => {
    CRIMINAL_CHARGE_TITLE_LOOKUP = titles.CRIMINAL_CHARGE_TITLE_LOOKUP || { titles: {} };
    CRIMINAL_STATUTE_CURRENT_VERSION_LOOKUP = versions.CRIMINAL_STATUTE_CURRENT_VERSION_LOOKUP || { sections: {} };
    criminalLookupsLoaded = true;
    try { globalThis.dispatchEvent(new CustomEvent('sfsc:criminal-lookups-loaded')); } catch {}
    return true;
  }).catch((err) => {
    criminalLookupPromise = null;
    console.warn('Unable to load criminal statute lookup tables', err);
    return false;
  });
  return criminalLookupPromise;
}

const asArray = (value) => Array.isArray(value) ? value : [];
const text = (value) => value == null ? '' : String(value).trim();
const asList = (value) => {
  if (Array.isArray(value)) return value;
  const scalar = text(value);
  return scalar ? scalar.split(/;|\n/).map(text).filter(Boolean) : [];
};
const uniqueTextList = (values) => {
  const seen = new Set();
  const out = [];
  for (const value of values || []) {
    const v = text(value);
    const key = v.toUpperCase();
    if (!v || seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
};
const PRO_PER_RE = /^\s*(?:PRO\s*PER|IN\s+PRO\s+PER|PRO\s*SE)\s*$/i;
const ATTORNEY_TITLE_ARTIFACT_RE = /^\s*(?:DEPOSITOR,\s*WILL|WILL\s+DEPOSITOR|TRUST\s+DEPOSITOR|SETTLEMENT\s+ATTORNEY\s*\d*|VISITING\s+JUDGE|UNKNOWN\s+JUDGE)\s*$/i;
const cleanAttorneyList = (value) => {
  const out = [];
  for (const raw of asList(value)) {
    let s = String(raw || '')
      .replace(/<br\s*\/?>|\(Deactive[^)]*\)/gi, '')
      .replace(/(?<=[A-Za-z])PRO\s*PER\b/gi, ', PRO PER')
      .replace(/\b(?:IN\s+PRO\s+PER|PRO\s*PER|PRO\s*SE)\b/gi, 'PRO PER');
    s = text(s).replace(/\s+/g, ' ');
    s = s
      .replace(/^(?:PRO\s*PER\s*,?\s*)+/i, '')
      .replace(/(?:,?\s*PRO\s*PER)+\s*$/i, '')
      .replace(/,\s*PRO\s*PER\s*,/gi, ',')
      .replace(/\s+PRO\s*PER\s*,/gi, ',')
      .replace(/,\s*PRO\s*PER\s+/gi, ', ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!s) continue;
    const parts = s.split(/\s*,\s*/)
      .map((part) => text(part).replace(/^[ `;]+|[ `;]+$/g, ''))
      .filter(Boolean);
    for (let i = 0; i < parts.length;) {
      const part = parts[i];
      if (PRO_PER_RE.test(part) || ATTORNEY_TITLE_ARTIFACT_RE.test(part)) {
        i += 1;
        continue;
      }
      let name = part;
      if (i + 1 < parts.length && !PRO_PER_RE.test(parts[i + 1])) {
        name = `${part}, ${parts[i + 1]}`;
        i += 2;
        if (i < parts.length && /^(?:JR\.?|SR\.?|II|III|IV|V)$/i.test(parts[i])) {
          name += `, ${parts[i]}`;
          i += 1;
        }
      } else {
        i += 1;
      }
      name = text(name).replace(/^[ ,;`]+|[ ,;`]+$/g, '').toUpperCase();
      if (name && !PRO_PER_RE.test(name) && !ATTORNEY_TITLE_ARTIFACT_RE.test(name)) out.push(name);
    }
  }
  return uniqueTextList(out);
};

const PARTY_ROLE_WORDS = [
  'PLAINTIFF', 'DEFENDANT', 'PETITIONER', 'RESPONDENT', 'CLAIMANT', 'CREDITOR',
  'DEBTOR', 'INTERVENOR', 'CONSERVATOR', 'CONSERVATEE', 'TRUSTEE', 'TRUSTOR',
  'BENEFICIARY', 'GUARDIAN', 'MINOR', 'DECEDENT', 'HEIR', 'WARD', 'OTHER',
  'APPELLANT', 'APPELLEE', 'OBJECTOR', 'REQUESTOR', 'REQUESTER', 'ASSIGNEE',
  'ASSIGNOR', 'RECEIVER', 'DEPONENT', 'GARNISHEE', 'LIEN\\s*CLAIMANT',
  'MOVANT', 'PETITONER', 'CROSS[\\s-]?(?:DEFENDANT|COMPLAINANT|PLAINTIFF|RESPONDENT|APPELLANT|PETITIONER)',
  'PERSON\\s+TO\\s+BE\\s+PROTECTED', 'PROTECTED\\s+PERSON',
  'PERSONAL\\s+REPRESENTATIVE', 'REAL\\s+PARTY(?:\\s+IN\\s+INTEREST)?',
  'PARTY\\s+IN\\s+INTEREST', 'DEFENDANT\\s+IN\\s+INTERVENTION',
  'PLAINTIFF\\s+IN\\s+INTERVENTION', 'GUARDIAN\\s+AD\\s+LITEM',
  'THIRD\\s+PARTY', 'NON[\\s-]?PARTY', 'ADMINISTRATOR', 'EXECUTOR',
  'EXECUTRIX', 'PROPONENT', 'CONTESTANT', 'SUBROGEE',
  'CROSS\\s+COMPLAINANT', 'CROSS\\s+DEFENDANT',
].join('|');
const PARTY_ROLE_PAREN_SOURCE = `\\(\\s*(?:(?:AND|&|/)\\s+)*(?:${PARTY_ROLE_WORDS})\\b[^)]*\\)?`;
const partyRoleParenRe = () => new RegExp(PARTY_ROLE_PAREN_SOURCE, 'gi');
const stripPartyRoles = (value) => {
  let s = text(value).replace(partyRoleParenRe(), ' ').replace(/\s+/g, ' ').trim();
  while (s.endsWith(')') && (s.match(/\)/g) || []).length > (s.match(/\(/g) || []).length) {
    s = s.slice(0, -1).trim();
  }
  return s.replace(/^[ ,;]+|[ ,;]+$/g, '');
};
const representedPartyName = (value) => stripPartyRoles(value);
const validRepresentedPartyName = (value) => /[A-Z0-9]/i.test(text(value)) && text(value).replace(/[()\s.,;]+/g, '');
const splitRepresentedParties = (value) => {
  const out = [];
  for (const raw of asList(value)) {
    const matches = Array.from(String(raw || '').matchAll(partyRoleParenRe()));
    if (!matches.length) {
      const name = representedPartyName(raw).toUpperCase();
      if (validRepresentedPartyName(name)) out.push(name);
      continue;
    }
    let prevEnd = 0;
    matches.forEach((m) => {
      const name = representedPartyName(String(raw || '').slice(prevEnd, m.index)).toUpperCase();
      prevEnd = (m.index || 0) + m[0].length;
      if (validRepresentedPartyName(name)) out.push(name);
    });
    const tail = representedPartyName(String(raw || '').slice(prevEnd)).toUpperCase();
    if (validRepresentedPartyName(tail)) out.push(tail);
  }
  return uniqueTextList(out);
};

const firstText = (obj, keys) => {
  for (const key of keys) {
    const val = text(obj?.[key]);
    if (val) return val;
  }
  return '';
};

const htmlEscape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const cleanInline = (value) => text(value)
  .replace(/<br\s*\/?>/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim();
const GENERIC_CRIMINAL_TITLE_RE = /^(?:San Francisco criminal case(?:\s+\d+)?|San Francisco Superior Court case(?:\s+(?:CRI[-_\s]*)?\d+)?)$/i;
const BAD_CRIMINAL_TITLE_RE = /\b(?:Name Search by Attorney Name|Enter the complete|Criminal Case Search|Search by|Defendant Name|Attorney Name)\b/i;
const UNRESOLVED_CRIMINAL_TITLE_RE = /^Criminal identity (?:unavailable|unresolved):/i;
const isGenericCriminalTitle = (value) => {
  const title = cleanInline(value);
  return !!title && (GENERIC_CRIMINAL_TITLE_RE.test(title) || BAD_CRIMINAL_TITLE_RE.test(title));
};
const isWeakCriminalTitle = (value) => isGenericCriminalTitle(value) || UNRESOLVED_CRIMINAL_TITLE_RE.test(cleanInline(value));
const criminalIdentityCaseTitle = (rawNumber = '', caseNumber = '', unavailable = false) => {
  let caseId = cleanInline(caseNumber) || (cleanInline(rawNumber) ? `CRI${cleanInline(rawNumber)}` : '');
  if (caseId && !/^CRI/i.test(caseId)) caseId = `CRI${caseId}`;
  const state = unavailable ? 'unavailable' : 'unresolved';
  return caseId ? `Criminal identity ${state}: ${caseId}` : `Criminal identity ${state}`;
};
const CHARGE_CODE_NAMES = {
  PC: ['Penal Code', 'PEN'],
  HS: ['Health and Safety Code', 'HSC'],
  VC: ['Vehicle Code', 'VEH'],
  BP: ['Business and Professions Code', 'BPC'],
  CC: ['Civil Code', 'CIV'],
  GC: ['Government Code', 'GOV'],
  FG: ['Fish and Game Code', 'FGC'],
  HN: ['Harbors and Navigation Code', 'HNC'],
  PR: ['Public Resources Code', 'PRC'],
  WI: ['Welfare and Institutions Code', 'WIC'],
  FA: ['Food and Agricultural Code', 'FAC'],
  ED: ['Education Code', 'EDC'],
  EL: ['Elections Code', 'ELEC'],
  IC: ['Insurance Code', 'INS'],
  LC: ['Labor Code', 'LAB'],
  RT: ['Revenue and Taxation Code', 'RTC'],
  UI: ['Unemployment Insurance Code', 'UIC'],
  FC: ['Financial Code', 'FIN'],
  PU: ['Public Utilities Code', 'PUC'],
  WC: ['Water Code', 'WAT'],
  SH: ['Streets and Highways Code', 'SHC'],
  CCP: ['Code of Civil Procedure', 'CCP'],
};
const CHARGE_SENTINEL_RE = /\b(?:8{5,}|9{5,}|0{5,})\b/g;
const BAD_SCHEDULE_TITLE_RE = /^(?:a|an|and|for|nor|of|or|the|to|with)$/i;
const CHARGE_CODE_PATTERN = String.raw`PC|PEN(?:AL)?\s+CODE|PEN|HS|HSC|H\s*&\s*S|HEALTH\s+AND\s+SAFETY\s+CODE|VC|VEH|VEH(?:ICLE)?\s+CODE|BP|BPC|B\s*&\s*P|BUS(?:INESS)?\s+AND\s+PROF(?:ESSIONS)?\s+CODE|CC|CI|CIV|CIV(?:IL)?\s+CODE|GC|GOV|GOV(?:ERNMENT)?\s+CODE|FG|FGC|F\s*&\s*G|FISH\s+AND\s+GAME\s+CODE|HN|HNC|H\s*&\s*N|HARBORS?\s+AND\s+NAV(?:IGATION)?\s+CODE|PR|PRC|PUBLIC\s+RES(?:OURCES)?\s+CODE|WI|WIC|W\s*&\s*I|WELFARE\s+AND\s+INSTITUTIONS\s+CODE|FA|FAC|FOOD\s+AND\s+AG(?:RICULTURAL)?\s+CODE|ED|EC|EDC|EDUCATION\s+CODE|EL|ELECTIONS?\s+CODE|IC|INS(?:URANCE)?\s+CODE|LC|LAB(?:OR)?\s+CODE|RT|RTC|REV(?:ENUE)?\s+AND\s+TAX(?:ATION)?\s+CODE|UI|UIC|UNEMPLOYMENT\s+INS(?:URANCE)?\s+CODE|FC|FIN(?:ANCIAL)?\s+CODE|PU|PUC|PUBLIC\s+UTIL(?:ITIES)?\s+CODE|WC|WAT(?:ER)?\s+CODE|SH|SHC|STREETS?\s+AND\s+HIGHWAYS?\s+CODE|CCP|CP|CODE\s+OF\s+CIVIL\s+PROCEDURE`;
const CHARGE_STATUTE_RE_VERSIONED = new RegExp(String.raw`\b(?:(?<code1>${CHARGE_CODE_PATTERN})\s*(?:\u00a7|SECTION|SEC\.)?\s*(?<section1>\d+[A-Za-z]?(?:\.\d+)?(?:\([A-Za-z0-9,]+\))*)|(?<section2>\d+[A-Za-z]?(?:\.\d+)?(?:\([A-Za-z0-9,]+\))*)\s*(?<code2>${CHARGE_CODE_PATTERN}))(?=$|[^A-Za-z0-9])`, 'i');
const normalizeChargeCode = (value) => {
  const raw = cleanInline(value).toUpperCase().replace(/\./g, '').replace(/\s+/g, ' ');
  if (['PC', 'PEN CODE', 'PENAL CODE'].includes(raw)) return 'PC';
  if (['HS', 'H&S', 'H & S', 'HEALTH AND SAFETY CODE'].includes(raw)) return 'HS';
  if (['VC', 'VEH CODE', 'VEHICLE CODE'].includes(raw)) return 'VC';
  if (['BP', 'B&P', 'B & P', 'BUS AND PROF CODE', 'BUSINESS AND PROF CODE', 'BUSINESS AND PROFESSIONS CODE'].includes(raw)) return 'BP';
  if (['CC', 'CI', 'CIV CODE', 'CIVIL CODE'].includes(raw)) return 'CC';
  if (['GC', 'GOV CODE', 'GOVERNMENT CODE'].includes(raw)) return 'GC';
  if (['FG', 'FGC', 'F&G', 'F & G', 'FISH AND GAME CODE'].includes(raw)) return 'FG';
  if (['HN', 'HNC', 'H&N', 'H & N', 'HARBOR AND NAV CODE', 'HARBORS AND NAV CODE', 'HARBORS AND NAVIGATION CODE'].includes(raw)) return 'HN';
  if (['PR', 'PRC', 'PUBLIC RES CODE', 'PUBLIC RESOURCES CODE'].includes(raw)) return 'PR';
  if (['WI', 'WIC', 'W&I', 'W & I', 'WELFARE AND INSTITUTIONS CODE'].includes(raw)) return 'WI';
  if (['FA', 'FAC', 'FOOD AND AG CODE', 'FOOD AND AGRICULTURAL CODE'].includes(raw)) return 'FA';
  if (['ED', 'EC', 'EDC', 'EDUCATION CODE'].includes(raw)) return 'ED';
  if (['EL', 'ELECTION CODE', 'ELECTIONS CODE'].includes(raw)) return 'EL';
  if (['IC', 'INS CODE', 'INSURANCE CODE'].includes(raw)) return 'IC';
  if (['LC', 'LAB CODE', 'LABOR CODE'].includes(raw)) return 'LC';
  if (['RT', 'RTC', 'REV AND TAX CODE', 'REVENUE AND TAX CODE', 'REVENUE AND TAXATION CODE'].includes(raw)) return 'RT';
  if (['UI', 'UIC', 'UNEMPLOYMENT INS CODE', 'UNEMPLOYMENT INSURANCE CODE'].includes(raw)) return 'UI';
  if (['FC', 'FIN CODE', 'FINANCIAL CODE'].includes(raw)) return 'FC';
  if (['PU', 'PUC', 'PUBLIC UTIL CODE', 'PUBLIC UTILITIES CODE'].includes(raw)) return 'PU';
  if (['WC', 'WAT CODE', 'WATER CODE'].includes(raw)) return 'WC';
  if (['SH', 'SHC', 'STREETS AND HIGHWAYS CODE', 'STREET AND HIGHWAY CODE'].includes(raw)) return 'SH';
  if (['CCP', 'CP', 'CODE OF CIVIL PROCEDURE'].includes(raw)) return 'CCP';
  return raw;
};
const chargeLeginfoUrl = (code, section) => {
  const entry = CHARGE_CODE_NAMES[code];
  const baseSection = cleanInline(section).replace(/\(.*$/, '').trim();
  if (!entry || !baseSection) return '';
  const params = new URLSearchParams({ sectionNum: `${baseSection}.`, lawCode: entry[1] });
  return `https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?${params.toString()}`;
};
const statuteVersionRecord = (code, section) => {
  const exact = cleanInline(section);
  const base = exact.replace(/\(.*$/, '');
  for (const key of [`${code} ${exact}`, `${code} ${base}`]) {
    const record = CRIMINAL_STATUTE_CURRENT_VERSION_LOOKUP?.sections?.[key];
    if (record && typeof record === 'object') return record;
  }
  return null;
};
const statuteUrlFields = (code, section, filingDate = '') => {
  const currentUrl = chargeLeginfoUrl(code, section);
  if (!currentUrl) return {};
  const record = statuteVersionRecord(code, section);
  const filed = isoDate(filingDate);
  const currentFrom = cleanInline(record?.current_version_start_date || record?.operative_date || record?.effective_date);
  const out = { current_url: currentUrl };
  if (record) {
    for (const key of ['source_url', 'history', 'effective_date', 'operative_date', 'current_version_start_date']) {
      if (record[key]) out[`statute_${key}`] = record[key];
    }
    if (Array.isArray(record.historical_versions) && filed) {
      for (const version of record.historical_versions) {
        if (!version || typeof version !== 'object') continue;
        const start = cleanInline(version.effective_from);
        const end = cleanInline(version.effective_to);
        const url = cleanInline(version.url);
        if (!start || !url || filed < start || (end && filed > end)) continue;
        Object.assign(out, {
          url,
          url_version_status: 'historical_version_at_filing',
          historical_url: url,
        });
        for (const key of [
          'source_label',
          'official_source_url',
          'release_repo',
          'release_tag',
          'release_asset',
          'release_url',
          'sha256',
          'page',
          'printed_page',
          'history',
          'effective_from',
          'effective_to',
        ]) {
          if (version[key]) out[`statute_historical_${key}`] = version[key];
        }
        return out;
      }
    }
  }
  if (filed && currentFrom && filed < currentFrom) {
    out.url_version_status = 'current_version_postdates_filing';
    return out;
  }
  out.url = currentUrl;
  if (filed && currentFrom) out.url_version_status = 'current_version_at_or_before_filing';
  else if (record) out.url_version_status = 'current_version_date_unknown';
  else out.url_version_status = 'current_version_unverified';
  return out;
};
const isoDate = (value) => {
  const raw = cleanInline(value);
  if (!raw) return '';
  const match = raw.match(/\b(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})\b/);
  const token = match ? match[1] : raw;
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
  const slash = token.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!slash) return '';
  return `${slash[3]}-${slash[1].padStart(2, '0')}-${slash[2].padStart(2, '0')}`;
};
const isSfTitleSource = (record = {}) => /san francisco/i.test(cleanInline(record.jurisdiction || record.source_label));
const isStatewideTitleSource = (record = {}) => /california department of justice/i.test(cleanInline(record.jurisdiction || record.source_label));
const titleSourcePriority = (record = {}) => {
  if (isSfTitleSource(record)) return 3;
  if (isStatewideTitleSource(record)) return 2;
  return 1;
};
const titleGeneralityScore = (record = {}) => {
  const title = cleanInline(record.title).toUpperCase();
  if (!title) return 0;
  let score = 0;
  if (!title.includes(':') && !title.includes(' - ')) score += 2;
  if (!/\b(?:FIRST|SECOND|THIRD|1ST|2ND|3RD)\s+DEGREE\b/.test(title)) score += 1;
  return score;
};
const effectiveDateRank = (record = {}) => {
  const text = cleanInline(record.effective_from);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? Number(text.replaceAll('-', '')) : 0;
};
const chooseScheduleRecord = (records = [], filingDate = '') => {
  const cleanRecords = asArray(records).filter((row) => (
    row
    && typeof row === 'object'
    && cleanInline(row.title)
    && !BAD_SCHEDULE_TITLE_RE.test(cleanInline(row.title))
  ));
  if (!cleanRecords.length) return { record: null, status: '' };
  cleanRecords.sort((a, b) => cleanInline(a.effective_from).localeCompare(cleanInline(b.effective_from)));
  const filed = isoDate(filingDate);
  const best = (candidates, preferLatest = true) => {
    if (!candidates.length) return null;
    return [...candidates].sort((a, b) => {
      const priority = titleSourcePriority(b) - titleSourcePriority(a);
      if (priority) return priority;
      const generality = titleGeneralityScore(b) - titleGeneralityScore(a);
      if (generality) return generality;
      const byDate = effectiveDateRank(a) - effectiveDateRank(b);
      if (byDate) return preferLatest ? -byDate : byDate;
      const byLength = cleanInline(a.title).length - cleanInline(b.title).length;
      if (byLength) return byLength;
      return cleanInline(a.source).localeCompare(cleanInline(b.source));
    })[0];
  };
  if (!filed) return { record: best(cleanRecords), status: 'latest_available_no_filing_date' };
  const exactSf = cleanRecords.filter((row) => (
    isSfTitleSource(row)
    && cleanInline(row.effective_from) <= filed
    && (!cleanInline(row.effective_to) || filed <= cleanInline(row.effective_to))
  ));
  if (exactSf.length) return { record: best(exactSf), status: 'effective_at_filing' };
  const exactAny = cleanRecords.filter((row) => (
    cleanInline(row.effective_from) <= filed
    && (!cleanInline(row.effective_to) || filed <= cleanInline(row.effective_to))
  ));
  if (exactAny.length) return { record: best(exactAny), status: 'effective_at_filing_supplemental_source' };
  const beforeSf = cleanRecords.filter((row) => isSfTitleSource(row) && cleanInline(row.effective_from) <= filed);
  if (beforeSf.length) return { record: best(beforeSf), status: 'latest_available_before_filing' };
  const beforeAny = cleanRecords.filter((row) => cleanInline(row.effective_from) <= filed);
  if (beforeAny.length) return { record: best(beforeAny), status: 'latest_available_before_filing_supplemental_source' };
  const afterSf = cleanRecords.filter((row) => isSfTitleSource(row) && cleanInline(row.effective_from) > filed);
  if (afterSf.length) return { record: best(afterSf, false), status: 'earliest_available_after_filing' };
  const afterAny = cleanRecords.filter((row) => cleanInline(row.effective_from) > filed);
  if (afterAny.length) return { record: best(afterAny, false), status: 'earliest_available_after_filing_supplemental_source' };
  return { record: best(cleanRecords), status: 'latest_available_no_filing_date' };
};
const scheduleChargeTitleFor = (code, section, filingDate = '') => {
  const exact = cleanInline(section);
  const base = exact.replace(/\(.*$/, '');
  for (const key of [`${code} ${exact}`, `${code} ${base}`]) {
    const records = CRIMINAL_CHARGE_TITLE_LOOKUP?.titles?.[key];
    if (!records) continue;
    const { record, status } = chooseScheduleRecord(Array.isArray(records) ? records : [records], filingDate);
    if (record?.title) return { title: cleanInline(record.title), record, status };
  }
  return { title: '', record: null, status: '' };
};
const generatedChargeTitle = (code, section) => {
  const entry = CHARGE_CODE_NAMES[code];
  const cleanSection = cleanInline(section);
  return entry && cleanSection ? `${entry[0]} ${String.fromCharCode(167)} ${cleanSection}` : '';
};
const chargeParts = (value) => cleanInline(value)
  .split(/\s*(?:;|\n|\r|\|)\s*/)
  .map((part) => part.replace(/^[ ,]+|[ ,]+$/g, '').trim())
  .filter(Boolean);
const addChargeRow = (out, seen, row) => {
  const key = JSON.stringify(row).toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  out.push(row);
};
const chargeRowFromMatch = (raw, match, title = '', filingDate = '') => {
  const code = normalizeChargeCode(match.groups?.code1 || match.groups?.code2 || '');
  const section = cleanInline(match.groups?.section1 || match.groups?.section2 || '');
  const suffix = raw.match(/(?:^|[/\s-])([FMI])(?:$|[/\s-])/i);
  const classification = suffix ? ({ F: 'felony', M: 'misdemeanor', I: 'infraction' }[suffix[1].toUpperCase()] || '') : '';
  const schedule = scheduleChargeTitleFor(code, section, filingDate);
  const providedTitle = cleanInline(title);
  const generatedTitle = generatedChargeTitle(code, section);
  const row = {
    raw: cleanInline(raw).replace(/^[ ,]+|[ ,]+$/g, ''),
    title: providedTitle || schedule.title || generatedTitle || cleanInline(raw).replace(/^[ ,]+|[ ,]+$/g, ''),
  };
  if (providedTitle) {
    row.title_source = 'criminal_index_text';
    if (schedule.title && schedule.title.toLowerCase() !== providedTitle.toLowerCase()) row.schedule_title = schedule.title;
  } else if (schedule.title) {
    row.title_source = schedule.record.title_source || 'court_bail_schedule';
  } else if (generatedTitle) {
    row.title_source = 'programmatic_citation';
  } else {
    row.title_source = 'raw_index_text';
  }
  if (schedule.record) {
    row.title_version_status = schedule.status;
    for (const sourceKey of ['source', 'source_label', 'source_url', 'source_page', 'jurisdiction', 'effective_from', 'effective_to', 'schedule_classification', 'doj_cjis_code', 'doj_offense_level', 'doj_possible_sentence']) {
      if (schedule.record[sourceKey]) row[`title_schedule_${sourceKey}`] = schedule.record[sourceKey];
    }
  }
  if (code && section && CHARGE_CODE_NAMES[code]) {
    row.code = `${code} ${section}`;
    row.code_system = code;
    row.section = section;
    row.citation = `${CHARGE_CODE_NAMES[code][0]} ${String.fromCharCode(167)} ${section}`;
    Object.assign(row, statuteUrlFields(code, section, filingDate));
  }
  if (classification) row.classification = classification;
  return row;
};
const parseChargeRows = (value, filingDate = '') => {
  const out = [];
  const seen = new Set();
  for (const raw of chargeParts(value)) {
    const matches = Array.from(raw.matchAll(new RegExp(CHARGE_STATUTE_RE_VERSIONED.source, 'gi')));
    if (matches.length > 1) {
      const consumed = [];
      for (const match of matches) {
        let end = match.index + match[0].length;
        const classMatch = raw.slice(end).match(/^\s*\/\s*([FMI])\b/i);
        if (classMatch) end += classMatch[0].length;
        consumed.push([match.index, end]);
        addChargeRow(out, seen, chargeRowFromMatch(raw.slice(match.index, end), match, '', filingDate));
      }
      let residual = raw;
      for (const [start, end] of consumed.reverse()) {
        residual = `${residual.slice(0, start)} ${residual.slice(end)}`;
      }
      const residualSentinels = residual.match(CHARGE_SENTINEL_RE) || [];
      for (const sentinel of residualSentinels) {
        addChargeRow(out, seen, {
          raw: sentinel,
          title: `Unrecognized criminal index charge code ${sentinel}`,
          unparsed: true,
        });
      }
      continue;
    }
    const match = matches[0] || null;
    if (match) {
      let title = cleanInline(`${raw.slice(0, match.index)} ${raw.slice(match.index + match[0].length)}`.replace(/^[ -:;,/]+|[ -:;,/]+$/g, ''));
      title = title.replace(/^[/\s-]*[FMI]\b[/\s-]*/i, '');
      title = title.replace(/\b(?:felony|misdemeanor|infraction|F|M|I)\b\s*$/i, '').replace(/[ -:;,/]+$/g, '').trim();
      addChargeRow(out, seen, chargeRowFromMatch(raw, match, title, filingDate));
      continue;
    }
    const sentinels = raw.match(CHARGE_SENTINEL_RE) || [];
    for (const sentinel of sentinels) {
      addChargeRow(out, seen, {
        raw: sentinel,
        title: `Unrecognized criminal index charge code ${sentinel}`,
        unparsed: true,
      });
    }
    if (!sentinels.length) {
      addChargeRow(out, seen, { raw, title: raw, unparsed: true });
    }
  }
  return out;
};

const CRIMINAL_PORTAL_SCHEMA = 'sfsc-criminal-portal-case-v1';
const CRIMINAL_PORTAL_SOURCE = 'sftc-criminal-portal';
const CRIMINAL_PORTAL_URL = 'https://webapps.sftc.org/crimportal/crimportal.dll';
const CRIMINAL_SESSION_RE = /([?&]SessionID=)[^&#]+/ig;
const CRIMINAL_MACHINE_REASON_RE = /\bcriminal_portal_no_public_entries\b/i;
const CRIMINAL_MACHINE_REASON_RE_GLOBAL = /\bcriminal_portal_no_public_entries\b/ig;

const stripCriminalPortalMachineReason = (value = '') => (
  cleanInline(value)
    .replace(CRIMINAL_MACHINE_REASON_RE_GLOBAL, '')
    .replace(/\s+([.,;:])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
);

const isCriminalPortalRecord = (rec = {}) => {
  const schema = text(rec.schema).toLowerCase();
  const source = text(rec.source).toLowerCase();
  const caseType = text(rec.case_type).toLowerCase();
  const caseNumber = text(rec.case_number);
  return schema === CRIMINAL_PORTAL_SCHEMA
    || source === CRIMINAL_PORTAL_SOURCE
    || caseType === 'criminal'
    || /^CRI[-_\s]*\d{6,}$/i.test(caseNumber)
    || !!text(rec.criminal_case_number);
};

const criminalRawNumber = (rec = {}) => {
  const direct = text(rec.criminal_case_number || rec.criminalCaseNumber);
  if (direct) return direct.replace(/[^0-9]/g, '');
  const caseNumber = text(rec.case_number);
  const match = caseNumber.match(/^CRI[-_\s]*(\d{6,})$/i);
  return match ? match[1] : '';
};

const criminalArchiveCaseNumber = (rec = {}) => {
  const existing = text(rec.case_number);
  if (/^CRI\d{6,}$/i.test(existing)) return existing.toUpperCase();
  const raw = criminalRawNumber(rec);
  return raw ? `CRI${raw}` : existing.toUpperCase();
};

const redactCriminalPortalUrl = (value) => {
  const raw = text(value);
  if (!raw) return '';
  try {
    const u = new URL(raw, CRIMINAL_PORTAL_URL);
    Array.from(u.searchParams.keys()).forEach((key) => {
      if (key.toLowerCase() === 'sessionid') u.searchParams.delete(key);
    });
    return u.href;
  } catch {
    return raw.replace(CRIMINAL_SESSION_RE, '$1[redacted]');
  }
};

const criminalPortalSourceUrl = (rec = {}) => {
  const explicit = redactCriminalPortalUrl(firstText(rec, ['source_url', 'court_url', 'url']));
  if (explicit) return explicit;
  const redirect = redactCriminalPortalUrl(rec.search?.redirect);
  if (redirect) return redirect;
  const portalId = firstText(rec, ['portal_case_id', 'portalCaseId']);
  if (portalId) return `${CRIMINAL_PORTAL_URL}?CaseId=${encodeURIComponent(portalId)}`;
  return CRIMINAL_PORTAL_URL;
};

const civilCaseSourceUrl = (caseNumber = '') => {
  const key = text(caseNumber).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return key ? `https://webapps.sftc.org/ci/CaseInfo.dll?CaseNum=${encodeURIComponent(key)}` : '';
};

const caseSourceUrl = (rec = {}) => {
  const explicit = firstText(rec, ['source_url', 'case_url', 'court_url', 'url']);
  if (explicit) return isCriminalPortalRecord(rec) ? redactCriminalPortalUrl(explicit) : explicit;
  const source = text(rec.source);
  if (/^https?:\/\//i.test(source)) return source;
  if (isCriminalPortalRecord(rec)) return criminalPortalSourceUrl(rec);
  return civilCaseSourceUrl(firstText(rec, ['case_number', 'CASE_NUMBER', 'caseNum']));
};

const splitCriminalStartTime = (value) => {
  const raw = cleanInline(value);
  if (!raw) return { court_date: '', hearing_time: '' };
  const iso = raw.match(/^(\d{4}-\d{2}-\d{2})(?:[T\s]+(.+))?$/);
  if (iso) return { court_date: iso[1], hearing_time: cleanInline(iso[2] || '') };
  const us = raw.match(/^(\d{1,2}\/\d{1,2}\/\d{2,4})(?:\s+(.+))?$/);
  if (us) return { court_date: us[1], hearing_time: cleanInline(us[2] || '') };
  return { court_date: raw, hearing_time: '' };
};

const normalizeCriminalDocketRows = (rec = {}) => asArray(rec.roa).map((entry, index) => ({
  ...entry,
  __index: index,
  date_filed: firstText(entry, ['date_filed', 'filedDate', 'FILEDATE', 'filed', 'date']),
  description: firstText(entry, ['description', 'docketEntryComment', 'RTEXT', 'text', 'title']),
  submitter: firstText(entry, ['submitter', 'otherSubmitter']),
  source: 'criminal_portal_roa',
}));

const normalizeCriminalCalendarRows = (rec = {}) => asArray(rec.calendar).map((row, index) => {
  const split = splitCriminalStartTime(firstText(row, ['court_date', 'startTime', 'date', 'start_time']));
  return {
    ...row,
    __index: index,
    court_date: firstText(row, ['court_date', 'date']) || split.court_date,
    hearing_time: firstText(row, ['hearing_time', 'time']) || split.hearing_time,
    matters: firstText(row, ['matters', 'hearingType', 'calendar_matter', 'description']),
    hearing_type: firstText(row, ['hearing_type', 'hearingType']),
    location: firstText(row, ['location', 'room']),
    department: firstText(row, ['department', 'dept']),
    source: 'criminal_portal_calendar',
  };
});

const statuteCode = (value) => cleanInline(value)
  .replace(/\bPEN(?:AL)?\s+CODE\b/ig, 'PC')
  .replace(/\bSECTION\b|\bSEC\.\b|§/ig, '')
  .replace(/\s+/g, ' ')
  .trim()
  .toUpperCase();

const proceduralStatuteRe = /\b(?:PC\s*(?:1001\.3[56]|1001\.95|1538\.5|1050|1203\.2|1369|1370|1382|1385|1417|3000\.08|3455|4011(?:\.6)?))\b/i;
const statuteRe = /\b(?:PC|PEN(?:AL)?\s+CODE|HS|VC|BP|CC|GC)\s*(?:§|SECTION|SEC\.)?\s*\d+[A-Za-z]?(?:\.\d+)?(?:\([^)]+\))*/gi;

const normalizeCriminalStatutes = (rec = {}) => {
  const hits = new Map();
  const seenLines = new Set();
  const addText = (source, value) => {
    const line = cleanInline(value);
    if (!line) return;
    const lineKey = line.toUpperCase();
    if (seenLines.has(lineKey)) return;
    seenLines.add(lineKey);
    for (const match of line.matchAll(statuteRe)) {
      const code = statuteCode(match[0]);
      if (!code) continue;
      const prev = hits.get(code) || {
        code,
        count: 0,
        sources: [],
        classification: proceduralStatuteRe.test(code) ? 'procedural' : 'unknown',
      };
      prev.count += 1;
      if (!prev.sources.includes(source)) prev.sources.push(source);
      if (
        prev.classification !== 'procedural'
        && /\b(?:complaint|information|indictment|charge|plea)\b/i.test(line)
      ) {
        prev.classification = 'charge_candidate';
      }
      hits.set(code, prev);
    }
  };
  asArray(rec.roa).forEach((entry) => addText('roa', firstText(entry, ['docketEntryComment', 'description', 'text'])));
  asArray(rec.docket_entries).forEach((entry) => addText('docket_entries', firstText(entry, ['description', 'text', 'title'])));
  return Array.from(hits.values()).sort((a, b) => a.code.localeCompare(b.code));
};

const criminalPortalUnavailableText = (rec = {}) => {
  const status = text(rec.status).toLowerCase();
  const reason = cleanInline(rec.unavailable_reason);
  const humanReason = /^[a-z0-9_:-]+$/i.test(reason) ? '' : reason;
  const rawMessages = [
    rec.message,
    rec.unavailable_text,
    humanReason,
    rec.search?.message,
    ...(Array.isArray(rec.search?.rows) ? rec.search.rows.map((row) => JSON.stringify(row)) : []),
  ].map(cleanInline).filter(Boolean);
  const joined = rawMessages.map(stripCriminalPortalMachineReason).filter(Boolean).join(' ');
  const rawJoined = rawMessages.join(' ');
  if (
    status === 'unavailable'
    || status === 'restricted'
    || status === 'not_public'
    || status === 'not_publicly_available'
    || /\b(?:not\s+public(?:ly)?\s+available|confidential|sealed|restricted|not\s+available\s+to\s+the\s+public)\b/i.test(rawJoined)
  ) {
    return joined || 'Criminal portal indicates this case is not publicly available.';
  }
  return '';
};

const criminalCaseHeader = (rec = {}) => (
  rec.case_header && typeof rec.case_header === 'object' ? rec.case_header : {}
);

const criminalHeaderDefendant = (rec = {}) => (
  firstText(rec, ['defendant']) || firstText(criminalCaseHeader(rec), ['defendant'])
);

const criminalHeaderFiledDate = (rec = {}) => (
  firstText(rec, ['filed_date', 'filedDate']) || firstText(criminalCaseHeader(rec), ['filed_date', 'filedDate'])
);

const criminalChargeText = (rec = {}) => (
  firstText(rec, ['charges'])
  || firstText(rec.criminal_index && typeof rec.criminal_index === 'object' ? rec.criminal_index : {}, ['charges'])
);

const criminalNoInformationText = (defendant = '', filedDate = '', charges = '') => {
  const d = cleanInline(defendant);
  const filed = cleanInline(filedDate);
  const chargeText = cleanInline(charges);
  const facts = [];
  if (d) facts.push(`the name of the defendant, ${d}`);
  if (filed) facts.push(`date of filing, ${filed}`);
  if (chargeText) facts.push(`charges in the case: ${chargeText}`);
  if (facts.length === 1) return `No information available besides ${facts[0]}.`;
  if (facts.length > 1) return `No information available besides ${facts.slice(0, -1).join(', ')}, and ${facts[facts.length - 1]}.`;
  return 'No information available.';
};

const criminalNoPublicRows = (docketEntries = [], calendar = [], attorneys = [], documents = [], payments = []) => (
  !asArray(docketEntries).length
  && !asArray(calendar).length
  && !asArray(attorneys).length
  && !asArray(documents).length
  && !asArray(payments).length
);

function normalizeCriminalPortalCase(rec = {}) {
  if (!isCriminalPortalRecord(rec)) return rec || {};
  if (!criminalLookupsLoaded) ensureCriminalLookups();
  const caseNumber = criminalArchiveCaseNumber(rec);
  const rawNumber = criminalRawNumber(rec);
  const caseHeader = criminalCaseHeader(rec);
  const defendant = criminalHeaderDefendant(rec);
  const filedDate = criminalHeaderFiledDate(rec);
  const displayCaseNumber = firstText(rec, ['display_case_number']) || firstText(caseHeader, ['case_number']);
  const criminalCaseType = firstText(rec, ['criminal_case_type']) || firstText(caseHeader, ['case_type']);
  const charges = criminalChargeText(rec);
  const chargeRows = asArray(rec.charges_parsed).length
    ? asArray(rec.charges_parsed)
    : (asArray(rec.criminal?.charge_rows).length ? asArray(rec.criminal.charge_rows) : parseChargeRows(charges, filedDate));
  let caseTitle = firstText(rec, ['case_title', 'CASETITLE', 'title']);
  const identityUnavailable = rec.identity_unavailable === true || rec.criminal?.identity_unavailable === true;
  const identityUnavailableReason = firstText(rec, ['identity_unavailable_reason']) || firstText(rec.criminal || {}, ['identity_unavailable_reason']);
  const identityIncomplete = rec.identity_incomplete === true || rec.criminal?.identity_incomplete === true || (!defendant && !!firstText(rec, ['portal_case_id', 'portalCaseId']) && !identityUnavailable);
  const identityIncompleteReason = firstText(rec, ['identity_incomplete_reason']) || firstText(rec.criminal || {}, ['identity_incomplete_reason']) || (identityIncomplete ? 'criminal_header_missing_defendant' : '');
  if (
    defendant
    && (
      !caseTitle
      || isWeakCriminalTitle(caseTitle)
      || caseTitle.toUpperCase() === defendant.toUpperCase()
    )
  ) {
    caseTitle = `People v. ${defendant}`;
  } else if (!caseTitle || isGenericCriminalTitle(caseTitle)) {
    caseTitle = criminalIdentityCaseTitle(rawNumber, caseNumber, identityUnavailable);
  }
  const docketEntries = asArray(rec.docket_entries).length
    ? rec.docket_entries
    : normalizeCriminalDocketRows(rec);
  const calendar = normalizeCriminalCalendarRows(rec);
  const parties = asArray(rec.parties).length
    ? asArray(rec.parties)
    : (defendant ? [{ name: defendant, party_type: 'Defendant', source: 'criminal_portal_case_header' }] : []);
  const attorneys = asArray(rec.attorneys);
  const documents = asArray(rec.documents);
  const payments = asArray(rec.payments);
  const statutes = normalizeCriminalStatutes({ ...rec, docket_entries: docketEntries });
  let unavailableText = criminalPortalUnavailableText(rec);
  let unavailableReason = unavailableText
    ? (rec.unavailable_reason || 'criminal_portal_not_publicly_available')
    : rec.unavailable_reason;
  const rawUnavailableText = [rec.unavailable_reason, rec.unavailable_text, rec.message].map(cleanInline).filter(Boolean).join(' ');
  const staleNoPublicText = CRIMINAL_MACHINE_REASON_RE.test(unavailableReason)
    || CRIMINAL_MACHINE_REASON_RE.test(rawUnavailableText)
    || CRIMINAL_MACHINE_REASON_RE.test(unavailableText);
  if ((!unavailableText || staleNoPublicText) && criminalNoPublicRows(docketEntries, calendar, attorneys, documents, payments) && (defendant || filedDate || charges)) {
    unavailableText = criminalNoInformationText(defendant, filedDate, charges);
    unavailableReason = 'criminal_portal_no_public_entries';
  }
  unavailableText = stripCriminalPortalMachineReason(unavailableText);
  const inferredCharges = statutes
    .filter((row) => row.classification === 'charge_candidate')
    .map((row) => ({ ...row, inference: 'tentative_from_criminal_docket_text' }));
  const criminal = {
    ...(rec.criminal && typeof rec.criminal === 'object' ? rec.criminal : {}),
    raw_case_number: rawNumber,
    portal_case_id: firstText(rec, ['portal_case_id', 'portalCaseId']),
    display_case_number: displayCaseNumber,
    defendant,
    filed_date: filedDate,
    charges,
    charge_rows: chargeRows,
    case_type: criminalCaseType,
    case_header: caseHeader,
    identity_unavailable: identityUnavailable,
    identity_unavailable_reason: identityUnavailable ? identityUnavailableReason : '',
    identity_incomplete: identityIncomplete,
    identity_incomplete_reason: identityIncomplete ? identityIncompleteReason : '',
    statutes,
    inferred_charges: inferredCharges,
  };
  const search = rec.search && typeof rec.search === 'object'
    ? { ...rec.search, redirect: redactCriminalPortalUrl(rec.search.redirect) || rec.search.redirect }
    : rec.search;
  return {
    ...rec,
    search,
    schema: rec.schema || CRIMINAL_PORTAL_SCHEMA,
    source: CRIMINAL_PORTAL_SOURCE,
    case_type: 'criminal',
    case_number: caseNumber,
    criminal_case_number: rawNumber,
    display_case_number: displayCaseNumber,
    defendant,
    identity_unavailable: identityUnavailable,
    identity_unavailable_reason: identityUnavailable ? identityUnavailableReason : '',
    identity_incomplete: identityIncomplete,
    identity_incomplete_reason: identityIncomplete ? identityIncompleteReason : '',
    filed_date: filedDate,
    charges,
    charges_parsed: chargeRows,
    criminal_case_type: criminalCaseType,
    case_header: caseHeader,
    case_title: caseTitle || criminalIdentityCaseTitle(rawNumber, caseNumber, identityUnavailable),
    court: firstText(rec, ['court', 'COURT']) || 'San Francisco Superior Court - Criminal',
    cause_of_action: firstText(rec, ['cause_of_action', 'cause', 'CAUSE']) || 'Criminal',
    source_url: criminalPortalSourceUrl(rec),
    court_url: redactCriminalPortalUrl(rec.court_url),
    url: redactCriminalPortalUrl(rec.url),
    docket_entries: docketEntries,
    calendar,
    parties,
    attorneys,
    documents,
    payments,
    status: unavailableText ? 'unavailable' : rec.status,
    unavailable_reason: unavailableText ? unavailableReason : rec.unavailable_reason,
    unavailable_text: unavailableText || rec.unavailable_text,
    document_bytes_captured: rec.document_bytes_captured === true || !documents.length,
    document_byte_capture_scope: rec.document_byte_capture_scope || 'criminal-portal-no-documents',
    criminal,
  };
}

export const isCriminalCaseRecord = isCriminalPortalRecord;

const CASE_APPEAL_NOTICE_DAYS = 60;
const CASE_APPEAL_OUTER_DAYS = 180;
const CASE_MOTION_HEARING_COURT_DAYS = 16;
const CASE_STATUS_SOURCES = {
  appeal: 'Cal. Rules of Court, rule 8.104 (60-day notice trigger; 180-day outer limit).',
  motion: 'Code Civ. Proc., sec. 1005(b) baseline: moving papers at least 16 court days before hearing.',
};
const CASE_STATUS_URLS = {
  appeal: 'https://courts.ca.gov/cms/rules/index.cfm?linkid=rule8_104&title=eight',
  motion: 'https://leginfo.legislature.ca.gov/faces/codes_displayText.xhtml?article=&chapter=4.&division=&lawCode=CCP&part=2.&title=14.',
};
const CASE_STATUS_WARN_STYLE_ID = 'sfsc-case-status-style';
const SFSC_DATA_REPO = 'aimesy/sfsc-data';
const SFSC_DATA_BRANCH = 'master';
const SFSC_DATA_RAW_BASE = `https://raw.githubusercontent.com/${SFSC_DATA_REPO}/${SFSC_DATA_BRANCH}/`;
const CASE_JSON_ROOTS = ['', SFSC_DATA_RAW_BASE];
const caseStatusRecordCache = new Map();
const caseStatusFetchCache = new Map();
let caseStatusUiInstalled = false;
let caseStatusUiPending = false;

function caseJsonShardPath(safe) {
  const key = String(safe || '').toUpperCase();
  let m = /^([A-Z]+)(\d{2})/.exec(key);
  if (m) return `archive/cases/${m[1]}/${m[2]}/${key}.json`;
  m = /^(\d{2})([A-Z]+)/.exec(key);
  if (m) return `archive/cases/${m[2]}/${m[1]}/${key}.json`;
  return `archive/cases/_MISC/unknown/${key}.json`;
}

function caseJsonPaths(safe) {
  const flat = `archive/cases/${safe}.json`;
  const shard = caseJsonShardPath(safe);
  return shard === flat ? [flat] : [shard, flat];
}

function caseJsonUrls(safe) {
  return CASE_JSON_ROOTS.flatMap((root) => caseJsonPaths(safe).map((path) => `${root}${path}`));
}

const completeDeferredReasons = new Set([
  '',
  'first_pass_complaints_petitions_and_orders',
  'legacy_pre_byte_capture',
]);

export function documentHasArchivedBytes(doc = {}) {
  const direct = firstText(doc, [
    'archive_url',
    'object_url',
    'asset_url',
    'object_path',
    'release_url',
  ]);
  if (direct) return true;
  const releaseTag = text(doc.release_tag);
  const releaseAsset = text(doc.asset_name || doc.release_asset);
  return !!(releaseTag && releaseAsset);
}

const isCompleteDeferredDocument = (doc = {}) => doc.byte_capture_deferred === true
  && completeDeferredReasons.has(text(doc.byte_capture_deferred_reason))
  && !text(doc.byte_path)
  && !text(doc.capture_error);

const byDateAsc = (a, b, keys) => {
  const av = firstText(a, keys);
  const bv = firstText(b, keys);
  return av.localeCompare(bv);
};

const byDocumentDateAsc = (a, b) => {
  const ad = firstText(a, ['filed', 'date_filed', 'FILEDATE', 'date']);
  const bd = firstText(b, ['filed', 'date_filed', 'FILEDATE', 'date']);
  if (ad && bd && ad !== bd) return ad.localeCompare(bd);
  if (ad && !bd) return -1;
  if (!ad && bd) return 1;
  const aid = text(a.doc_id ?? a.DocID ?? a.id);
  const bid = text(b.doc_id ?? b.DocID ?? b.id);
  return aid.localeCompare(bid) || ((a.__index || 0) - (b.__index || 0));
};

const normalizeParty = (party = {}) => ({
  ...party,
  name: firstText(party, ['name', 'party', 'NAME', 'PARTY']),
  party_type: firstText(party, ['party_type', 'partyType', 'type', 'PARTYTYPE', 'PARTYDESC']),
  attorneys: cleanAttorneyList(party.attorneys || party['ATTORNEY(S)']),
  filings: asList(party.filings || party['FILING(S)']).map(text).filter(Boolean),
});

const GENERIC_CASE_TITLE_RE = /^\s*(?:san\s+francisco\s+(?:superior\s+court\s+)?(?:civil|criminal)?\s*case|civil\s+case|criminal\s+case)\b/i;
const TITLE_PARTY_SPLIT_RE = /\s+(?:vs\.?|v\.?|versus)\s+/i;

const titlePartyName = (value) => {
  let s = cleanInline(value)
    .replace(/\s+/g, ' ')
    .replace(/^\s*(?:the\s+people\s+of\s+the\s+state\s+of\s+california|people\s+of\s+the\s+state\s+of\s+california)\s*$/i, 'People of the State of California')
    .replace(/\s+(?:et\s+al\.?|et\s+ux\.?)\s*$/i, '')
    .replace(/^[,;:.\s]+|[,;:.\s]+$/g, '');
  if (!s || GENERIC_CASE_TITLE_RE.test(s)) return '';
  return s;
};

function titleDerivedParties(rec = {}) {
  if (isCriminalPortalRecord(rec)) return [];
  const title = firstText(rec, ['case_title', 'CASETITLE', 'title']);
  if (!title || GENERIC_CASE_TITLE_RE.test(title)) return [];
  const parts = cleanInline(title).split(TITLE_PARTY_SPLIT_RE).map(titlePartyName).filter(Boolean);
  if (parts.length >= 2) {
    return [
      { name: parts[0], party_type: 'Plaintiff (caption)', source: 'case_title_caption' },
      { name: parts.slice(1).join(' v. '), party_type: 'Defendant (caption)', source: 'case_title_caption' },
    ];
  }
  const inRe = cleanInline(title).match(/^\s*(?:in\s+re|in\s+the\s+matter\s+of|estate\s+of|conservatorship\s+of|guardianship\s+of)\s*:?\s+(.+)$/i);
  if (inRe) {
    const name = titlePartyName(inRe[1]);
    return name ? [{ name, party_type: 'Subject (caption)', source: 'case_title_caption' }] : [];
  }
  return [];
}

const normalizeAttorney = (attorney = {}) => ({
  ...attorney,
  name: firstText(attorney, ['name', 'NAME', 'attorney']),
  role: firstText(attorney, ['role', 'type', 'TYPE', 'attorney_type']),
  bar_number: firstText(attorney, ['bar_number', 'bar', 'BARNUM']),
  address: firstText(attorney, ['address', 'ADDRESS']),
  contact_block: firstText(attorney, ['contact_block', 'contact', 'ADDRESS']),
  parties_represented: splitRepresentedParties(attorney.parties_represented || attorney.party || attorney.PARTY),
});

const normalizeDocketEvent = (entry = {}, index = 0) => ({
  ...entry,
  __index: index,
  date_filed: firstText(entry, ['date_filed', 'filedDate', 'FILEDATE', 'filed', 'date']),
  description: firstText(entry, ['description', 'docketEntryComment', 'RTEXT', 'text', 'title']),
  url: firstText(entry, ['url', 'URL', 'source_url', 'href']),
  fee: firstText(entry, ['fee', 'FEE']),
});

const normalizeDocument = (doc = {}, index = 0) => ({
  ...doc,
  __index: index,
  doc_id: doc.doc_id ?? doc.DocID ?? doc.id ?? '',
  filed: firstText(doc, ['filed', 'date_filed', 'FILEDATE', 'date']),
  date_filed: firstText(doc, ['date_filed', 'FILEDATE', 'filed', 'date']),
  description: firstText(doc, ['description', 'DESCRIPTION', 'title', 'name']),
  url: firstText(doc, ['url', 'URL', 'href', 'source_url', 'download_url', 'pdf_url', 'object_url', 'asset_url', 'document_url', 'doc_url']),
  sha256: firstText(doc, ['sha256', 'sha', 'hash']),
});

const normalizePayment = (payment = {}, index = 0) => ({
  ...payment,
  __index: index,
  date: firstText(payment, ['date', 'TRANSDATE', 'transdate']),
  amount: payment.amount ?? payment.AMOUNT ?? '',
  type: firstText(payment, ['type', 'PAYTYPETEXT', 'pay_type']),
  receipt: firstText(payment, ['receipt', 'RECEIPT_NUMBER']),
  description: firstText(payment, ['description', 'DESCRIPTION']),
});

export function caseParties(rec = {}) {
  const base = normalizeCriminalPortalCase(rec);
  const direct = asArray(base.parties).map(normalizeParty).filter(p => p.name || p.party_type);
  if (direct.length) return direct;
  return titleDerivedParties(base).map(normalizeParty).filter(p => p.name || p.party_type);
}

export function caseAttorneys(rec = {}) {
  const base = normalizeCriminalPortalCase(rec);
  return asArray(base.attorneys).map(normalizeAttorney).filter(a =>
    (a.name || a.bar_number || a.contact_block || a.role) && !ATTORNEY_TITLE_ARTIFACT_RE.test(a.name));
}

export function caseRepresentationEdges(rec = {}) {
  const edges = [];
  caseParties(rec).forEach((party, partyIndex) => {
    party.attorneys.forEach((attorneyName) => {
      edges.push({
        party_name: representedPartyName(party.name),
        party_type: party.party_type,
        attorney_name: attorneyName,
        source_field: `parties[${partyIndex}].attorneys`,
        confidence: 1,
      });
    });
  });
  caseAttorneys(rec).forEach((attorney, attorneyIndex) => {
    attorney.parties_represented.forEach((partyName) => {
      edges.push({
        party_name: partyName,
        attorney_name: attorney.name,
        bar_number: attorney.bar_number,
        source_field: `attorneys[${attorneyIndex}].parties_represented`,
        confidence: 1,
      });
    });
  });
  const seen = new Set();
  return edges.filter(edge => {
    const key = [edge.party_name, edge.attorney_name, edge.source_field].map(v => text(v).toLowerCase()).join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return text(edge.party_name) || text(edge.attorney_name);
  });
}

export function caseDocketEvents(rec = {}) {
  const base = normalizeCriminalPortalCase(rec);
  return asArray(base.docket_entries).map(normalizeDocketEvent)
    .sort((a, b) => byDateAsc(a, b, ['date_filed', 'filed', 'date']));
}

export function caseDocumentRows(rec = {}) {
  const base = normalizeCriminalPortalCase(rec);
  return asArray(base.documents).map(normalizeDocument).sort(byDocumentDateAsc);
}

export function caseFinancialRows(rec = {}) {
  const base = normalizeCriminalPortalCase(rec);
  return asArray(base.payments).map(normalizePayment)
    .sort((a, b) => byDateAsc(a, b, ['date']));
}

export function caseCompleteness(rec = {}) {
  const documents = caseDocumentRows(rec);
  const docketEvents = caseDocketEvents(rec);
  const parties = caseParties(rec);
  const attorneys = caseAttorneys(rec);
  const financialRows = caseFinancialRows(rec);
  const capturedDocuments = documents.filter(documentHasArchivedBytes).length;
  return {
    docket_events: docketEvents.length,
    documents: documents.length,
    captured_documents: capturedDocuments,
    metadata_only_documents: Math.max(0, documents.length - capturedDocuments),
    parties: parties.length,
    attorneys: attorneys.length,
    representation_edges: caseRepresentationEdges(rec).length,
    calendar_rows: asArray(rec.calendar).length,
    financial_rows: financialRows.length,
    has_source_url: !!text(rec.source_url),
    has_case_title: !!text(rec.case_title),
  };
}

// Derive freshness / provenance facts for a case from EXISTING JSON fields only.
// The archive currently records a single `captured_at` per case and no explicit
// update/patch/promotion timestamps, so this never invents history: when a
// signal is absent the caller is expected to show an honest fallback. Optional
// update fields are read defensively so a future schema can light them up
// without touching the UI.
export function caseProvenance(rec = {}) {
  const documents = caseDocumentRows(rec);
  const comp = caseCompleteness(rec);

  const captured_at = firstText(rec, ['captured_at', 'capturedAt']);
  const updated_at = firstText(rec, ['updated_at', 'last_updated', 'patched_at', 'last_patched_at']);

  const ms = (rec && typeof rec.method_status === 'object' && rec.method_status) ? rec.method_status : {};
  const method_status = Object.keys(ms).map((k) => [k, text(ms[k])]);
  const method_failures = method_status
    .filter(([, v]) => v && !/^(ok|zero|empty|none|0|n\/a)$/i.test(v))
    .map(([k]) => k);

  const availableDocs = documents.filter((d) => d.is_available !== false);
  const unavailableDocs = documents.filter((d) => d.is_available === false);
  const deferredDocs = availableDocs.filter((d) => !documentHasArchivedBytes(d) && isCompleteDeferredDocument(d));
  const documents_with_bytes = documents.filter(documentHasArchivedBytes).length;
  const documents_bytes_missing = Math.max(0, availableDocs.length - deferredDocs.length - documents_with_bytes);
  const release_tags = Array.from(new Set(documents.map((d) => text(d.release_tag)).filter(Boolean)));
  const storage_refs = Array.from(new Set(documents.map((d) =>
    text(d.object_path) || text(d.object_url) || text(d.release_tag)
  ).filter(Boolean)));

  const pendingRaw = rec.document_bytes_pending;
  const documents_bytes_pending = Array.isArray(pendingRaw) ? pendingRaw.length
    : (typeof pendingRaw === 'number' ? pendingRaw : (pendingRaw ? 1 : 0));
  const criminal_no_documents = text(rec.document_byte_capture_scope).toLowerCase() === 'criminal-portal-no-documents'
    && text(rec.case_type).toLowerCase() === 'criminal'
    && documents.length === 0;

  // Preserve (never censor) any court "unavailable / sealed" red-text notice.
  const unavailable_text = firstText(rec, ['unavailable_text', 'unavailable_red_text', 'unavailable_reason', 'message']);
  const case_unavailable = text(rec.status).toLowerCase() === 'unavailable' || !!unavailable_text;
  const has_preserved_red_text = !!unavailable_text
    || documents.some((d) => text(d.unavailable_red_text) || text(d.unavailable_text));

  // Capture completeness - derived honestly from what the JSON actually records.
  let mode;
  if (case_unavailable && comp.documents === 0 && comp.docket_events === 0) mode = 'unavailable';
  else if (criminal_no_documents) mode = 'no_documents';
  else if (deferredDocs.length > 0
    || documents_bytes_pending > 0
    || (availableDocs.length > 0 && documents_bytes_missing > 0 && !rec.document_bytes_captured)
    || method_failures.length) mode = 'partial';
  else mode = 'complete';
  if (updated_at && updated_at !== captured_at) mode = 'updated';

  return {
    captured_at,
    updated_at,
    has_update_history: !!updated_at,
    last_changed: updated_at || captured_at,
    mode,                       // 'complete' | 'partial' | 'updated' | 'unavailable' | 'no_documents'
    criminal_no_documents,
    method_status,
    method_failures,
    documents_total: documents.length,
    documents_with_bytes,
    documents_unavailable: unavailableDocs.length,
    documents_deferred: deferredDocs.length,
    documents_bytes_missing,
    documents_bytes_pending,
    document_bytes_captured: !!rec.document_bytes_captured,
    release_tags,
    storage_refs,
    case_unavailable,
    unavailable_text,
    has_preserved_red_text,
  };
}

function statusCacheKey(caseNumber) {
  return text(caseNumber).toUpperCase();
}

function cacheCaseStatusRecord(rec = {}) {
  const key = statusCacheKey(rec.case_number || rec.CASE_NUMBER || rec.caseNum);
  if (key) caseStatusRecordCache.set(key, rec);
  return rec;
}

function parseCaseStatusDate(value) {
  const s = text(value);
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(Date.UTC(+m[3], +m[1] - 1, +m[2]));
  m = s.match(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[-\s]+(\d{1,2})[-,\s]+(\d{4})\b/i);
  if (m) {
    const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    return new Date(Date.UTC(+m[3], months[m[1].slice(0, 3).toLowerCase()], +m[2]));
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function fmtStatusDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function dateOnlyText(value) {
  const parsed = parseCaseStatusDate(value);
  if (parsed) return fmtStatusDate(parsed);
  return text(value).slice(0, 10);
}

function firstCaseFilingDateText(rec = {}) {
  const header = rec.case_header && typeof rec.case_header === 'object' ? rec.case_header : {};
  const direct = firstText(rec, ['filing_date', 'filed_date', 'filedDate', 'date_filed', 'FILEDATE', 'filed'])
    || firstText(header, ['filing_date', 'filed_date', 'filedDate', 'date_filed', 'FILEDATE', 'filed']);
  if (direct) return dateOnlyText(direct);
  const entries = caseDocketEvents(rec);
  const complaint = entries.find(e => /\b(?:complaint|petition)\b/i.test(cleanInline(e.description)));
  const anchor = complaint || entries.find(e => firstText(e, ['date_filed', 'filed', 'date'])) || null;
  if (anchor) return dateOnlyText(firstText(anchor, ['date_filed', 'filed', 'date']));
  const doc = caseDocumentRows(rec).find(d => firstText(d, ['filed', 'date_filed', 'date']));
  return doc ? dateOnlyText(firstText(doc, ['filed', 'date_filed', 'date'])) : '';
}

function unavailableStatusParts(rec = {}, pv = {}) {
  if (text(rec.unavailable_reason).toLowerCase() === 'sealed_or_unavailable_tentative_stub') {
    // Our own minimal tentative-derived stub, not a captured court notice - do
    // not dress its placeholder text up as a Civ. Proc. Code restriction.
    return {
      statusLabel: 'Minimal tentative ruling profile',
      statusLabelHtml: '',
      statusDetail: 'Generated from tentative ruling data; the CaseInfo docket was not captured.',
    };
  }
  if (text(rec.unavailable_reason).toLowerCase() === 'criminal_portal_no_public_entries') {
    const statusLabel = stripCriminalPortalMachineReason(rec.unavailable_text)
      || criminalNoInformationText(criminalHeaderDefendant(rec), criminalHeaderFiledDate(rec), criminalChargeText(rec));
    return { statusLabel, statusLabelHtml: htmlEscape(statusLabel), statusDetail: '' };
  }
  const notice = unavailableNotice(pv.unavailable_text || '');
  return {
    statusLabel: notice.titlePlain,
    statusLabelHtml: notice.titleHtml,
    statusDetail: notice.subtitle,
  };
}

function capturedOpenStatus(rec = {}) {
  const header = rec.case_header && typeof rec.case_header === 'object' ? rec.case_header : {};
  const accepted = new Set(['active', 'case active', 'open', 'case open', 'pending', 'case pending']);
  for (const source of [rec, header]) {
    for (const field of ['court_case_status', 'case_status', 'status']) {
      const value = text(source[field]);
      const normalized = value.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (accepted.has(normalized)) return value;
    }
  }
  return '';
}

function evidencePendingCaseStatusSummary(rec = {}) {
  const pv = caseProvenance(rec);
  const noData = !!pv.case_unavailable;
  const openStatus = capturedOpenStatus(rec);
  const criminal = isCriminalPortalRecord(rec);
  let caseStatus = 'unknown';
  let statusLabel = 'Unknown / no final disposition detected';
  let statusLabelHtml = '';
  let statusDetail = 'Canonical outcome evidence has not established a final disposition for this case.';
  if (noData) {
    const parts = unavailableStatusParts(rec, pv);
    caseStatus = 'unavailable';
    statusLabel = parts.statusLabel;
    statusLabelHtml = parts.statusLabelHtml;
    statusDetail = parts.statusDetail;
  } else if (openStatus) {
    caseStatus = 'affirmatively_open';
    statusLabel = `Court status: ${openStatus}`;
    statusDetail = 'This open status comes from an explicit captured court-status field, not from the absence of a detected disposition.';
  }
  const lastChangedDate = parseCaseStatusDate(pv.last_changed);
  const docketRows = caseDocketEvents(rec);
  const documentRows = caseDocumentRows(rec);
  return {
    status_domain: criminal ? 'criminal' : 'unknown',
    case_status: caseStatus,
    status_label: statusLabel,
    status_label_html: statusLabelHtml,
    status_detail: statusDetail,
    no_data: noData,
    has_disposition_evidence: false,
    has_final_disposition: false,
    has_current_final_disposition: false,
    has_final_judgment: false,
    whole_case_terminated: false,
    affirmatively_open: !!openStatus,
    final_disposition_type: '',
    final_disposition_date: '',
    finality_label: noData ? 'No data' : 'Unknown / no final disposition detected',
    judgment_entered: false,
    judgment_is_vacated: false,
    judgment_date: '',
    dismissal_entered: false,
    dismissal_date: '',
    satisfied: false,
    satisfaction_date: '',
    settled: false,
    settlement_date: '',
    appeal_status: noData ? 'no_data' : 'unknown_not_computed_from_outcome_evidence',
    appeal_label: noData ? 'No data' : 'Not computed from canonical outcome evidence',
    appeal_deadline: '',
    appeal_deadline_basis: '',
    appeal_notice_date: '',
    remittitur_issued: false,
    remittitur_date: '',
    scan_warning: null,
    freshness_label: pv.last_changed ? `Updated ${fmtStatusDate(lastChangedDate)}` : 'Update date unavailable',
    criminal_roa_count: criminal ? docketRows.length : 0,
    criminal_document_count: criminal ? documentRows.length : 0,
    criminal_document_label: criminal
      ? (documentRows.length ? `${documentRows.length} document row${documentRows.length === 1 ? '' : 's'}` : 'No documents recorded')
      : '',
    criminal_disposition_label: criminal ? 'Unknown / no canonical final disposition detected' : '',
    disposition_domains: [],
    disposition_groups: [],
    sources: CASE_STATUS_SOURCES,
    source_urls: CASE_STATUS_URLS,
    signals: {},
  };
}

export function caseStatusSummary(rec = {}, opts = {}) {
  // Outcome classification is asynchronous and comes from the canonical
  // judgment shard. This synchronous base exposes only captured metadata.
  return evidencePendingCaseStatusSummary(rec);
}

function statusValueHtml(value, detail = '') {
  const safeValue = htmlEscape(value || '');
  const safeDetail = htmlEscape(detail || '');
  return safeDetail
    ? `<div>${safeValue}</div><div class="cs-case-status-detail">${safeDetail}</div>`
    : safeValue;
}

function statusTableRows(summary) {
  const warning = summary.scan_warning;
  if (summary.status_domain === 'criminal') {
    return [
      ['case_status', summary.status_label, summary.status_detail],
      ['criminal_roa', `${summary.criminal_roa_count || 0} ROA row${summary.criminal_roa_count === 1 ? '' : 's'}`, summary.signals?.criminalCurrent?.snippet || ''],
      ['documents', summary.criminal_document_label || 'No documents recorded', summary.criminal_document_count ? '' : 'The criminal portal exposes no document rows for this case.'],
      ['canonical_outcome', summary.has_disposition_evidence ? summary.finality_label : 'Unknown / no final disposition detected', summary.signals?.canonicalDisposition?.source_text || ''],
      ['scan_freshness', summary.freshness_label, ''],
    ];
  }
  return [
    ['case_status', summary.status_label, summary.status_detail],
    ['canonical_outcome', summary.no_data ? 'No data' : summary.finality_label, summary.no_data ? '' : (summary.signals?.canonicalDisposition?.source_text || '')],
    ['whole_case_closure', summary.whole_case_terminated ? 'Established by canonical evidence' : 'Not established', summary.case_closure_basis || 'A domain, party, claim, petition, count, or issue disposition is not silently promoted to whole-case closure.'],
    ['disposition_domains', (summary.disposition_domains || []).join('; ') || 'none recorded', 'Canonical observed outcome domains.'],
    ['scan_freshness', warning ? warning.reason : summary.freshness_label, ''],
  ];
}

// Official statute text on the California Legislative Information site.
const LEGINFO_URL = (lawCode, section) => `https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=${lawCode}&sectionNum=${section}`;
const UNAVAILABLE_NO_DETAIL = 'No additional public docket detail is available in the captured record.';

function statuteLinkHtml(label, href) {
  return `<a class="cs-statute-link" href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
}

// Map a captured court "unavailable" notice to a normalized { titleHtml,
// titlePlain, subtitle } for the status card. Recognized restriction bases get
// curated titles (statutes link to their official text); anything else is shown
// exactly as captured. Subtitles follow the owner's per-category spec.
function unavailableNotice(text) {
  const t = (text || '').trim();
  const cited = (prefix, label, lawCode, section) => ({
    titleHtml: `${prefix}${statuteLinkHtml(label, LEGINFO_URL(lawCode, section))}`,
    titlePlain: `${prefix}${label}`,
    subtitle: '',
  });
  const plain = (title, subtitle = '') => ({ titleHtml: htmlEscape(title), titlePlain: title, subtitle });
  const NA = 'Case is not available for viewing per ';
  const PA = 'Public access to this case is restricted pursuant to ';

  if (/ccp\s*1161\.2\.5/i.test(t)) return cited(NA, 'Civ. Proc. Code § 1161.2.5', 'CCP', '1161.2.5');
  if (/ccp\s*1161\.2/i.test(t))   return cited(NA, 'Civ. Proc. Code § 1161.2', 'CCP', '1161.2');
  if (/2\.503/i.test(t)) {
    const prefix = "Case is restricted from the Court's website pursuant to Rule of Court subdivisions ";
    const label = '2.503(A)(1) and 2.503(C)';
    return {
      titleHtml: `${prefix}${statuteLinkHtml(label, 'https://courts.ca.gov/cms/rules/index/two/rule2_503')}.`,
      titlePlain: `${prefix}${label}.`,
      subtitle: '',
    };
  }
  if (/restricted\s+pursuant\s+to\s+court\s+order/i.test(t)) return plain('Case is restricted pursuant to an order of the Court.', UNAVAILABLE_NO_DETAIL);
  if (/482\.050/i.test(t))         return cited(PA, 'Civ. Proc. Code 482.050', 'CCP', '482.050');
  if (/12652/i.test(t))            return cited(PA, 'Government Code § 12652 subd. (c)', 'GOV', '12652');
  if (/not\s+available\s+for\s+viewing/i.test(t)) return plain('Case not available for viewing', UNAVAILABLE_NO_DETAIL);
  if (!t)                          return plain('Case not available for viewing', UNAVAILABLE_NO_DETAIL);
  // remaining (confidential / not authorized / other): exact captured text + silent
  return plain(t, UNAVAILABLE_NO_DETAIL);
}

function statusDossierHtml(summary) {
  const warning = summary.scan_warning;
  if (summary.status_domain === 'criminal') {
    return `<div class="cs-case-status-card${warning ? ' is-warning' : ''}" data-case-status-ui="dossier">`
      + `<div class="cs-case-status-kicker">Status</div>`
      + `<div class="cs-case-status-main">${summary.status_label_html || htmlEscape(summary.status_label)}</div>`
      + `<div class="cs-case-status-detail">${htmlEscape(summary.status_detail)}</div>`
      + `<div class="cs-case-status-grid">`
      + `<span><b>ROA</b>${htmlEscape(`${summary.criminal_roa_count || 0} row${summary.criminal_roa_count === 1 ? '' : 's'}`)}</span>`
      + `<span><b>Documents</b>${htmlEscape(summary.criminal_document_label || 'No documents recorded')}</span>`
      + `<span><b>Outcome evidence</b>${htmlEscape(summary.finality_label || 'Unknown')}</span>`
      + `<span><b>Scan</b>${htmlEscape(summary.freshness_label)}</span>`
      + `</div>`
      + (warning ? `<div class="cs-case-status-warning">${htmlEscape(warning.reason)}</div>` : '')
      + `</div>`;
  }
  const finality = summary.no_data
    ? 'No data'
    : summary.finality_label || 'Unknown / no final disposition detected';
  return `<div class="cs-case-status-card${warning ? ' is-warning' : ''}" data-case-status-ui="dossier">`
    + `<div class="cs-case-status-kicker">Status</div>`
    + `<div class="cs-case-status-main">${summary.status_label_html || htmlEscape(summary.status_label)}</div>`
    + `<div class="cs-case-status-detail">${htmlEscape(summary.status_detail)}</div>`
    + `<div class="cs-case-status-grid">`
    + `<span><b>Outcome evidence</b>${htmlEscape(finality)}</span>`
    + `<span><b>Whole-case closure</b>${htmlEscape(summary.whole_case_terminated ? 'established' : 'not established')}</span>`
    + `<span><b>Domains</b>${htmlEscape((summary.disposition_domains || []).join('; ') || 'none recorded')}</span>`
    + `<span><b>Scan</b>${htmlEscape(summary.freshness_label)}</span>`
    + `</div>`
    + (warning ? `<div class="cs-case-status-warning">${htmlEscape(warning.reason)}</div>` : '')
    + `</div>`;
}

function caseStatusCss() {
  return `
    .cs-lastupd.has-warning {
      color: #a21d21;
      border-bottom-color: #c82d31;
    }
    .cs-scan-warning {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 0.86rem;
      height: 0.76rem;
      margin-left: 0.24rem;
      clip-path: polygon(50% 0, 100% 100%, 0 100%);
      background: #c82d31;
      color: #fff;
      font: 800 0.55rem/1 var(--font-mono, ui-monospace, monospace);
      cursor: help;
      transform: translateY(0.08rem);
    }
    .cs-case-status-card {
      display: grid;
      gap: 0.32rem;
      padding: 0.48rem 0.54rem;
      border: 1px solid var(--rule-2);
      border-left: 3px solid var(--chrome-accent);
      background: var(--paper-2);
      font-family: var(--font-mono);
      font-size: 0.66rem;
      line-height: 1.38;
    }
    .cs-case-status-card.is-warning {
      border-left-color: #c82d31;
      background: color-mix(in srgb, #c82d31 8%, var(--paper-2));
    }
    .cs-case-status-kicker {
      color: var(--ink-3);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-size: 0.58rem;
    }
    .cs-case-status-main {
      color: var(--ink);
      font-family: var(--font-serif);
      font-size: 0.92rem;
      font-weight: 700;
    }
    .cs-case-status-detail {
      color: var(--ink-2);
      font-size: 0.62rem;
      line-height: 1.38;
    }
    .cs-statute-link {
      color: inherit;
      text-decoration: underline;
      text-underline-offset: 0.12em;
    }
    .cs-case-status-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 0.28rem;
    }
    .cs-case-status-grid span {
      min-width: 0;
      padding: 0.26rem 0.3rem;
      border: 1px solid var(--rule-2);
      background: var(--paper);
      color: var(--ink-2);
      overflow-wrap: anywhere;
    }
    .cs-case-status-grid b {
      display: block;
      margin-bottom: 0.08rem;
      color: var(--ink-3);
      font-size: 0.54rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .cs-case-status-warning {
      color: #8f171b;
      font-size: 0.62rem;
    }
    tr[data-case-status-row] td:first-child {
      color: var(--ink-3);
      font-family: var(--font-mono);
      text-transform: lowercase;
    }
    @media (max-width: 760px) {
      .cs-case-status-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
  `;
}

function injectCaseStatusCss() {
  if (typeof document === 'undefined' || document.getElementById(CASE_STATUS_WARN_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = CASE_STATUS_WARN_STYLE_ID;
  style.textContent = caseStatusCss();
  document.head.appendChild(style);
}

function renderedCaseNumber() {
  if (typeof document === 'undefined') return '';
  const workspace = document.querySelector('#case-search-panel .cs-workspace');
  if (!workspace?.querySelector('[data-cs-component="caseInfo"]')) return '';
  return text(workspace.querySelector('.cs-casenum')?.textContent);
}

function safeCaseJsonName(value) {
  return String(value).replace(/\.+/g, '_').replace(/[^A-Za-z0-9_-]/g, '_');
}

async function fetchCaseStatusRecord(caseNumber) {
  const key = statusCacheKey(caseNumber);
  if (!key) return null;
  if (caseStatusRecordCache.has(key)) return caseStatusRecordCache.get(key);
  if (!caseStatusFetchCache.has(key)) {
    const safe = safeCaseJsonName(caseNumber);
    const promise = fetchCaseJsonRecord(safe)
      .then((rec) => normalizeCaseFacts(rec))
      .catch(() => null);
    caseStatusFetchCache.set(key, promise);
  }
  return caseStatusFetchCache.get(key);
}

async function fetchCaseJsonRecord(safe) {
  let lastError = null;
  for (const url of caseJsonUrls(safe)) {
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastError || new Error('case JSON unavailable');
}

function decorateLastUpdated(workspace, summary) {
  const stamp = workspace.querySelector('.cs-headmeta .cs-lastupd');
  if (!stamp) return;
  const warning = summary.scan_warning;
  if (!stamp.dataset.statusBaseTitle) stamp.dataset.statusBaseTitle = stamp.getAttribute('title') || '';
  const warningSig = warning ? warning.reason : '';
  if (stamp.dataset.statusWarningSig === warningSig) return;
  stamp.dataset.statusWarningSig = warningSig;
  const baseTitle = stamp.dataset.statusBaseTitle || '';
  stamp.classList.toggle('has-warning', !!warning);
  stamp.setAttribute('title', warning ? `${baseTitle}${baseTitle ? '\n' : ''}${warning.reason}` : baseTitle);
  const next = stamp.nextElementSibling;
  if (next?.matches?.('[data-case-status-warning-icon]')) next.remove();
  if (warning) {
    stamp.insertAdjacentHTML('afterend', `<span class="cs-scan-warning" data-case-status-warning-icon title="${htmlEscape(warning.reason)}">!</span>`);
  }
}

function decorateCaseInfoDossier(component, summary) {
  const dossier = component.querySelector('.cs-dossier');
  if (!dossier) return false;
  const existing = dossier.querySelector('[data-case-status-ui]');
  const html = statusDossierHtml(summary);
  if (existing) existing.outerHTML = html;
  else dossier.insertAdjacentHTML('afterbegin', html);
  return true;
}

function decorateCaseInfoTable(component, summary) {
  const tableBody = component.querySelector('.cs-record-table tbody');
  if (!tableBody) return false;
  tableBody.querySelectorAll('[data-case-status-row]').forEach(row => row.remove());
  const rows = statusTableRows(summary).map(([key, value, detail]) => (
    `<tr data-case-status-row="${htmlEscape(key)}"><td>${htmlEscape(key)}</td><td>${statusValueHtml(value, detail)}</td></tr>`
  )).join('');
  tableBody.insertAdjacentHTML('afterbegin', rows);
  return true;
}

function decorateCaseInfo(workspace, summary) {
  const component = workspace.querySelector('[data-cs-component="caseInfo"]');
  if (!component) return;
  const mode = component.querySelector('.cs-dossier') ? 'dossier' : component.querySelector('.cs-record-table') ? 'table' : '';
  const sig = [
    mode,
    summary.case_status,
    summary.final_disposition_date,
    summary.appeal_status,
    summary.appeal_deadline,
    summary.remittitur_date,
    summary.scan_warning?.date || '',
  ].join('|');
  if (component.dataset.caseStatusSig === sig) return;
  component.dataset.caseStatusSig = sig;
  if (decorateCaseInfoDossier(component, summary)) return;
  decorateCaseInfoTable(component, summary);
}

async function applyCaseStatusUi() {
  if (typeof document === 'undefined') return;
  const workspace = document.querySelector('#case-search-panel .cs-workspace');
  if (!workspace) return;
  const caseNumber = renderedCaseNumber();
  if (!caseNumber) return;
  const rec = caseStatusRecordCache.get(statusCacheKey(caseNumber)) || await fetchCaseStatusRecord(caseNumber);
  if (!rec) return;
  const summary = rec.case_status_summary && typeof rec.case_status_summary === 'object'
    ? rec.case_status_summary
    : caseStatusSummary(rec);
  injectCaseStatusCss();
  decorateLastUpdated(workspace, summary);
  decorateCaseInfo(workspace, summary);
}

export function applyCanonicalCaseStatus(rec, summary) {
  if (!rec || !summary || typeof summary !== 'object') return;
  rec.case_status_summary = summary;
  cacheCaseStatusRecord(rec);
  if (typeof document === 'undefined') return;
  const workspace = document.querySelector('#case-search-panel .cs-workspace');
  if (!workspace || statusCacheKey(renderedCaseNumber()) !== statusCacheKey(rec.case_number)) return;
  injectCaseStatusCss();
  decorateLastUpdated(workspace, summary);
  decorateCaseInfo(workspace, summary);
}

function scheduleCaseStatusUi() {
  if (caseStatusUiPending) return;
  caseStatusUiPending = true;
  window.setTimeout(() => {
    caseStatusUiPending = false;
    applyCaseStatusUi();
  }, 0);
}

function installCaseStatusUi() {
  if (caseStatusUiInstalled || typeof document === 'undefined' || typeof window === 'undefined') return;
  caseStatusUiInstalled = true;
  const start = () => {
    injectCaseStatusCss();
    scheduleCaseStatusUi();
    const root = document.getElementById('case-search-panel') || document.body;
    if (!root || typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(scheduleCaseStatusUi);
    observer.observe(root, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}

installCaseStatusUi();

export function normalizeCaseVersionHistory(payload = []) {
  const rows = Array.isArray(payload)
    ? payload
    : asArray(payload.commits || payload.history || payload.versions);
  const seen = new Set();
  return rows.map((item = {}) => {
    const commit = item.commit && typeof item.commit === 'object' ? item.commit : {};
    const author = commit.author && typeof commit.author === 'object' ? commit.author : {};
    const committer = commit.committer && typeof commit.committer === 'object' ? commit.committer : {};
    const message = text(commit.message || item.message || item.subject);
    const sha = firstText(item, ['sha', 'commit', 'commit_sha']);
    const date = firstText(item, ['date', 'committed_at', 'captured_at']) || text(committer.date || author.date);
    const subject = text(message.split(/\r?\n/)[0]);
    return {
      sha,
      short_sha: sha ? sha.slice(0, 7) : '',
      date,
      subject,
      author: text(author.name || item.author),
      committer: text(committer.name || item.committer),
      html_url: firstText(item, ['html_url', 'url', 'commit_url']),
      status: firstText(item, ['status', 'change']),
    };
  }).filter((row) => {
    const key = row.sha || `${row.date}\n${row.subject}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return !!(row.sha || row.date || row.subject);
  });
}

export function normalizeCaseFacts(rec = {}) {
  const base = normalizeCriminalPortalCase(rec);
  const source_url = caseSourceUrl(base);
  const normalized = {
    ...base,
    case_number: firstText(base, ['case_number', 'CASE_NUMBER', 'caseNum']),
    case_title: firstText(base, ['case_title', 'CASETITLE', 'title']),
    court: firstText(base, ['court', 'COURT']),
    cause_of_action: firstText(base, ['cause_of_action', 'cause', 'CAUSE']),
    filing_date: firstCaseFilingDateText(base),
    captured_at: firstText(base, ['captured_at', 'capturedAt']),
    source_url,
    parties: caseParties(base),
    attorneys: caseAttorneys(base),
    representation_edges: caseRepresentationEdges(base),
    docket_entries: caseDocketEvents(base),
    calendar: asArray(base.calendar),
    documents: caseDocumentRows(base),
    payments: caseFinancialRows(base),
    completeness: { ...caseCompleteness(base), has_source_url: !!source_url },
  };
  normalized.case_status_summary = caseStatusSummary(normalized);
  return cacheCaseStatusRecord(normalized);
}

