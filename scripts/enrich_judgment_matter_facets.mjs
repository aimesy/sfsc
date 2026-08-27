#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

export function normalizeMatterKey(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function compactKey(value) {
  return normalizeMatterKey(value).replaceAll(' ', '_') || 'unknown';
}

function normalizeCaseNumber(value) {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  const body = `${JSON.stringify(value)}\n`;
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, body);
  fs.renameSync(temporary, file);
  return crypto.createHash('sha256').update(body).digest('hex');
}

function taxonomyLookup(taxonomy) {
  const nodes = new Map((taxonomy.nodes || []).map((item) => [String(item.id || ''), item]));
  const rootFor = (parentId) => {
    let node = nodes.get(String(parentId || ''));
    const visited = new Set();
    while (node?.parent_id && !visited.has(node.id)) {
      visited.add(node.id);
      node = nodes.get(String(node.parent_id)) || node;
      if (!node.parent_id) break;
    }
    return String(node?.label || 'Unclassified');
  };
  const lookup = new Map();
  for (const item of taxonomy.clerk_categories || []) {
    const key = normalizeMatterKey(item.normalized_label || item.label);
    if (!key) continue;
    lookup.set(key, {
      matterType: rootFor(item.parent_id),
      matterCategory: String(item.label || item.normalized_label || 'Unknown'),
    });
  }
  return lookup;
}

function inferredMatterType(caseNumber) {
  const prefix = normalizeCaseNumber(caseNumber).match(/^[A-Z]+/)?.[0] || '';
  if (['CGC', 'CJC', 'CSM', 'CUD', 'CPF', 'PCN'].includes(prefix)) return 'Civil';
  if (['PES', 'PTR'].includes(prefix)) return 'Probate';
  if (['DPO', 'FAD', 'FCS', 'FDI', 'FDV', 'FJD', 'FLD', 'FMS', 'FPT', 'FSD'].includes(prefix)) return 'Family';
  if (prefix === 'CRI') return 'Criminal';
  return 'Unclassified';
}

function facetRecord(meta, caseNumber = '') {
  const inferred = inferredMatterType(caseNumber);
  const classified = meta?.matterType || '';
  const matterType = !classified || (classified === 'Unclassified' && inferred !== 'Unclassified')
    ? inferred : classified;
  const matterCategory = meta?.matterCategory || 'Unknown';
  const matterTypeKey = compactKey(matterType);
  return {
    matter_type: matterType,
    matter_type_key: matterTypeKey,
    matter_category: matterCategory,
    matter_category_key: `${matterTypeKey}:${compactKey(matterCategory)}`,
  };
}

