// Competitor-Based Blog Post Generator in TypeScript
// Functional implementation (no classes)

import { ApifyClient } from 'apify-client';
import { Document } from "@langchain/core/documents";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { Chroma } from "@langchain/community/vectorstores/chroma";
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables
dotenv.config();

// Type definitions
export interface CompetitorData {
  url: string;
  name: string;
}


const COLLECTION_NAME = "competitor_intelligence";

// Initialize clients based on environment variables
function initializeClients() {
  const openaiApiKey = process.env.OPENAI_API_KEY || "";
  const apifyApiKey = process.env.APIFY_API_KEY || "";

  const apifyClient = new ApifyClient({ token: apifyApiKey });
  const embeddings = new OpenAIEmbeddings({ openAIApiKey: openaiApiKey });
  const llm = new ChatOpenAI({
    model: "gpt-4o",
    temperature: 0.7,
    openAIApiKey: openaiApiKey
  });

  return { apifyClient, embeddings, llm };
}

/**
 * Crawls competitor websites using Apify
 * @param competitors Array of competitor URLs and names
 * @param customCrawlPatterns Optional array of regex patterns to limit crawling to specific URL patterns
 * @param debug Optional flag to enable debug mode
 * @returns JSON data from crawled sites
 */
export async function crawlCompetitorSites(
  competitors: CompetitorData[],
  customCrawlPatterns?: string[],
  debug: boolean = false
): Promise<Record<string, any>[]> {
  const { apifyClient } = initializeClients();
  const results: Record<string, any>[] = [];

  // Debug logging function
  const debugLog = (message: string) => {
    if (debug) {
      console.log(`[DEBUG] ${message}`);
    }
  };

  debugLog('Starting crawl with the following configuration:');
  debugLog(`Custom patterns: ${customCrawlPatterns ? JSON.stringify(customCrawlPatterns) : 'Using defaults'}`);

  for (const competitor of competitors) {
    console.log(`Crawling ${competitor.name} at ${competitor.url}`);

    // Determine which patterns to use
    const patterns = customCrawlPatterns || [
      ".*\/blog.*",
      ".*\/articles.*",
      ".*\/news.*",
      ".*\/insights.*",
      ".*\/resources.*",
      ".*\/designmind.*",
      ".*\/stories.*",
      ".*\/thoughts.*",
      ".*\/thinking.*",
      ".*\/journal.*",
      ".*\/posts.*"
    ];

    debugLog(`Using the following patterns for ${competitor.name}:`);
    patterns.forEach(pattern => debugLog(`- ${pattern}`));

    // Run the Apify crawler with blog-specific configuration
    const run = await apifyClient.actor("apify/website-content-crawler").call({
      startUrls: [{ url: competitor.url }],
      maxCrawlPages: 50, // Limit to 50 pages per site
      maxCrawlDepth: 3,  // Increased depth to better find blog content
      additionalMimeTypes: ["application/json", "text/plain"],

      // Use the patterns we defined above
      crawlPatterns: patterns,

      // Strictly limit crawling to only pages matching these patterns
      limitCrawlPatterns: true,

      // Force respecting the crawl patterns
      skipNavigation: false,
      respectRobotsTxt: false, // Ignore robots.txt to ensure we can crawl all matching patterns

      // Specific link selector to prioritize content links and avoid navigation/utility links
      linkSelector: "a[href]:not([href*='?']):not([href*='#']):not([href*='tel:']):not([href*='mailto:']):not([href*='login']):not([href*='signin']):not([href*='signup']):not([href*='account']):not([href*='cart']):not([href*='checkout'])",

    });
    // Get and process the dataset
    const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems({
      clean: true,
      limit: 999,
    });

    debugLog(`Crawled ${items.length} pages for ${competitor.name}`);

    if (debug && items.length > 0) {
      debugLog('First 5 crawled URLs:');
      items.slice(0, 5).forEach((item: any, index: number) => {
        debugLog(`${index + 1}. ${item.url}`);
      });
    }

    // Add competitor name to each record and save to results
    items.forEach((item: any) => {
      item.competitorName = competitor.name;
      results.push(item);
    });

    // Save raw data for inspection
    const outputDir = './crawled_data';
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir);
    }

    fs.writeFileSync(
      path.join(outputDir, `${competitor.name.replace(/\s+/g, '_')}.json`),
      JSON.stringify(items, null, 2)
    );
  }

  // Final debug summary
  debugLog(`Crawl completed with ${results.length} total pages crawled across all competitors`);
  if (debug && results.length > 0) {
    // Count pages per competitor
    const competitorCounts: Record<string, number> = {};
    results.forEach((item: any) => {
      const name = item.competitorName || 'Unknown';
      competitorCounts[name] = (competitorCounts[name] || 0) + 1;
    });

    debugLog('Pages crawled per competitor:');
    Object.entries(competitorCounts).forEach(([name, count]) => {
      debugLog(`- ${name}: ${count} pages`);
    });
  }

  return results;
}


/**
 * Creates embeddings from the crawled data and stores in vector database
 * @param crawledData Data from crawlers or direct loaders
 */
export interface CrawledDataItem {
  text?: string;
  content?: string;
  title?: string;
  url?: string;
  competitorName?: string;
  metadata?: Record<string, string>;
  [key: string]: any; // Allow for other properties
}

export async function processCompetitorData(crawledData: CrawledDataItem[]): Promise<void> {
  const { embeddings } = initializeClients();

  // Extract text content from the crawled data
  const documents: Document[] = [];

  crawledData.forEach(item => {
    // Extract title and content, handling potential undefined values
    const title = item.title || '';
    const content = item.text || item.content || '';
    const url = item.url || '';
    const competitorName = item.competitorName || 'Unknown';

    if (content) {
      documents.push(
        new Document({
          pageContent: content,
          metadata: {
            title,
            url,
            competitorName,
            source: "competitor_crawl"
          }
        })
      );
    }
  });

  // Split documents into smaller chunks for better embedding
  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200
  });

  const splitDocs = await textSplitter.splitDocuments(documents);
  console.log(`Split ${documents.length} documents into ${splitDocs.length} chunks`);

  // Store in the vector database
  await Chroma.fromDocuments(
    splitDocs,
    embeddings,
    { collectionName: COLLECTION_NAME, url: "http://localhost:8000" }
  );

  console.log("Competitor data processed and stored in vector database");
}


