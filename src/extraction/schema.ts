import { parseHTML } from 'linkedom';
import { extractStructuredData } from './structured-data.js';
import { extractStructured } from './structured.js';
import { extractWithLLM, type LLMFallbackBudget } from './llm-fallback.js';
import { applyEvidenceFilter, getSourceText } from './schema-truth.js';
import type {
  FieldProvenance,
  SchemaExtractionResult,
  StructuredData,
  StructuredDataResult,
} from '../types.js';

export interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
}

export interface SchemaExtractionOpts {
  signal?: AbortSignal;
  budget?: LLMFallbackBudget;
}

const PROVENANCE_PRIORITY: StructuredDataResult['provenance'][] = [
  'json-ld',
  'microdata',
  'rdfa',
];

export function extractWithSchema(
  html: string,
  schema: JsonSchema,
): Record<string, unknown> {
  return extractWithSchemaDetailed(html, schema).values;
}

export function extractWithSchemaDetailed(
  html: string,
  schema: JsonSchema,
): SchemaExtractionResult {
  const values: Record<string, unknown> = {};
  const provenance: Record<string, FieldProvenance> = {};
  if (!html || !schema.properties) return { values, provenance };

  const blocks = extractStructuredData(html);

  for (const source of PROVENANCE_PRIORITY) {
    for (const block of blocks) {
      if (block.provenance !== source) continue;
      for (const fieldName of Object.keys(schema.properties)) {
        if (values[fieldName] !== undefined) continue;
        const v = pickField(block.fields, fieldName);
        if (v !== undefined) {
          values[fieldName] = v;
          provenance[fieldName] = source;
        }
      }
    }
  }

  const allCovered = () =>
    Object.keys(schema.properties!).every((k) => values[k] !== undefined);
  if (allCovered()) return { values, provenance };

  // Structure fuzzy-match: when data lives in tables / definition lists /
  // key-value pairs (not JSON-LD or class-named DOM), fuzzy-match remaining
  // schema fields against those extracted structures. This is why a page
  // whose facts sit in a <table> used to return {} — the keyless path never
  // consulted extractStructured. Fuzzy = token overlap / substring /
  // snake↔space↔camel folding; provenance = 'structured'.
  const structured = extractStructured(html);
  for (const fieldName of Object.keys(schema.properties)) {
    if (values[fieldName] !== undefined) continue;
    const v = matchFieldFromStructures(fieldName, structured);
    if (v !== undefined) {
      values[fieldName] = v;
      provenance[fieldName] = 'structured';
    }
  }

  if (allCovered()) return { values, provenance };

  // Heuristic fallback only for fields still missing
  const { document: doc } = parseHTML(html);
  for (const [fieldName, fieldSchema] of Object.entries(schema.properties)) {
    if (values[fieldName] !== undefined) continue;
    const v = findFieldValue(doc, fieldName, fieldSchema);
    if (v !== undefined) {
      values[fieldName] = v;
      provenance[fieldName] = 'heuristic';
    }
  }

  return { values, provenance };
}

// ---------- structure fuzzy-match helpers ----------