export function enrichJudgmentMatterFacets(options) {
  const manifest = readJson(options.manifest);
  const taxonomy = readJson(options.taxonomy);
  const categoryCases = readJson(options.categoryCases);
  const rankingShards = Array.isArray(manifest.ranking_shards) ? manifest.ranking_shards : [];
  if (!rankingShards.length || !categoryCases?.cases || typeof categoryCases.cases !== 'object') {
    throw new Error('Judgment shards or clerk-category case assignments are unavailable.');
  }
  const shardPayloads = [];
  const neededCases = new Set();
  for (const entry of rankingShards) {
    const file = path.join(options.rankingDir, path.basename(String(entry.path || '')));
    const payload = readJson(file);
    if (!Array.isArray(payload.rankings) || payload.rankings.length !== Number(entry.count)) {
      throw new Error(`Judgment shard failed validation: ${file}`);
    }
    for (const row of payload.rankings) neededCases.add(normalizeCaseNumber(row.case_number));
    shardPayloads.push({ entry, file, payload });
  }
  const clerkLookup = taxonomyLookup(taxonomy);
  const caseFacets = new Map();
  for (const [categoryKey, packedCases] of Object.entries(categoryCases.cases)) {
    const meta = clerkLookup.get(normalizeMatterKey(categoryKey));
    if (!meta) continue;
    for (const rawCaseNumber of String(packedCases || '').split(',')) {
      const caseNumber = normalizeCaseNumber(rawCaseNumber);
      if (!neededCases.has(caseNumber)) continue;
      const previous = caseFacets.get(caseNumber);
      if (previous && (previous.matterType !== meta.matterType
          || previous.matterCategory !== meta.matterCategory)) {
        throw new Error(`Conflicting matter categories for judgment case ${caseNumber}.`);
      }
      caseFacets.set(caseNumber, meta);
    }
  }
  const typeCounts = new Map();
  const categoryCounts = new Map();
  const enrich = (row, count = false) => {
    const facet = facetRecord(caseFacets.get(normalizeCaseNumber(row.case_number)), row.case_number);
    Object.assign(row, facet);
    if (count) {
      typeCounts.set(facet.matter_type_key, {
        key: facet.matter_type_key,
        label: facet.matter_type,
        judgment_count: (typeCounts.get(facet.matter_type_key)?.judgment_count || 0) + 1,
      });
      categoryCounts.set(facet.matter_category_key, {
        key: facet.matter_category_key,
        label: facet.matter_category,
        matter_type: facet.matter_type_key,
        judgment_count: (categoryCounts.get(facet.matter_category_key)?.judgment_count || 0) + 1,
      });
    }
    return row;
  };
  let publishedCount = 0;
  for (const { entry, file, payload } of shardPayloads) {
    for (const row of payload.rankings) enrich(row, true);
    entry.sha256 = writeJson(file, payload);
    publishedCount += payload.rankings.length;
  }
  if (publishedCount !== Number(manifest.published_judgment_count)) {
    throw new Error(`Enriched ${publishedCount} of ${manifest.published_judgment_count} judgments.`);
  }
  for (const row of manifest.rankings || []) enrich(row, false);
  manifest.matter_types = [...typeCounts.values()]
    .sort((left, right) => right.judgment_count - left.judgment_count || left.label.localeCompare(right.label));
  manifest.matter_categories = [...categoryCounts.values()]
    .sort((left, right) => right.judgment_count - left.judgment_count || left.label.localeCompare(right.label));
  manifest.matter_type_count = manifest.matter_types.length;
  manifest.matter_category_count = manifest.matter_categories.length;
  manifest.data_completeness = {
    ...(manifest.data_completeness || {}),
    missing_matter_category_count: publishedCount - caseFacets.size,
  };
  manifest.methodology = {
    ...(manifest.methodology || {}),
    matter_filters: 'matter type is the top-level SFSC case taxonomy domain; matter category is the mutually exclusive verbatim clerk category assigned to the case',
    matter_filter_fallback: 'when a clerk-category assignment is absent, matter type is inferred from the court case-number series and matter category is Unknown',
  };
  writeJson(options.manifest, manifest);
  if (options.output) {
    const groups = new Map();
    for (const caseNumber of [...neededCases].sort()) {
      const facet = facetRecord(caseFacets.get(caseNumber), caseNumber);
      const fields = [facet.matter_type_key, facet.matter_type,
        facet.matter_category_key, facet.matter_category];
      const key = JSON.stringify(fields);
      if (!groups.has(key)) groups.set(key, { fields, cases: [] });
      groups.get(key).cases.push(caseNumber);
    }
    writeJson(options.output, {
      schema_version: 1,
      source_commit: String(manifest.source_commit || ''),
      columns: ['matter_type_key', 'matter_type', 'matter_category_key', 'matter_category', 'comma_separated_case_numbers'],
      facet_groups: [...groups.values()].map(({ fields, cases }) => [...fields, cases.join(',')]),
    });
  }
  return {
    publishedCount,
    matchedCount: caseFacets.size,
    matterTypeCount: manifest.matter_types.length,
    matterCategoryCount: manifest.matter_categories.length,
  };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--manifest') options.manifest = value;
    else if (flag === '--ranking-dir') options.rankingDir = value;
    else if (flag === '--taxonomy') options.taxonomy = value;
    else if (flag === '--category-cases') options.categoryCases = value;
    else if (flag === '--output') options.output = value;
    else throw new Error(`Unknown argument: ${flag}`);
  }
  for (const key of ['manifest', 'rankingDir', 'taxonomy', 'categoryCases']) {
    if (!options[key]) throw new Error(`--${key.replace(/[A-Z]/g, (value) => `-${value.toLowerCase()}`)} is required`);
  }
  return options;
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const result = enrichJudgmentMatterFacets(parseArgs(process.argv.slice(2)));
  process.stdout.write(`Enriched ${result.publishedCount.toLocaleString()} judgments across ${result.matterTypeCount} matter types and ${result.matterCategoryCount} matter categories; ${result.matchedCount.toLocaleString()} cases matched the clerk-category index.\n`);
}
