// Competitor-Based Blog Post Generator in TypeScript
// Functional implementation (no classes)

import { ApifyClient } from 'apify-client';
import { Document } from "@langchain/core/documents";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { RunnableSequence } from "@langchain/core/runnables";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { CheerioWebBaseLoader } from "@langchain/community/document_loaders/web/cheerio";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { PromptTemplate } from "@langchain/core/prompts";
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

export interface BlogPostParams {
  topic: string;
  keywords?: string[];
  targetWordCount?: number;
  tone?: string;
}

// Global configuration
const PERSIST_DIRECTORY = "./chroma_db";
const COLLECTION_NAME = "competitor_intelligence";

// Initialize clients based on environment variables
function initializeClients() {
  const openaiApiKey = process.env.OPENAI_API_KEY || "";
  const apifyApiKey = process.env.APIFY_API_KEY || "";

  const apifyClient = new ApifyClient({ token: apifyApiKey });
  const embeddings = new OpenAIEmbeddings({ openAIApiKey: openaiApiKey });
  const llm = new ChatOpenAI({
    modelName: "gpt-4o",
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
 * Alternative: Use CheerioWebBaseLoader for sites that don't need complex crawling
 * @param urls Array of URLs to load
 * @returns Array of Documents
 */
export async function loadWebsitesDirectly(urls: string[]): Promise<Document[]> {
  let allDocs: Document[] = [];

  for (const url of urls) {
    try {
      const loader = new CheerioWebBaseLoader(url);
      const docs = await loader.load();
      allDocs = [...allDocs, ...docs];
    } catch (error) {
      console.error(`Error loading ${url}:`, error);
    }
  }

  return allDocs;
}

/**
 * Creates embeddings from the crawled data and stores in vector database
 * @param crawledData Data from crawlers or direct loaders
 */
export async function processCompetitorData(crawledData: Record<string, any>[]): Promise<void> {
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

/**
 * Loads existing vector store if available
 * @returns True if successfully loaded, false otherwise
 */
export async function loadExistingVectorStore(): Promise<Chroma | null> {
  const { embeddings } = initializeClients();

  try {
    if (fs.existsSync(PERSIST_DIRECTORY)) {
      const vectorStore = await Chroma.fromExistingCollection(
        embeddings,
        { collectionName: COLLECTION_NAME, url: "http://localhost:8000" }
      );
      console.log("Loaded existing vector store");
      return vectorStore;
    }
    return null;
  } catch (error) {
    console.error("Error loading existing vector store:", error);
    return null;
  }
}

/**
 * Generates a blog post based on a topic and the competitive intelligence
 * @param blogParams Parameters for the blog post
 * @returns Generated blog post content
 */
export async function generateBlogPost(blogParams: BlogPostParams): Promise<string> {
  const { llm } = initializeClients();

  // Load the vector store
  const vectorStore = await loadExistingVectorStore();
  if (!vectorStore) {
    throw new Error("Vector store not initialized. Process competitor data first.");
  }

  const { topic, keywords = [], targetWordCount = 1500, tone = "professional" } = blogParams;

  // Create a retriever from the vector store
  const retriever = vectorStore.asRetriever({
    k: 10, // Retrieve 10 most relevant chunks
    searchType: "mmr", // Use Maximal Marginal Relevance for diversity
    filter: { source: "competitor_crawl" }
  });

  // Retrieve relevant competitor content
  const relevantDocs = await retriever.getRelevantDocuments(topic);

  // Build context from the retrieved documents
  const competitorContext = relevantDocs.map(doc => {
    return `Source: ${doc.metadata.competitorName}\nTitle: ${doc.metadata.title || 'N/A'}\nContent: ${doc.pageContent}\n---`;
  }).join("\n");

  // Create a prompt for the blog post generation
  const blogPromptTemplate = PromptTemplate.fromTemplate(`
  You are an expert content writer for a high-end digital products agency.

  TASK: Create a comprehensive, engaging, and SEO-optimized blog post on the topic: "${topic}".

  TARGET WORD COUNT: Approximately ${targetWordCount} words.

  DESIRED TONE: ${tone}

  KEYWORDS TO INCLUDE: ${keywords.join(", ")}

  COMPETITIVE INTELLIGENCE CONTEXT:
  Below is content from industry competitors related to this topic. Use this to:
  1. Identify gaps in their content that you can fill
  2. Find unique angles they haven't covered
  3. Understand the depth and style of industry coverage
  4. Ensure your content is more valuable and comprehensive

  ---
  COMPETITOR CONTENT:
  ${competitorContext}
  ---

  INSTRUCTIONS:
  1. Create an attention-grabbing headline
  2. Include an engaging introduction that hooks the reader
  3. Structure the content with clear H2 and H3 headings
  4. Incorporate the keywords naturally
  5. Include practical examples and actionable insights
  6. End with a strong conclusion and call-to-action
  7. Ensure the content is original and not directly copied from competitors
  8. Format the blog post in Markdown

  YOUR BLOG POST:
  `);

  // Create the generation chain
  const blogChain = RunnableSequence.from([
    blogPromptTemplate,
    llm,
    new StringOutputParser()
  ]);

  // Generate the blog post
  const blogPost = await blogChain.invoke({
    topic,
    keywords: keywords.join(", "),
    targetWordCount: targetWordCount.toString(),
    tone,
    competitorContext
  });

  return blogPost;
}

// For backward compatibility with the class-based approach
export class CompetitorIntelligenceSystem {
  constructor(
    private openaiApiKey: string = process.env.OPENAI_API_KEY || "",
    private apifyApiKey: string = process.env.APIFY_API_KEY || ""
  ) {
  }

  async crawlCompetitorSites(competitors: CompetitorData[], customCrawlPatterns?: string[], debug: boolean = false): Promise<Record<string, any>[]> {
    return crawlCompetitorSites(competitors, customCrawlPatterns, debug);
  }

  async loadWebsitesDirectly(urls: string[]): Promise<Document[]> {
    return loadWebsitesDirectly(urls);
  }

  async processCompetitorData(crawledData: Record<string, any>[]): Promise<void> {
    return processCompetitorData(crawledData);
  }

  async loadExistingVectorStore(): Promise<boolean> {
    const vectorStore = await loadExistingVectorStore();
    return vectorStore !== null;
  }

  async generateBlogPost(blogParams: BlogPostParams): Promise<string> {
    return generateBlogPost(blogParams);
  }
}

// Example usage as a script
export async function runExample() {
  // Ensure API keys are set
  if (!process.env.OPENAI_API_KEY || !process.env.APIFY_API_KEY) {
    console.error("Please set OPENAI_API_KEY and APIFY_API_KEY environment variables");
    return;
  }

  // Try to load existing vector store
  const vectorStore = await loadExistingVectorStore();

  if (!vectorStore) {
    // List of competitors to analyze
    const competitors: CompetitorData[] = [
      { url: "https://example-competitor1.com", name: "Competitor One" },
      { url: "https://example-competitor2.com", name: "Competitor Two" }
    ];

    // Crawl competitor sites
    const crawledData = await crawlCompetitorSites(competitors);

    // Process and embed the competitor data
    await processCompetitorData(crawledData);
  }

  // Generate a blog post
  const blogPost = await generateBlogPost({
    topic: "The Future of AI in Digital Product Design",
    keywords: ["AI-driven design", "user experience", "digital transformation"],
    targetWordCount: 1500,
    tone: "thought leadership"
  });

  console.log("Generated Blog Post:");
  console.log(blogPost);

  // Save the blog post to a file
  fs.writeFileSync('generated_blog_post.md', blogPost);
}

// Uncomment to run the example
// runExample().catch(console.error);