// Fold a label into comparable tokens: lowercase, split on
// snake_case / camelCase / spaces / hyphens, drop empties.
function foldTokens(label: string): string[] {
  return label
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

// Do a schema field name and a structure key/header refer to the same thing?
// Match on exact compact equality, substring containment, or full token-set
// overlap (every token of the shorter side present in the longer). This folds
// `plan_name` ↔ `Plan Name` ↔ `planName` while rejecting unrelated labels.
function labelsMatch(fieldName: string, candidate: string): boolean {
  const a = foldTokens(fieldName);
  const b = foldTokens(candidate);
  if (a.length === 0 || b.length === 0) return false;

  const compactA = a.join('');
  const compactB = b.join('');
  if (compactA === compactB) return true;
  if (compactA.length >= 4 && compactB.length >= 4) {
    if (compactA.includes(compactB) || compactB.includes(compactA)) return true;
  }

  const setA = new Set(a);
  const setB = new Set(b);
  const [small, big] = setA.size <= setB.size ? [setA, setB] : [setB, setA];
  for (const t of small) {
    if (!big.has(t)) return false;
  }
  return true;
}

// Fuzzy-match one schema field against extracted key-value pairs, definition
// terms, and table headers (header→cell value). Returns the first confident
// match, or undefined when nothing corresponds (no false positives).
function matchFieldFromStructures(
  fieldName: string,
  structured: StructuredData,
): string | undefined {
  for (const kv of structured.key_value_pairs) {
    if (labelsMatch(fieldName, kv.key)) return kv.value;
  }

  for (const def of structured.definitions) {
    if (labelsMatch(fieldName, def.term)) return def.description;
  }

  for (const table of structured.tables) {
    for (let i = 0; i < table.headers.length; i++) {
      const header = table.headers[i];
      if (!labelsMatch(fieldName, header)) continue;
      for (const row of table.rows) {
        const cell = row[header];
        if (cell !== undefined && cell !== '') return cell;
      }
    }
  }

  return undefined;
}

export interface SchemaExtractionAsyncResult extends SchemaExtractionResult {
  warnings: string[];
}

export async function extractWithSchemaDetailedAsync(
  html: string,
  schema: JsonSchema,
  opts: SchemaExtractionOpts = {},
): Promise<SchemaExtractionAsyncResult> {
  const det = extractWithSchemaDetailed(html, schema);

  if (!schema.required || schema.required.length === 0) {
    return { ...det, warnings: [] };
  }

  const missing = schema.required.filter((k) => det.values[k] === undefined);
  if (missing.length === 0) {
    return { ...det, warnings: [] };
  }

  const llm = await extractWithLLM({
    html,
    jsonSchema: schema as unknown as Record<string, unknown>,
    partial: det.values,
    missing,
    signal: opts.signal,
    budget: opts.budget,
  });

  const values = { ...det.values };
  const provenance: Record<string, FieldProvenance> = { ...det.provenance };
  const llmFilledFields: string[] = [];
  for (const key of missing) {
    if (llm.values[key] !== undefined && values[key] === undefined) {
      values[key] = llm.values[key];
      provenance[key] = 'llm';
      llmFilledFields.push(key);
    }
  }

  // Evidence-only constraint (C1): every LLM-sourced field must have its
  // value present in the source text (or be a trivial derivative). The LLM
  // can free-form-complete a confidently-wrong answer; the verifier nulls
  // those out so callers never see hallucinated facts.
  const warnings = [...llm.warnings];
  if (llmFilledFields.length > 0) {
    const sourceText = getSourceText(html);
    const filtered = applyEvidenceFilter({
      values,
      provenance,
      sourceText,
      fields: llmFilledFields,
    });
    if (filtered.rejectedFields.length > 0) {
      warnings.push(
        `evidence-only filter: nulled ${filtered.rejectedFields.length} ` +
          `field(s) the LLM proposed but were not present in source text ` +
          `(${filtered.rejectedFields.join(', ')}).`,
      );
    }
    return { values: filtered.values, provenance, warnings };
  }

  return { values, provenance, warnings };
}

function pickField(fields: Record<string, unknown>, name: string): unknown {
  if (fields[name] !== undefined) return fields[name];
  // Shallow nested — e.g. JSON-LD Product.offers.price
  for (const v of Object.values(fields)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const nested = (v as Record<string, unknown>)[name];
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

// ---------- heuristic helpers (preserved from prior schema.ts) ----------

function findFieldValue(
  doc: Document,
  fieldName: string,
  schema: JsonSchema,
): unknown {
  const normalizedName = fieldName.toLowerCase().replace(/_/g, '-');
  const compactName = fieldName.replace(/_/g, '').toLowerCase();
  const variants = [fieldName, normalizedName, compactName];

  if (schema.type === 'array') {
    return findArrayValues(doc, variants);
  }

  return findSingleValue(doc, variants);
}

function cssEscape(value: string): string {
  return value.replace(/([^\w-])/g, '\\$1');
}

function findSingleValue(doc: Document, variants: string[]): string | undefined {
  for (const name of variants) {
    const byItemprop = doc.querySelector(`[itemprop="${name}"]`);
    if (byItemprop) {
      const text = byItemprop.getAttribute('content') ?? byItemprop.textContent?.trim();
      if (text) return text;
    }

    const byClass = doc.querySelector(`[class*="${name}"]`);
    if (byClass) {
      const text = byClass.textContent?.trim();
      if (text) return text;
    }

    const allWithAria = doc.querySelectorAll('[aria-label]');
    for (const el of allWithAria) {
      const label = el.getAttribute('aria-label')?.toLowerCase().replace(/\s+/g, '-') ?? '';
      if (label === name.toLowerCase()) {
        const text = el.textContent?.trim();
        if (text) return text;
      }
    }

    const byId = doc.querySelector(`#${cssEscape(name)}`);
    if (byId) {
      const text = byId.textContent?.trim();
      if (text) return text;
    }

    const byData = doc.querySelector(`[data-${name}]`);
    if (byData) {
      return byData.getAttribute(`data-${name}`) ?? byData.textContent?.trim() ?? undefined;
    }
  }

  return undefined;
}

function findArrayValues(doc: Document, variants: string[]): string[] | undefined {
  for (const name of variants) {
    const container = doc.querySelector(`[class*="${name}"]`);
    if (container) {
      const items = container.querySelectorAll('li, [class*="item"]');
      if (items.length > 0) {
        return Array.from(items).map((el) => (el.textContent ?? '').trim()).filter(Boolean);
      }
    }

    const singular = name.replace(/s$/, '');
    const elements = doc.querySelectorAll(`[class*="${singular}"]`);
    if (elements.length > 1) {
      return Array.from(elements).map((el) => (el.textContent ?? '').trim()).filter(Boolean);
    }
  }

  return undefined;
}
