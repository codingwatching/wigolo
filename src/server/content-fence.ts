import type { FetchOutput, CrawlOutput, ExtractOutput } from '../types.js';

/**
 * D7 — fence raw content-tool results returned to the AGENT in the [[UNTRUSTED DATA]] fence (the WIDE
 * boundary, symmetric to R1's synthesis-input fence). Applied at the MCP dispatch envelope ONLY (agent-
 * facing): the REPL/human path uses the handlers directly, and the research/agent pipelines gather via the
 * domain producers + fence at synthesis (R1) — neither reaches here. So the fence is WRAP-ONCE by placement
 * (no double-fence, no human-output pollution); see content-fence.test.ts PIN-A4.
 */

// STUB (D7/A RED): identity — real body-fencing lands in GREEN.
export function fenceFetchData(data: FetchOutput): FetchOutput {
  return data;
}

export function fenceCrawlData(data: CrawlOutput): CrawlOutput {
  return data;
}

export function fenceExtractData(data: ExtractOutput): ExtractOutput {
  return data;
}
