// Enhanced Blog Writer - Direct from crawled data with ReAct approach and advanced differentiation
// This module reads crawled data directly from JSON files and generates blog posts using ReAct (Reasoning + Action)
// with advanced competitive analysis, gap detection, and multi-stage generation

import { Document } from "@langchain/core/documents";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { RunnableSequence } from "@langchain/core/runnables";
import { OpenAIEmbeddings } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { PromptTemplate } from "@langchain/core/prompts";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { humanizeBlogPost, HumanizerParams } from "./blog-humanizer";
import { generateImage, ImageGenerationParams } from "./image-generator";
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables
dotenv.config();

// Disable LangChain tracing
process.env.LANGCHAIN_TRACING_V2 = "false";

// Initialize flag to prevent duplicate vector store creation
process.env.BLOG_WRITER_INITIALIZED = process.env.BLOG_WRITER_INITIALIZED || "false";

// Type definitions
export interface BlogPostParams {
  topic: string;
  keywords?: string[];
  targetWordCount?: number;
  tone?: string;
  audience?: string;
  contentFocus?: string;
  contentFormat?: string;
  includeCallToAction?: boolean;
  ctaType?: string;
  includeExamples?: boolean;
  includeStats?: boolean;
  seoOptimizationLevel?: string;
  saveOutline?: boolean;
  modelName?: string;
  temperature?: number;
  // Humanization parameters
  humanize?: boolean;
  humanizeParams?: HumanizerParams;
  // Image generation parameters
  generateImage?: boolean;
  imageParams?: ImageGenerationParams;
  useStyleTemplate?: boolean;
  // Enhanced parameters
  enableMultiStageGeneration?: boolean;
  enableGapAnalysis?: boolean;
  enableUniquenessVerification?: boolean;
  differentiation?: "moderate" | "aggressive" | "balanced";
  // Internal parameters
  _retryAttempt?: boolean;
}

// Interface for crawled items
export interface CrawledItem {
  text?: string;
  metadata?: {
    title?: string;
  };
  url?: string;
}

// Interface for blog post content
export interface BlogPostContent {
  content: string;
  title?: string;
  seoTitle?: string;
  wordCount?: number;
  formattedContent?: string; // Content with frontmatter
  imagePath?: string; // Path to the generated thumbnail image
  // Enhanced attributes
  outlineContent?: string;
  uniquenessScore?: number;
  gapAnalysis?: string;
  entityAnalysis?: EntityAnalysis;
}

// Interface for entity analysis
export interface EntityAnalysis {
  topEntities: [string, number][];
  topBigrams: [string, number][];
  topTrigrams: [string, number][];
  competitorFocus: string[];
  missingPerspectives: string[];
}

// Interface for content clusters
export interface ContentCluster {
  keywords: string[];
  size: number;
  documents: {
    content: string;
    metadata: any;
    score?: number;
  }[];
}

// Global configuration
const CRAWLED_DATA_DIR = "./crawled_data";

// Initialize clients based on environment variables
function initializeClients(modelName?: string, temperature?: number) {
  const openaiApiKey = process.env.OPENAI_API_KEY || "";
  const googleApiKey = process.env.GOOGLE_API_KEY || "";

  if (!googleApiKey) {
    throw new Error("GOOGLE_API_KEY is not set in environment variables");
  }

  // Using OpenAI for embeddings
  const embeddings = new OpenAIEmbeddings({ openAIApiKey: openaiApiKey });

  // Using Gemini for primary content generation
  const llm = new ChatGoogleGenerativeAI({
    model: modelName || "gemini-2.5-pro-exp-03-25", // Using Gemini's most capable model
    temperature: temperature !== undefined ? temperature : 0.7,
    apiKey: googleApiKey,
    maxOutputTokens: 30000 // Increased from 8192 to ensure we can generate complete blog posts
  });

  return { embeddings, llm };
}

/**
 * Reads crawled data from JSON files in the crawled_data directory
 * @returns Array of processed documents
 */
export async function readCrawledData(debug: boolean = false): Promise<Document[]> {
  const documents: Document[] = [];

  // Debug logging function
  const debugLog = (message: string) => {
    if (debug) {
      console.log(`[DEBUG] ${message}`);
    }
  };

  // Check if crawled data directory exists
  if (!fs.existsSync(CRAWLED_DATA_DIR)) {
    console.error(`Crawled data directory ${CRAWLED_DATA_DIR} not found`);
    return documents;
  }

  // Get all JSON files in the directory
  const files = fs.readdirSync(CRAWLED_DATA_DIR)
    .filter(file => file.endsWith('.json'));

  debugLog(`Found ${files.length} JSON files in ${CRAWLED_DATA_DIR}`);

  // Process each file
  for (const file of files) {
    const filePath = path.join(CRAWLED_DATA_DIR, file);
    const competitorName = file.replace('.json', '').replace(/_/g, ' ');

    try {
      // Read and parse the JSON file
      const fileContent = fs.readFileSync(filePath, 'utf8');

      // Skip empty files
      if (fileContent.trim() === '[]' || fileContent.trim() === '{}' || fileContent.trim() === '') {
        debugLog(`Skipping empty file: ${file}`);
        continue;
      }

      const jsonData = JSON.parse(fileContent);

      // Skip if no data
      if (!Array.isArray(jsonData) || jsonData.length === 0) {
        debugLog(`No valid data in file: ${file}`);
        continue;
      }

      debugLog(`Processing ${jsonData.length} items from ${file}`);

      // Extract text content from each item
      jsonData.forEach((item: CrawledItem) => {
        if (item.text) {
          const title = item.metadata?.title || '';
          const url = item.url || '';

          documents.push(
            new Document({
              pageContent: item.text,
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
    } catch (error) {
      console.error(`Error processing file ${file}:`, error);
    }
  }

  debugLog(`Extracted ${documents.length} documents from crawled data`);
  return documents;
}

/**
 * Creates a memory vector store from crawled data
 * @param debug Enable debug logging
 * @returns MemoryVectorStore instance
 */
export async function createVectorStore(debug: boolean = true): Promise<MemoryVectorStore | null> {
  const { embeddings } = initializeClients();

  // Debug logging function
  const debugLog = (message: string) => {
    if (debug) {
      console.log(`[DEBUG] ${message}`);
    }
  };

  try {
    // Read crawled data
    const documents = await readCrawledData(debug);

    if (documents.length === 0) {
      console.error("No documents found in crawled data");
      return null;
    }

    // Split documents into smaller chunks for better embedding
    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200
    });

    const splitDocs = await textSplitter.splitDocuments(documents);
    console.log(`Split ${documents.length} documents into ${splitDocs.length} chunks`);

    // Create in-memory vector store (no persistence)
    debugLog("Creating in-memory vector store");
    const vectorStore = await MemoryVectorStore.fromDocuments(
      splitDocs,
      embeddings
    );

    console.log("Vector store created successfully");
    return vectorStore;
  } catch (error) {
    console.error("Error creating vector store:", error);
    return null;
  }
}

// Global variable to store the vector store instance
let globalVectorStore: MemoryVectorStore | null = null;

/**
 * Calculates cosine similarity between two vectors
 */
function calculateCosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    throw new Error("Vectors must have the same dimensions");
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (normA * normB);
}

/**
 * Extracts entities (important keywords and phrases) from documents
 */
function extractEntities(documents: Document[]): Record<string, number> {
  // Combine all document content
  const allText = documents.map(doc => doc.pageContent).join(" ");

  // Basic tokenization and cleanup
  const tokens = allText
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(token => token.length > 2 && token.length < 20);

  // Count token frequency
  const tokenCount: Record<string, number> = {};
  tokens.forEach(token => {
    tokenCount[token] = (tokenCount[token] || 0) + 1;
  });

  // Filter out common stop words
  const stopWords = ["the", "and", "a", "an", "in", "on", "at", "to", "for", "of", "with", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did", "will", "would", "shall", "should", "may", "might", "must", "can", "could", "this", "that", "these", "those", "they", "them", "their", "i", "you", "he", "she", "it", "we", "us", "our", "your", "his", "her", "its", "not", "but", "or", "if", "then", "else", "when", "which", "who", "what", "where", "how", "why", "from"];

  const entitiesWithoutStopWords: Record<string, number> = {};
  Object.entries(tokenCount).forEach(([token, count]) => {
    if (!stopWords.includes(token) && count > 1) {
      entitiesWithoutStopWords[token] = count;
    }
  });

  // Also extract bi-grams and tri-grams
  const bigrams = extractNgrams(allText, 2);
  const trigrams = extractNgrams(allText, 3);

  // Combine all entities
  return { ...entitiesWithoutStopWords, ...bigrams, ...trigrams };
}

/**
 * Extracts n-grams (phrases of n words) from text
 */
function extractNgrams(text: string, n: number): Record<string, number> {
  const words = text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(token => token.length > 2);

  const ngrams: Record<string, number> = {};

  for (let i = 0; i <= words.length - n; i++) {
    const ngram = words.slice(i, i + n).join(" ");
    if (ngram.length > n * 2) {  // Minimum length check
      ngrams[ngram] = (ngrams[ngram] || 0) + 1;
    }
  }

  // Filter low-frequency ngrams
  const filteredNgrams: Record<string, number> = {};
  Object.entries(ngrams).forEach(([ngram, count]) => {
    if (count > 1) {
      filteredNgrams[ngram] = count;
    }
  });

  return filteredNgrams;
}

/**
 * Enhanced retrieval of competitor content with advanced analysis
 */
async function getEnhancedCompetitorContent(
  topic: string,
  keywords: string[],
  vectorStore: MemoryVectorStore,
  debug: boolean = false
): Promise<{
  context: string,
  structuredData: any,
  entities: Record<string, number>,
  clusters: ContentCluster[],
  entityAnalysis: EntityAnalysis
}> {
  // Debug logging function
  const debugLog = (message: string) => {
    if (debug) {
      console.log(`[DEBUG] ${message}`);
    }
  };

  // Create a retriever with MMR for diversity
  const retrieverOptions: any = {
    k: 20, // Increased from 15 to get more diverse content
    searchType: "mmr", // Use Maximal Marginal Relevance for diversity
    filter: undefined
  };

  // Only add scoreThreshold if we're using a compatible vector store
  // This avoids errors with vector stores that don't support this parameter
  if (vectorStore.embeddings) {
    retrieverOptions.scoreThreshold = 0.5; // Only include documents with similarity above 0.5
  }

  const retriever = vectorStore.asRetriever(retrieverOptions);

  // Retrieve based on topic and keywords
  debugLog(`Retrieving content relevant to topic: ${topic}`);
  const topicDocs = await retriever.getRelevantDocuments(topic);

  // Retrieve based on keywords for more diversity
  let keywordDocs: Document[] = [];
  if (keywords.length > 0) {
    const keywordQuery = keywords.join(" ");
    keywordDocs = await retriever.getRelevantDocuments(keywordQuery);
  }

  // Combine and deduplicate docs
  const docMap = new Map<string, Document>();
  [...topicDocs, ...keywordDocs].forEach(doc => {
    const key = `${doc.metadata.competitorName}-${doc.metadata.title}`;
    if (!docMap.has(key)) {
      docMap.set(key, doc);
    }
  });

  // Convert to array
  const relevantDocs = Array.from(docMap.values());
  debugLog(`Retrieved ${relevantDocs.length} relevant documents`);

  // Apply quality and relevance weighting
  const { embeddings } = initializeClients();
  const topicEmbedding = await embeddings.embedQuery(topic);

  // Add quality scores to documents
  const scoredDocs = await Promise.all(relevantDocs.map(async (doc) => {
    // Get document embedding
    const docEmbedding = await embeddings.embedDocuments([doc.pageContent]);

    // Calculate cosine similarity
    const similarity = calculateCosineSimilarity(topicEmbedding, docEmbedding[0]);

    // Quality heuristics (length, formatting, links, etc.)
    const lengthScore = Math.min(doc.pageContent.length / 2000, 1.0);  // Longer content up to a point
    const hasHeadersScore = /#{2,}\s+\w+/g.test(doc.pageContent) ? 0.3 : 0; // Has subheadings
    const hasLinksScore = /\[([^\]]+)\]\(([^)]+)\)/g.test(doc.pageContent) ? 0.2 : 0; // Has markdown links

    // Calculate final quality score (weighted sum)
    const qualityScore = (0.5 * similarity) + (0.3 * lengthScore) + hasHeadersScore + hasLinksScore;

    return {
      ...doc,
      score: qualityScore
    };
  }));

  // Sort by score in descending order
  scoredDocs.sort((a, b) => (b.score || 0) - (a.score || 0));

  // Take top documents
  const topScoredDocs = scoredDocs.slice(0, 15);

  // Extract entities using NLP techniques
  debugLog("Extracting entities from competitor content");
  const entities = extractEntities(topScoredDocs);

  // Get top entities for analysis
  const topEntities = Object.entries(entities)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50);

  // Get top bi-grams and tri-grams
  const allText = topScoredDocs.map(doc => doc.pageContent).join(" ");
  const bigrams = extractNgrams(allText, 2);
  const trigrams = extractNgrams(allText, 3);

  const topBigrams = Object.entries(bigrams)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30);

  const topTrigrams = Object.entries(trigrams)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  // Perform semantic clustering
  debugLog("Performing semantic clustering of competitor content");

  // Get embeddings for all documents
  const docs = topScoredDocs.map(doc => doc.pageContent);
  const embeddingVectors = await embeddings.embedDocuments(docs);

  // Simple k-means clustering implementation
  const k = Math.min(5, topScoredDocs.length); // Number of clusters

  // Randomly initialize cluster centers
  const clusterCenters: number[][] = [];
  const usedIndices = new Set<number>();

  while (clusterCenters.length < k) {
    const randomIndex = Math.floor(Math.random() * embeddingVectors.length);
    if (!usedIndices.has(randomIndex)) {
      clusterCenters.push(embeddingVectors[randomIndex]);
      usedIndices.add(randomIndex);
    }
  }

  // Assign documents to clusters
  const clusters: ContentCluster[] = Array(k).fill(null).map(() => ({
    documents: [],
    keywords: [],
    size: 0
  }));

  // Assign each document to nearest cluster
  for (let i = 0; i < embeddingVectors.length; i++) {
    const docVector = embeddingVectors[i];
    let minDistance = Infinity;
    let closestClusterIndex = 0;

    for (let j = 0; j < k; j++) {
      const distance = 1 - calculateCosineSimilarity(docVector, clusterCenters[j]);
      if (distance < minDistance) {
        minDistance = distance;
        closestClusterIndex = j;
      }
    }

    clusters[closestClusterIndex].documents.push({
      content: topScoredDocs[i].pageContent,
      metadata: topScoredDocs[i].metadata,
      score: topScoredDocs[i].score
    });
  }

  // Extract common keywords for each cluster
  for (let i = 0; i < k; i++) {
    if (clusters[i].documents.length > 0) {
      const clusterText = clusters[i].documents.map(doc => doc.content).join(" ");
      const clusterEntities = extractEntities([new Document({ pageContent: clusterText })]);
      const topKeywords = Object.entries(clusterEntities)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([keyword]) => keyword);

      clusters[i].keywords = topKeywords;
      clusters[i].size = clusters[i].documents.length;
    }
  }

  // Remove empty clusters
  const nonEmptyClusters = clusters.filter(cluster => cluster.documents.length > 0);

  // Build enhanced context with structure and metadata
  const competitorContext = topScoredDocs.map(doc => {
    const score = doc.score?.toFixed(2) || "N/A";
    return `Source: ${doc.metadata.competitorName}\nTitle: ${doc.metadata.title || 'N/A'}\nRelevance: ${score}\nContent: ${doc.pageContent}\n---`;
  }).join("\n");

  // Create structured data for analysis
  const structuredData = {
    competitors: Array.from(new Set(topScoredDocs.map(doc => doc.metadata.competitorName))),
    topKeywords: topEntities.slice(0, 20),
    contentClusters: nonEmptyClusters,
    competitorDistribution: getCompetitorDistribution(topScoredDocs),
    averageScore: topScoredDocs.reduce((sum, doc) => sum + (doc.score || 0), 0) / topScoredDocs.length
  };

  // Create entity analysis for differentiation
  const entityAnalysis: EntityAnalysis = {
    topEntities: topEntities.slice(0, 20),
    topBigrams: topBigrams.slice(0, 15),
    topTrigrams: topTrigrams.slice(0, 10),
    competitorFocus: nonEmptyClusters.flatMap(cluster => cluster.keywords.slice(0, 3)),
    missingPerspectives: [] // Will be filled by gap analysis
  };

  return {
    context: competitorContext,
    structuredData,
    entities: entities,
    clusters: nonEmptyClusters,
    entityAnalysis
  };
}

/**
 * Get distribution of content by competitor
 */
function getCompetitorDistribution(documents: Document[]): Record<string, number> {
  const distribution: Record<string, number> = {};

  documents.forEach(doc => {
    const competitor = doc.metadata.competitorName || 'Unknown';
    distribution[competitor] = (distribution[competitor] || 0) + 1;
  });

  return distribution;
}

/**
 * Performs gap analysis on competitor content to identify opportunities
 */
async function performGapAnalysis(
  topic: string,
  keywords: string[],
  entities: Record<string, number>,
  clusters: ContentCluster[],
  entityAnalysis: EntityAnalysis,
  debug: boolean = false
): Promise<string> {
  const { llm } = initializeClients();

  // Debug logging function
  const debugLog = (message: string) => {
    if (debug) {
      console.log(`[DEBUG] ${message}`);
    }
  };

  // Format entities and clusters for analysis
  const topEntities = entityAnalysis.topEntities
    .map(([entity, count]) => `"${entity}" (frequency: ${count})`)
    .join(", ");

  const topBigrams = entityAnalysis.topBigrams
    .map(([phrase, count]) => `"${phrase}" (frequency: ${count})`)
    .join(", ");

  const topTrigrams = entityAnalysis.topTrigrams
    .map(([phrase, count]) => `"${phrase}" (frequency: ${count})`)
    .join(", ");

  const clusterInfo = clusters.map((cluster, index) => {
    return `Cluster ${index + 1} (${cluster.size} documents): Keywords: ${cluster.keywords.join(', ')}`;
  }).join("\n");

  // Create a prompt for the gap analysis
  const gapAnalysisPromptTemplate = PromptTemplate.fromTemplate(`
  You are an expert content strategist conducting a gap analysis on competitor content.

  TOPIC: "${topic}"
  KEYWORDS: ${keywords.join(", ")}

  COMPETITIVE LANDSCAPE ANALYSIS:

  Most frequent terms in competitor content:
  ${topEntities}

  Most common phrases (bi-grams):
  ${topBigrams}

  Most common three-word phrases (tri-grams):
  ${topTrigrams}

  Content clusters found:
  ${clusterInfo}

  TASK: Identify content gaps and opportunities based on this analysis. What important perspectives, angles, or subtopics are competitors MISSING? What unique approach could set our content apart?

  Please provide a detailed gap analysis including:
  1. Missing perspectives or angles
  2. Underexplored subtopics
  3. Content types or formats that appear to be missing
  4. Opportunities for contrarian viewpoints
  5. Specific recommendations for differentiation

  Format your analysis in clear sections with bullet points.
  `);

  // Create the gap analysis chain
  const gapAnalysisChain = RunnableSequence.from([
    gapAnalysisPromptTemplate,
    llm,
    new StringOutputParser()
  ]);

  // Generate the gap analysis
  debugLog("Performing gap analysis on competitor content");
  const gapAnalysis = await gapAnalysisChain.invoke({});

  debugLog("Gap analysis completed");

  // Extract missing perspectives from gap analysis for easy reference
  const missingPerspectives: string[] = [];
  const lines = gapAnalysis.split('\n');
  let inMissingSection = false;

  for (const line of lines) {
    if (line.toLowerCase().includes('missing perspective') || line.toLowerCase().includes('underexplored')) {
      inMissingSection = true;
    } else if (inMissingSection && line.trim().startsWith('-')) {
      const perspective = line.trim().substring(1).trim();
      missingPerspectives.push(perspective);
    } else if (inMissingSection && line.trim() === '') {
      inMissingSection = false;
    }
  }

  // Update entity analysis with missing perspectives
  entityAnalysis.missingPerspectives = missingPerspectives;

  return gapAnalysis;
}

/**
 * Generates an enhanced blog outline based on competitive intelligence and gap analysis
 */
async function generateEnhancedOutline(
  topic: string,
  competitorContext: string,
  entityAnalysis: EntityAnalysis,
  structuredData: any,
  gapAnalysis: string,
  blogParams: BlogPostParams,
  debug: boolean = false
): Promise<string> {
  const { llm } = initializeClients(blogParams.modelName, blogParams.temperature);
  const { keywords = [], tone = "professional", audience = "business professionals", differentiation = "balanced" } = blogParams;

  // Debug logging function
  const debugLog = (message: string) => {
    if (debug) {
      console.log(`[DEBUG] ${message}`);
    }
  };

  // Prepare differentiation level instructions
  let differentiationInstructions = "";
  if (differentiation === "aggressive") {
    differentiationInstructions = "Focus heavily on contrarian viewpoints and alternative perspectives that challenge the consensus in competitor content.";
  } else if (differentiation === "moderate") {
    differentiationInstructions = "Maintain a balance between established knowledge and fresh perspectives, with an emphasis on filling content gaps.";
  } else {
    differentiationInstructions = "Ensure a balanced approach that strengthens existing knowledge while adding unique insights where appropriate.";
  }

  // Prepare structured data insights
  const competitorInsights = `
  Top competitors covering this topic: ${structuredData.competitors.join(", ")}

  Most frequent keywords across competitor content:
  ${entityAnalysis.topEntities.slice(0, 10).map(([keyword, count]) => `"${keyword}" (${count})`).join(", ")}

  Common phrases in competitor content:
  ${entityAnalysis.topBigrams.slice(0, 7).map(([phrase, count]) => `"${phrase}" (${count})`).join(", ")}

  Content cluster analysis: ${structuredData.contentClusters.length} distinct topic clusters identified
  `;

  // Extract key missing perspectives and opportunities
  const missingPerspectives = entityAnalysis.missingPerspectives.length > 0
    ? entityAnalysis.missingPerspectives.map(p => `- ${p}`).join('\n')
    : "- Identify unique angles not covered by competitors\n- Find underexplored subtopics\n- Consider contrarian viewpoints";

  // Create a prompt for the outline generation using ReAct with enhanced data
  const outlinePromptTemplate = PromptTemplate.fromTemplate(`
  You are an expert content strategist for a high-end digital products agency.

  TASK: Create a comprehensive outline for a blog post on the topic: "${topic}" that provides unique value compared to competitor content.

  DESIRED TONE: ${tone}
  TARGET AUDIENCE: ${audience}
  KEYWORDS TO INCLUDE: ${keywords.join(", ")}
  DIFFERENTIATION APPROACH: ${differentiationInstructions}

  COMPETITIVE INTELLIGENCE:
  ${competitorInsights}

  GAP ANALYSIS RESULTS:
  ${gapAnalysis.substring(0, 1500)}

  KEY MISSING PERSPECTIVES TO INCORPORATE:
  ${missingPerspectives}

  COMPETITIVE CONTENT SAMPLES:
  ---
  ${competitorContext.substring(0, 2500)}
  ---

  Follow the ReAct (Reasoning + Action) framework to create this outline:

  1. THOUGHT: Analyze the competitive content and gap analysis. What unique angle can we take that competitors are missing?

  2. ACTION: Based on your analysis, identify 5-7 main sections (H2 headings) that would make for a comprehensive blog post while filling identified content gaps.

  3. THOUGHT: For each section, what key points should be covered? What examples, data, or contrarian viewpoints would differentiate this content?

  4. ACTION: Develop 2-4 subsections (H3 headings) under each main section, focusing on providing unique value.

  5. THOUGHT: How can the structure of this post fill the content gaps identified in the analysis?

  6. ACTION: Create an introduction strategy and conclusion approach that positions this content as more valuable than competitor content.

  Now, provide your complete outline following the ReAct framework above. Format your response as follows:

  ## THOUGHT: Analysis of Competitive Content and Gap Opportunities
  [Your detailed analysis here]

  ## ACTION: Main Blog Structure with Differentiation Strategy
  [Your proposed H2 headings with brief explanation of differentiation for each]

  ## THOUGHT: Detailed Section Development
  [Your reasoning for subsections]

  ## ACTION: Subsections with Unique Value Propositions
  [Your proposed H3 headings under each H2]

  ## THOUGHT: Introduction and Conclusion Strategy
  [Your strategy for opening and closing]

  ## ACTION: Final Outline
  [The complete hierarchical outline with H2 and H3 headings]
  `);

  // Create the outline generation chain
  const outlineChain = RunnableSequence.from([
    outlinePromptTemplate,
    llm,
    new StringOutputParser()
  ]);

  // Generate the outline
  debugLog("Generating blog outline with enhanced competitive insights...");
  const outline = await outlineChain.invoke({});

  return outline;
}

/**
 * Generates a full blog post based on the enhanced outline
 */
async function generateEnhancedBlogPost(
  topic: string,
  outline: string,
  competitorContext: string,
  entityAnalysis: EntityAnalysis,
  structuredData: any,
  gapAnalysis: string,
  blogParams: BlogPostParams,
  debug: boolean = false
): Promise<BlogPostContent> {
  const { llm } = initializeClients(blogParams.modelName, blogParams.temperature);
  const { keywords = [], targetWordCount = 2500, tone = "professional", audience = "business professionals", differentiation = "balanced" } = blogParams;

  // Debug logging function
  const debugLog = (message: string) => {
    if (debug) {
      console.log(`[DEBUG] ${message}`);
    }
  };

  // Prepare differentiation level instructions
  let differentiationInstructions = "";
  if (differentiation === "aggressive") {
    differentiationInstructions = "Take strongly contrarian positions compared to competitor content. Challenge the established viewpoints aggressively.";
  } else if (differentiation === "moderate") {
    differentiationInstructions = "Maintain a balance between established knowledge and fresh perspectives, with an emphasis on filling content gaps.";
  } else {
    differentiationInstructions = "Ensure a balanced approach that respects existing knowledge while adding unique insights where appropriate.";
  }

  // Prepare competitive differentiation points
  const differentiationPoints = `
  KEY DIFFERENTIATION OPPORTUNITIES:
  ${entityAnalysis.missingPerspectives.map(p => `- ${p}`).join('\n')}

  COMPETITIVE LANDSCAPE:
  - Most competitors focus on: ${entityAnalysis.topEntities.slice(0, 5).map(([kw]) => `"${kw}"`).join(', ')}
  - Common phrases in competitor content: ${entityAnalysis.topBigrams.slice(0, 3).map(([phrase]) => `"${phrase}"`).join(', ')}
  - Content areas that appear saturated: ${structuredData.contentClusters.map((c: { keywords: any[]; }) => c.keywords[0]).join(', ')}

  DIFFERENTIATION APPROACH: ${differentiationInstructions}
  `;

  // Create a prompt for the blog post generation using ReAct with enhanced data
  const blogPromptTemplate = PromptTemplate.fromTemplate(`
  You are an expert content writer for a high-end digital products agency.

  TASK: Create a comprehensive, engaging, and SEO-optimized blog post on the topic: "${topic}" that is distinctly BETTER and MORE VALUABLE than competitor content.

  CRITICAL REQUIREMENTS:
  1. TARGET WORD COUNT: EXACTLY ${targetWordCount} words (±5%). This is a strict requirement. You MUST adhere to this word count.
  2. COMPLETE BLOG POST: The blog post MUST be complete and not cut off. Ensure you finish all sections and provide a proper conclusion.
  3. VERIFY COMPLETION: Before submitting, verify that your blog post is complete and not truncated in any way.

  DESIRED TONE: ${tone}
  TARGET AUDIENCE: ${audience}
  KEYWORDS TO INCLUDE: ${keywords.join(", ")}

  BLOG OUTLINE:
  ${outline}

  COMPETITIVE DIFFERENTIATION:
  ${differentiationPoints}

  GAP ANALYSIS HIGHLIGHTS:
  ${gapAnalysis.split('\n').filter(line => line.trim().startsWith('-')).slice(0, 10).join('\n')}

  COMPETITIVE CONTENT SAMPLES:
  ---
  ${competitorContext.substring(0, 2000)}
  ---

  Follow the ReAct (Reasoning + Action) framework to write this blog post:

  1. THOUGHT: For the introduction, how can I hook the reader immediately while signaling this content offers unique value?

  2. ACTION: Write a compelling introduction that includes the main keyword naturally and promises insights not found elsewhere.

  3. THOUGHT: For each main section from the outline, what specific insights, examples, or data will make this more valuable than competitor content?

  4. ACTION: Write each section with detailed, actionable content that addresses the gaps identified in competitor content.

  5. THOUGHT: How can I incorporate contrarian viewpoints or fresh perspectives that competitors haven't covered?

  6. ACTION: Include at least 2-3 unique insights or perspectives not found in the competitor content.

  7. THOUGHT: How can I strengthen this content with specific examples, case studies, or data points?

  8. ACTION: Include at least 3-5 concrete examples or data points that competitors haven't mentioned.

  9. THOUGHT: For the conclusion, how can I reinforce the unique value of this content?

  10. ACTION: Write a conclusion with a strong call-to-action that emphasizes the unique insights provided.

  11. THOUGHT: Review the entire post. Does it provide significantly more value than competitor content?

  12. ACTION: Make final refinements to ensure this post stands out as the definitive resource on this topic.

  13. THOUGHT: Verify the word count before finalizing. Is it within ±5% of the target ${targetWordCount} words?

  14. ACTION: Count the words in your draft. If it's not within ±5% of ${targetWordCount} words, add or remove content to meet this requirement exactly.

  15. THOUGHT: Double-check the word count one final time.

  16. ACTION: Confirm the final word count at the end of your process. The word count must be between ${Math.floor(targetWordCount * 0.95)} and ${Math.ceil(targetWordCount * 1.05)} words.

  17. THOUGHT: Verify that the blog post is complete and not cut off.

  18. ACTION: Ensure all sections from the outline are covered and the blog post has a proper conclusion.

  Now, write the complete blog post in Markdown format. Make it comprehensive, engaging, and uniquely valuable compared to competitor content. Include an attention-grabbing headline. Remember to strictly adhere to the target word count of ${targetWordCount} words (±5%) and ensure the blog post is complete with all sections and a proper conclusion.
  `);

  // Create the blog post generation chain
  const blogChain = RunnableSequence.from([
    blogPromptTemplate,
    llm,
    new StringOutputParser()
  ]);

  // Generate the full blog post
  debugLog("Generating full blog post with enhanced differentiation strategy...");
  const blogContent = await blogChain.invoke({});

  // Extract title from the blog post content (assuming it starts with a markdown heading)
  const lines = blogContent.split('\n');
  const title = lines[0].startsWith('# ') ? lines[0].substring(2) : '';

  // Estimate word count
  const wordCount = blogContent.split(/\s+/).length;

  // Verify word count is within acceptable range (±10% of target)
  const minAcceptableWords = Math.floor(targetWordCount * 0.9);
  const maxAcceptableWords = Math.ceil(targetWordCount * 1.1);

  debugLog(`Target word count: ${targetWordCount}, Actual word count: ${wordCount}`);
  debugLog(`Acceptable range: ${minAcceptableWords} to ${maxAcceptableWords}`);

  let finalContent = blogContent;

  // Check if the blog post appears to be truncated
  const isTruncated = detectTruncatedContent(blogContent);

  if (isTruncated) {
    console.warn("WARNING: Blog post appears to be truncated or incomplete.");
    debugLog("Detected potential truncation in the generated content.");

    // If the blog post is too long, try regenerating with a smaller target word count
    if (targetWordCount > 1500 && wordCount < minAcceptableWords) {
      const reducedWordCount = Math.floor(targetWordCount * 0.7); // Reduce by 30%
      debugLog(`Attempting to regenerate with reduced word count: ${reducedWordCount}`);

      // Update the blog parameters with the reduced word count
      const reducedBlogParams = {
        ...blogParams,
        targetWordCount: reducedWordCount
      };

      // Recursively call this function with the reduced word count
      // But only try this once to avoid infinite recursion
      if (!blogParams._retryAttempt) {
        debugLog("Retrying blog generation with reduced word count");
        reducedBlogParams._retryAttempt = true;
        return await generateEnhancedBlogPost(
          topic,
          outline,
          competitorContext,
          entityAnalysis,
          structuredData,
          gapAnalysis,
          reducedBlogParams,
          debug
        );
      }
    }
  }

  // If word count is significantly off target, log a warning
  if (wordCount < minAcceptableWords || wordCount > maxAcceptableWords) {
    console.warn(`WARNING: Generated content word count (${wordCount}) is outside the acceptable range for target ${targetWordCount} words.`);
    debugLog("The model did not adhere to the word count requirement.");
  }

  const blogPost: BlogPostContent = {
    content: finalContent,
    title,
    wordCount,
    outlineContent: outline,
    gapAnalysis,
    entityAnalysis
  };

  return blogPost;
}

/**
 * Verifies the uniqueness of generated content against competitor content
 * @returns A uniqueness score between 0 and 1
 */
async function verifyContentUniqueness(
  generatedContent: string,
  competitorContext: string,
  debug: boolean = false
): Promise<number> {
  const { llm } = initializeClients();

  // Debug logging function
  const debugLog = (message: string) => {
    if (debug) {
      console.log(`[DEBUG] ${message}`);
    }
  };

  // Create a prompt for uniqueness verification
  const uniquenessPromptTemplate = PromptTemplate.fromTemplate(`
  You are an expert content analyst evaluating the uniqueness of a blog post compared to competitor content.

  TASK: Analyze the generated blog post and determine how unique and differentiated it is from competitor content.

  GENERATED BLOG POST:
  ---
  ${generatedContent.substring(0, 4000)}
  ---

  COMPETITOR CONTENT:
  ---
  ${competitorContext.substring(0, 4000)}
  ---

  Please analyze the uniqueness of the generated content on a scale of 0.0 to 1.0:
  - 0.0 means the content is very similar to competitor content with minimal unique value
  - 0.5 means the content has a moderate level of unique insights and perspectives
  - 1.0 means the content is highly differentiated with substantial unique value

  ANALYSIS CRITERIA:
  1. Unique perspectives not found in competitor content
  2. Original examples or case studies
  3. Depth of analysis compared to competitors
  4. Fresh angles or approaches to the topic
  5. Specific actionable advice not found elsewhere

  Format your response as follows:

  ## Uniqueness Analysis
  [Your detailed analysis considering the criteria above]

  ## Uniqueness Score
  [A single number between 0.0 and 1.0]

  Important: The last line of your response should only contain the numerical score (e.g., "0.78") and nothing else.
  `);

  // Create the uniqueness verification chain
  const uniquenessChain = RunnableSequence.from([
    uniquenessPromptTemplate,
    llm,
    new StringOutputParser()
  ]);

  // Analyze uniqueness
  debugLog("Verifying content uniqueness against competitor content...");
  const response = await uniquenessChain.invoke({});

  // Extract the score from the last line
  const lines = response.trim().split('\n');
  const scoreLine = lines[lines.length - 1];
  const scoreMatch = scoreLine.match(/([0-9]\.[0-9]+)/);

  if (scoreMatch && scoreMatch[1]) {
    const score = parseFloat(scoreMatch[1]);
    debugLog(`Content uniqueness score: ${score.toFixed(2)}`);
    return score;
  }

  // Fallback if score extraction fails
  debugLog("Failed to extract uniqueness score, using default 0.7");
  return 0.7;
}

/**
 * Enhances content differentiation if uniqueness score is too low
 */
async function enhanceContentDifferentiation(
  blogPost: BlogPostContent,
  competitorContext: string,
  gapAnalysis: string,
  debug: boolean = false
): Promise<BlogPostContent> {
  const { llm } = initializeClients();

  // Debug logging function
  const debugLog = (message: string) => {
    if (debug) {
      console.log(`[DEBUG] ${message}`);
    }
  };

  // Create a prompt for enhancing content differentiation
  const enhancePromptTemplate = PromptTemplate.fromTemplate(`
  You are an expert content editor specializing in making content more unique and valuable.

  TASK: The following blog post is too similar to competitor content. Enhance it to make it more unique and valuable.

  CURRENT BLOG POST:
  ---
  ${blogPost.content}
  ---

  GAP ANALYSIS (USE THIS TO GUIDE YOUR EDITS):
  ---
  ${gapAnalysis}
  ---

  DIFFERENTIATION INSTRUCTIONS:
  1. ADD at least 3-5 unique insights or perspectives not found in competitor content
  2. INCLUDE specific examples, case studies, or data points that are missing from competitor content
  3. INCORPORATE contrarian viewpoints where appropriate
  4. EXPAND sections that offer unique value not available elsewhere
  5. STRENGTHEN the introduction and conclusion to emphasize unique value
  6. ADD subheadings or sections that cover overlooked aspects of the topic

  IMPORTANT: DO NOT simply rewrite the post. Instead, enhance it by adding unique value while keeping the existing structure and high-quality content. Preserve all markdown formatting.

  Return the complete enhanced blog post in Markdown format.
  `);

  // Create the enhancement chain
  const enhanceChain = RunnableSequence.from([
    enhancePromptTemplate,
    llm,
    new StringOutputParser()
  ]);

  // Enhance the blog post
  debugLog("Enhancing content to increase differentiation...");
  const enhancedContent = await enhanceChain.invoke({});

  // Update the blog post with enhanced content
  return {
    ...blogPost,
    content: enhancedContent,
    wordCount: enhancedContent.split(/\s+/).length
  };
}

/**
 * Generates a short SEO-friendly title based on a topic
 * @param topic The original topic or description
 * @param keywords Keywords to include if possible
 * @returns A short SEO-friendly title (max 60 characters)
 */
async function generateSEOTitle(topic: string, keywords: string[] = [], debug: boolean = false): Promise<string> {
  const { llm } = initializeClients();

  // Debug logging function
  const debugLog = (message: string) => {
    if (debug) {
      console.log(`[DEBUG] ${message}`);
    }
  };

  // Create a prompt for the SEO title generation
  const seoTitlePromptTemplate = PromptTemplate.fromTemplate(`
  You are an SEO expert specializing in creating concise, effective titles for blog posts.

  TASK: Create a short, SEO-friendly title based on this topic description:
  "${topic}"

  KEYWORDS TO INCLUDE IF POSSIBLE: ${keywords.join(", ")}

  REQUIREMENTS:
  - Maximum 60 characters (including spaces)
  - Must be catchy and attention-grabbing
  - Should clearly communicate the main value proposition
  - Include primary keywords naturally if possible
  - Avoid clickbait tactics

  Return ONLY the title, with no quotes, explanations, or additional text.
  `);

  // Create the SEO title generation chain
  const seoTitleChain = RunnableSequence.from([
    seoTitlePromptTemplate,
    llm,
    new StringOutputParser()
  ]);

  // Generate the SEO title
  debugLog("Generating SEO-friendly title...");
  const seoTitle = await seoTitleChain.invoke({});

  // Ensure the title is not too long
  return seoTitle.trim().substring(0, 60);
}

/**
 * Generates frontmatter for the blog post
 * @param title The blog post title
 * @param seoTitle SEO-friendly title
 * @param date Current date in YYYY-MM-DD format
 * @param imagePath Path to the thumbnail image
 * @returns Formatted frontmatter in YAML format
 */
/**
 * Generates an excerpt based on the blog post content
 * @param content The blog post content
 * @returns A short excerpt (150-200 characters)
 */
async function generateExcerpt(content: string, topic: string): Promise<string> {
  const { llm } = initializeClients();

  // Create a prompt for the excerpt generation
  const excerptPromptTemplate = PromptTemplate.fromTemplate(`
  You are an expert content strategist specializing in creating concise, engaging excerpts.

  TASK: Create a brief, compelling excerpt for this blog post:

  TOPIC: "${topic}"

  BLOG POST CONTENT (first portion):
  ${content.substring(0, 3000)}

  REQUIREMENTS:
  - Maximum 150-200 characters (including spaces)
  - Must be engaging and make readers want to click
  - Should clearly communicate the main value proposition
  - Avoid clickbait tactics
  - Write in third person, not addressing the reader directly

  Return ONLY the excerpt, with no quotes or additional text.
  `);

  // Create the excerpt generation chain
  const excerptChain = RunnableSequence.from([
    excerptPromptTemplate,
    llm,
    new StringOutputParser()
  ]);

  // Generate the excerpt
  const excerpt = await excerptChain.invoke({});

  // Ensure the excerpt is not too long
  return excerpt.trim().substring(0, 200);
}

/**
 * Generates frontmatter for the blog post
 * @param title The blog post title
 * @param seoTitle SEO-friendly title
 * @param date Current date in YYYY-MM-DD format
 * @param imagePath Path to the thumbnail image
 * @param content Blog post content for generating excerpt
 * @param topic Original topic
 * @returns Formatted frontmatter in YAML format
 */
async function generateFrontmatter(
  title: string,
  seoTitle: string,
  date: string,
  imagePath: string = '/images/blog/agency-partnership.jpg',
  content: string,
  topic: string
): Promise<string> {
  // Generate a unique excerpt for this post
  const excerpt = await generateExcerpt(content, topic);

  return `---
title: '${title}'
date: '${date}'
excerpt: '${excerpt}'
coverImage: '${imagePath}'
author:
  name: 'Christos Paschalidis'
  picture: '/images/authors/christos-paschalidis.jpg'
---

`;
}

/**
 * Specialized researcher role for deep competitive analysis
 */
async function researcherRole(
  topic: string,
  keywords: string[],
  vectorStore: MemoryVectorStore,
  debug: boolean = false
): Promise<{
  context: string,
  entityAnalysis: EntityAnalysis,
  gapAnalysis: string,
  structuredData: any
}> {
  // Debug logging function
  const debugLog = (message: string) => {
    if (debug) {
      console.log(`[DEBUG] ${message}`);
    }
  };

  debugLog("Researcher role: Performing in-depth competitive analysis");

  // Get enhanced competitor content with advanced analysis
  const {
    context,
    structuredData,
    entities,
    clusters,
    entityAnalysis
  } = await getEnhancedCompetitorContent(topic, keywords, vectorStore, debug);

  // Perform gap analysis to identify opportunities
  const gapAnalysis = await performGapAnalysis(
    topic,
    keywords,
    entities,
    clusters,
    entityAnalysis,
    debug
  );

  return {
    context,
    entityAnalysis,
    gapAnalysis,
    structuredData
  };
}

/**
 * Multi-stage blog generation with specialized roles
 */
async function generateBlogWithMultiStageProcess(
  blogParams: BlogPostParams,
  debug: boolean = false
): Promise<BlogPostContent> {
  const { topic, keywords = [] } = blogParams;

  // Debug logging function
  const debugLog = (message: string) => {
    if (debug) {
      console.log(`[DEBUG] ${message}`);
    }
  };

  // 1. Researcher Role: Analyze competitive landscape
  console.log("Stage 1: Researcher role - Analyzing competitive landscape");
  const {
    context: competitorContext,
    entityAnalysis,
    gapAnalysis,
    structuredData
  } = await researcherRole(topic, keywords, globalVectorStore!, debug);

  // 2. Outliner Role: Create strategic content outline
  console.log("Stage 2: Outliner role - Creating strategic content outline");
  const outline = await generateEnhancedOutline(
    topic,
    competitorContext,
    entityAnalysis,
    structuredData,
    gapAnalysis,
    blogParams,
    debug
  );

  // 3. Writer Role: Generate initial blog post
  console.log("Stage 3: Writer role - Generating initial blog post");
  let blogPost = await generateEnhancedBlogPost(
    topic,
    outline,
    competitorContext,
    entityAnalysis,
    structuredData,
    gapAnalysis,
    blogParams,
    debug
  );

  // 4. Editor Role: Verify uniqueness and enhance if needed
  console.log("Stage 4: Editor role - Verifying content uniqueness");
  if (blogParams.enableUniquenessVerification !== false) {
    const uniquenessScore = await verifyContentUniqueness(
      blogPost.content,
      competitorContext,
      debug
    );

    blogPost.uniquenessScore = uniquenessScore;

    // If uniqueness score is too low, enhance the content
    if (uniquenessScore < 0.75) {
      console.log("Content uniqueness below threshold, enhancing differentiation...");
      blogPost = await enhanceContentDifferentiation(
        blogPost,
        competitorContext,
        gapAnalysis,
        debug
      );

      // Verify again after enhancement if in debug mode
      if (debug) {
        const newUniquenessScore = await verifyContentUniqueness(
          blogPost.content,
          competitorContext,
          debug
        );
        debugLog(`New content uniqueness score: ${newUniquenessScore.toFixed(2)}`);
        blogPost.uniquenessScore = newUniquenessScore;
      }
    }
  }

  // Generate SEO title
  console.log("Generating SEO-friendly title...");
  const seoTitle = await generateSEOTitle(topic, keywords, debug);
  blogPost.seoTitle = seoTitle;

  return blogPost;
}

/**
 * Main blog post generation function with enhanced competitive intelligence
 * @param blogParams Parameters for the blog post
 * @param debug Enable debug logging
 * @returns Generated blog post content
 */
export async function generateBlogPost(blogParams: BlogPostParams, debug: boolean = false): Promise<BlogPostContent> {
  // Debug logging function
  const debugLog = (message: string) => {
    if (debug) {
      console.log(`[DEBUG] ${message}`);
    }
  };

  // Create vector store from crawled data if not already created
  let vectorStore = globalVectorStore;
  if (!vectorStore || process.env.BLOG_WRITER_INITIALIZED === "false") {
    console.log("Creating vector store from crawled data...");
    vectorStore = await createVectorStore(debug);
    globalVectorStore = vectorStore;
    process.env.BLOG_WRITER_INITIALIZED = "true";
  }

  if (!vectorStore) {
    throw new Error("Failed to create vector store from crawled data");
  }

  // Use multi-stage generation process if enabled
  if (blogParams.enableMultiStageGeneration !== false) {
    debugLog("Using multi-stage generation process with specialized roles");
    const blogPost = await generateBlogWithMultiStageProcess(blogParams, debug);

    // Handle optional image generation and humanization
    return await finalizePostProcessing(blogPost, blogParams, debug);
  }

  // ======= Legacy single-stage generation process =======
  const { topic, keywords = [], targetWordCount = 2500, tone = "professional", audience = "business professionals" } = blogParams;

  // Use enhanced competitor content retrieval if gap analysis is enabled
  let competitorContext: string;
  let entityAnalysis: EntityAnalysis | undefined;
  let gapAnalysis: string | undefined;
  let structuredData: any;

  if (blogParams.enableGapAnalysis !== false) {
    // Get enhanced competitor content with advanced analysis
    debugLog("Using enhanced competitor content retrieval with gap analysis");
    const enhancedContent = await getEnhancedCompetitorContent(
      topic,
      keywords,
      vectorStore,
      debug
    );

    competitorContext = enhancedContent.context;
    entityAnalysis = enhancedContent.entityAnalysis;
    structuredData = enhancedContent.structuredData;

    // Perform gap analysis
    gapAnalysis = await performGapAnalysis(
      topic,
      keywords,
      enhancedContent.entities,
      enhancedContent.clusters,
      enhancedContent.entityAnalysis,
      debug
    );
  } else {
    // Use legacy content retrieval
    debugLog("Using legacy competitor content retrieval");
    const retriever = vectorStore.asRetriever({
      k: 15,
      searchType: "mmr"
    });

    // Retrieve relevant competitor content
    const topicDocs = await retriever.getRelevantDocuments(topic);
    let keywordDocs: Document[] = [];
    if (keywords.length > 0) {
      const keywordQuery = keywords.join(" ");
      keywordDocs = await retriever.getRelevantDocuments(keywordQuery);
    }

    // Combine and deduplicate docs
    const docMap = new Map<string, Document>();
    [...topicDocs, ...keywordDocs].forEach(doc => {
      const key = `${doc.metadata.competitorName}-${doc.metadata.title}`;
      if (!docMap.has(key)) {
        docMap.set(key, doc);
      }
    });

    const relevantDocs = Array.from(docMap.values());
    debugLog(`Retrieved ${relevantDocs.length} relevant documents`);

    // Build context from the retrieved documents
    competitorContext = relevantDocs.map(doc => {
      return `Source: ${doc.metadata.competitorName}\nTitle: ${doc.metadata.title || 'N/A'}\nContent: ${doc.pageContent}\n---`;
    }).join("\n");
  }

  // Generate outline
  let outline: string;
  if (entityAnalysis && gapAnalysis) {
    // Use enhanced outline generation
    debugLog("Generating enhanced blog outline");
    outline = await generateEnhancedOutline(
      topic,
      competitorContext,
      entityAnalysis,
      structuredData,
      gapAnalysis,
      blogParams,
      debug
    );
  } else {
    // Use legacy outline generation
    debugLog("Generating legacy blog outline");
    outline = await generateBlogOutline(topic, competitorContext, blogParams);
  }

  if (debug) {
    debugLog("Generated Outline:");
    debugLog(outline.substring(0, 500) + "...");
  }

  // Generate blog post
  let blogPost: BlogPostContent;
  if (entityAnalysis && gapAnalysis) {
    // Use enhanced blog post generation
    debugLog("Generating enhanced blog post");
    blogPost = await generateEnhancedBlogPost(
      topic,
      outline,
      competitorContext,
      entityAnalysis,
      structuredData,
      gapAnalysis,
      blogParams,
      debug
    );
  } else {
    // Use legacy blog post generation
    debugLog("Generating legacy blog post");
    blogPost = await generateFullBlogPost(topic, outline, competitorContext, blogParams);
  }

  // Verify uniqueness if enabled
  if (blogParams.enableUniquenessVerification !== false && entityAnalysis) {
    debugLog("Verifying content uniqueness");
    const uniquenessScore = await verifyContentUniqueness(
      blogPost.content,
      competitorContext,
      debug
    );

    blogPost.uniquenessScore = uniquenessScore;

    // If uniqueness score is too low, enhance the content
    if (uniquenessScore < 0.75 && gapAnalysis) {
      debugLog("Content uniqueness below threshold, enhancing differentiation");
      blogPost = await enhanceContentDifferentiation(
        blogPost,
        competitorContext,
        gapAnalysis,
        debug
      );

      // Verify again after enhancement if in debug mode
      if (debug) {
        const newUniquenessScore = await verifyContentUniqueness(
          blogPost.content,
          competitorContext,
          debug
        );
        debugLog(`New content uniqueness score: ${newUniquenessScore.toFixed(2)}`);
        blogPost.uniquenessScore = newUniquenessScore;
      }
    }
  }

  // Generate SEO title
  debugLog("Generating SEO-friendly title");
  const seoTitle = await generateSEOTitle(topic, keywords, debug);
  blogPost.seoTitle = seoTitle;

  // Handle optional image generation and humanization
  return await finalizePostProcessing(blogPost, blogParams, debug);
}

/**
 * Finalizes post-processing steps like image generation and humanization
 */
async function finalizePostProcessing(
  blogPost: BlogPostContent,
  blogParams: BlogPostParams,
  debug: boolean = false
): Promise<BlogPostContent> {
  // Debug logging function
  const debugLog = (message: string) => {
    if (debug) {
      console.log(`[DEBUG] ${message}`);
    }
  };

  // Generate thumbnail image if requested
  let imagePath = '/images/blog/agency-partnership.jpg'; // Default image path
  if (blogParams.generateImage) {
    console.log("Generating thumbnail image for the blog post...");
    try {
      const imageParams: ImageGenerationParams = {
        ...blogParams.imageParams,
        enhancePrompt: !blogParams.useStyleTemplate,
        styleTemplate: blogParams.useStyleTemplate ? 'glassy-anime-portrait' : undefined,
        subject: blogParams.imageParams?.subject || 'character',
        outputPath: path.join(process.cwd(), 'public', 'images', 'blog')
      };
      imagePath = await generateImage(blogPost.content, imageParams);
      blogPost.imagePath = imagePath;
      debugLog(`Thumbnail image generated: ${imagePath}`);
    } catch (error) {
      console.error("Error generating thumbnail image:", error);
      debugLog("Using default image instead");
    }
  }

  // Add frontmatter to the content
  console.log("Adding frontmatter to the blog post...");
  const date = new Date().toISOString().split('T')[0];
  const title = blogPost.title || blogPost.seoTitle || blogParams.topic;
  blogPost.formattedContent = await generateFrontmatter(title, blogPost.seoTitle || '', date, imagePath, blogPost.content, blogParams.topic) + blogPost.content;

  // Humanize the blog post with Claude if requested
  if (blogParams.humanize) {
    console.log("Humanizing blog post with Claude...");
    try {
      const humanizedContent = await humanizeBlogPost(
        blogPost.content,
        blogParams.humanizeParams || {
          // Default humanization parameters
          writingStyle: blogParams.tone || "conversational yet professional",
          personalityTraits: ["knowledgeable", "approachable", "thoughtful"],
          preserveKeywords: blogParams.keywords || [],
          preserveSEO: true,
          preserveStructure: true
        },
        debug
      );

      // Update the blog post content with the humanized version
      blogPost = {
        ...blogPost,
        content: humanizedContent,
        // Also update the formatted content with frontmatter - regenerate frontmatter for humanized content
        formattedContent: await generateFrontmatter(title, blogPost.seoTitle || '', date, imagePath, humanizedContent, blogParams.topic) + humanizedContent,
        // Recalculate word count
        wordCount: humanizedContent.split(/\s+/).length
      };

      debugLog("Blog post successfully humanized with Claude");
    } catch (error) {
      console.error("Error humanizing blog post with Claude:", error);
      debugLog("Continuing with the original blog post content");
    }
  }

  // Verify the word count matches the target (±5%)
  if (blogPost.wordCount) {
    const { targetWordCount = 2500 } = blogParams;
    const minWordCount = targetWordCount * 0.95;
    const maxWordCount = targetWordCount * 1.05;

    if (blogPost.wordCount < minWordCount || blogPost.wordCount > maxWordCount) {
      debugLog(`Warning: Word count (${blogPost.wordCount}) is outside the target range of ${targetWordCount} words (±5%)`);
    } else {
      debugLog(`Word count (${blogPost.wordCount}) is within target range of ${targetWordCount} words (±5%)`);
    }
  }

  console.log("Blog post generation completed successfully");
  return blogPost;
}

/**
 * Legacy function to generate a blog post outline (kept for backward compatibility)
 */
async function generateBlogOutline(
  topic: string,
  competitorContext: string,
  blogParams: BlogPostParams
): Promise<string> {
  const { llm } = initializeClients(blogParams.modelName, blogParams.temperature);
  const { keywords = [], tone = "professional", audience = "business professionals" } = blogParams;

  // Create a prompt for the outline generation using ReAct
  const outlinePromptTemplate = PromptTemplate.fromTemplate(`
  You are an expert content strategist for a high-end digital products agency.

  TASK: Create a comprehensive outline for a blog post on the topic: "${topic}".

  DESIRED TONE: ${tone}
  TARGET AUDIENCE: ${audience}
  KEYWORDS TO INCLUDE: ${keywords.join(", ")}

  COMPETITIVE INTELLIGENCE CONTEXT:
  Below is content from industry competitors related to this topic:
  ---
  ${competitorContext}
  ---

  Follow the ReAct (Reasoning + Action) framework to create this outline:

  1. THOUGHT: First, analyze the competitive content. What are the common themes? What's missing? What unique angle can we take?

  2. ACTION: Based on your analysis, identify 5-7 main sections (H2 headings) that would make for a comprehensive blog post.

  3. THOUGHT: For each section, what key points should be covered? What examples or data would strengthen each section?

  4. ACTION: Develop 2-4 subsections (H3 headings) under each main section.

  5. THOUGHT: Finally, consider how to open and close the blog post effectively.

  6. ACTION: Create an introduction strategy and conclusion approach.

  Now, provide your complete outline following the ReAct framework above. Format your response as follows:

  ## THOUGHT: Analysis of Competitive Content
  [Your detailed analysis here]

  ## ACTION: Main Blog Structure
  [Your proposed H2 headings with brief explanation of each]

  ## THOUGHT: Detailed Section Development
  [Your reasoning for subsections]

  ## ACTION: Subsections
  [Your proposed H3 headings under each H2]

  ## THOUGHT: Introduction and Conclusion Strategy
  [Your strategy for opening and closing]

  ## ACTION: Final Outline
  [The complete hierarchical outline]
  `);

  // Create the outline generation chain
  const outlineChain = RunnableSequence.from([
    outlinePromptTemplate,
    llm,
    new StringOutputParser()
  ]);

  // Generate the outline
  console.log("Generating blog outline...");
  const outline = await outlineChain.invoke({
    topic,
    keywords: keywords.join(", "),
    tone,
    audience,
    competitorContext
  });

  return outline;
}

/**
 * Legacy function to generate a full blog post (kept for backward compatibility)
 */
async function generateFullBlogPost(
  topic: string,
  outline: string,
  competitorContext: string,
  blogParams: BlogPostParams
): Promise<BlogPostContent> {
  const { llm } = initializeClients(blogParams.modelName, blogParams.temperature);
  const { keywords = [], targetWordCount = 2500, tone = "professional", audience = "business professionals" } = blogParams;

  // Create a prompt for the blog post generation using ReAct
  const blogPromptTemplate = PromptTemplate.fromTemplate(`
  You are an expert content writer for a high-end digital products agency.

  TASK: Create a comprehensive, engaging, and SEO-optimized blog post on the topic: "${topic}".

  CRITICAL REQUIREMENTS:
  1. TARGET WORD COUNT: EXACTLY ${targetWordCount} words (±5%). This is a strict requirement. You MUST adhere to this word count.
  2. COMPLETE BLOG POST: The blog post MUST be complete and not cut off. Ensure you finish all sections and provide a proper conclusion.
  3. VERIFY COMPLETION: Before submitting, verify that your blog post is complete and not truncated in any way.

  DESIRED TONE: ${tone}
  TARGET AUDIENCE: ${audience}
  KEYWORDS TO INCLUDE: ${keywords.join(", ")}

  BLOG OUTLINE:
  ${outline}

  COMPETITIVE INTELLIGENCE CONTEXT:
  Below is content from industry competitors related to this topic:
  ---
  ${competitorContext}
  ---

  Follow the ReAct (Reasoning + Action) framework to write this blog post:

  1. THOUGHT: For the introduction, how can I hook the reader immediately and establish the problem or opportunity?

  2. ACTION: Write a compelling introduction that includes the main keyword naturally.

  3. THOUGHT: For each main section from the outline, what key points, examples, and data will make this more valuable than competitor content?

  4. ACTION: Write each section with detailed, actionable content that goes deeper than competitor material.

  5. THOUGHT: How can I transition smoothly between sections?

  6. ACTION: Create logical transitions between each major section.

  7. THOUGHT: For the conclusion, how can I summarize key points while providing a clear next step?

  8. ACTION: Write a conclusion with a strong call-to-action.

  9. THOUGHT: Review the entire post. Does it meet our goals for SEO, engagement, and depth?

  10. ACTION: Make final refinements to ensure keyword inclusion, readability, and overall value. Include only the blog post never any "Review and Refinement" section at the end.

  11. THOUGHT: Verify the word count before finalizing. Is it within ±5% of the target ${targetWordCount} words?

  12. ACTION: Count the words in your draft. If it's not within ±5% of ${targetWordCount} words, add or remove content to meet this requirement exactly.

  13. THOUGHT: Double-check the word count one final time.

  14. ACTION: Confirm the final word count at the end of your process. The word count must be between ${Math.floor(targetWordCount * 0.95)} and ${Math.ceil(targetWordCount * 1.05)} words.

  15. THOUGHT: Verify that the blog post is complete and not cut off.

  16. ACTION: Ensure all sections from the outline are covered and the blog post has a proper conclusion.

  17. ACTION: The markdown section should never be in any markdown wrapper, all the rest of the tools expect the markdown text to come without any wrapper.

  Now, write the complete blog post in Markdown format. Make it comprehensive, engaging, and uniquely valuable compared to competitor content. Include an attention-grabbing headline. Remember to strictly adhere to the target word count of ${targetWordCount} words (±5%) and ensure the blog post is complete with all sections and a proper conclusion.
  `);

  // Create the blog post generation chain
  const blogChain = RunnableSequence.from([
    blogPromptTemplate,
    llm,
    new StringOutputParser()
  ]);

  // Generate the full blog post
  console.log("Generating full blog post...");
  const blogPost = await blogChain.invoke({
    topic,
    keywords: keywords.join(", "),
    targetWordCount: targetWordCount.toString(),
    tone,
    audience,
    outline,
    competitorContext
  });

  // Extract title from the blog post content (assuming it starts with a markdown heading)
  const lines = blogPost.split('\n');
  const title = lines[0].startsWith('# ') ? lines[0].substring(2) : '';

  // Estimate word count
  const wordCount = blogPost.split(/\s+/).length;

  // Verify word count is within acceptable range (±10% of target)
  const minAcceptableWords = Math.floor(targetWordCount * 0.9);
  const maxAcceptableWords = Math.ceil(targetWordCount * 1.1);

  console.log(`Target word count: ${targetWordCount}, Actual word count: ${wordCount}`);
  console.log(`Acceptable range: ${minAcceptableWords} to ${maxAcceptableWords}`);

  let finalContent = blogPost;

  // Check if the blog post appears to be truncated
  const isTruncated = detectTruncatedContent(blogPost);

  if (isTruncated) {
    console.warn("WARNING: Blog post appears to be truncated or incomplete.");

    // If the blog post is too long, try regenerating with a smaller target word count
    if (targetWordCount > 1500 && wordCount < minAcceptableWords) {
      const reducedWordCount = Math.floor(targetWordCount * 0.7); // Reduce by 30%
      console.log(`Attempting to regenerate with reduced word count: ${reducedWordCount}`);

      // Update the blog parameters with the reduced word count
      const reducedBlogParams = {
        ...blogParams,
        targetWordCount: reducedWordCount
      };

      // Recursively call this function with the reduced word count
      // But only try this once to avoid infinite recursion
      if (!blogParams._retryAttempt) {
        console.log("Retrying blog generation with reduced word count");
        reducedBlogParams._retryAttempt = true;
        return await generateFullBlogPost(
          topic,
          outline,
          competitorContext,
          reducedBlogParams
        );
      }
    }
  }

  // If word count is significantly off target, log a warning
  if (wordCount < minAcceptableWords || wordCount > maxAcceptableWords) {
    console.warn(`WARNING: Generated content word count (${wordCount}) is outside the acceptable range for target ${targetWordCount} words.`);
  }

  return {
    content: finalContent,
    title,
    wordCount
  };
}

/**
 * Example usage function for blog generation
 * @param topic The blog topic
 * @param debug Enable debug mode
 */
export async function generateBlogExample(topic: string, debug: boolean = false): Promise<void> {
  try {
    // Use multi-stage generation with all enhancements enabled
    const blogPost = await generateBlogPost({
      topic,
      keywords: ["digital agency", 'tips', "gotchas", 'first time client', "agency", "digital services"],
      targetWordCount: 2000,
      tone: "professional and sharing tips",
      audience: "small business owners looking for digital services",
      enableMultiStageGeneration: true,
      enableGapAnalysis: true,
      enableUniquenessVerification: true,
      differentiation: "moderate"
    }, debug);

    // Use SEO title for filename if available, otherwise sanitize the topic
    let filenameBase;
    if (blogPost.seoTitle) {
      // Sanitize the SEO title for use in filename
      filenameBase = blogPost.seoTitle
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
      console.log(`Using SEO title for filename: ${blogPost.seoTitle}`);
    } else {
      // Fallback to sanitized topic (but limit length to avoid filename too long error)
      filenameBase = topic
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
        .substring(0, 50); // Limit to 50 chars to avoid filename too long errors
    }

    const date = new Date().toISOString().split('T')[0];
    const outputDir = './generated_posts';

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const filePath = path.join(outputDir, `${date}-${filenameBase}.md`);
    fs.writeFileSync(filePath, blogPost.formattedContent || blogPost.content);

    console.log(`Blog post saved to: ${filePath}`);
    if (blogPost.title) {
      console.log(`Title: ${blogPost.title}`);
    }
    if (blogPost.seoTitle) {
      console.log(`SEO Title: ${blogPost.seoTitle}`);
    }
    if (blogPost.uniquenessScore) {
      console.log(`Uniqueness Score: ${blogPost.uniquenessScore.toFixed(2)}`);
    }
    console.log(`Word Count: ${blogPost.wordCount}`);

    // Save the outline and gap analysis for reference if available
    if (blogPost.outlineContent) {
      const outlineFilePath = path.join(outputDir, `${date}-${filenameBase}-outline.md`);
      fs.writeFileSync(outlineFilePath, blogPost.outlineContent);
      console.log(`Outline saved to: ${outlineFilePath}`);
    }

    if (blogPost.gapAnalysis) {
      const gapAnalysisFilePath = path.join(outputDir, `${date}-${filenameBase}-gap-analysis.md`);
      fs.writeFileSync(gapAnalysisFilePath, blogPost.gapAnalysis);
      console.log(`Gap analysis saved to: ${gapAnalysisFilePath}`);
    }

  } catch (error) {
    console.error("Error generating blog post:", error);
  }
}

/**
 * Detects if a blog post appears to be truncated or incomplete
 * @param content The blog post content to check
 * @returns True if the content appears to be truncated, false otherwise
 */
function detectTruncatedContent(content: string): boolean {
  // Check if the content ends with a conclusion section
  const hasConclusion = /##\s*Conclu(sion|ding|de|sions)/i.test(content);

  // Check if the content has a proper ending (period, exclamation, or question mark followed by newlines or nothing)
  const hasProperEnding = /[.!?]\s*$/.test(content);

  // Check if the content ends abruptly in the middle of a sentence
  const endsAbruptly = /[a-zA-Z],?\s*$/.test(content);

  // Check if the content has a call to action at the end (common in blog conclusions)
  const hasCallToAction = /call\s+to\s+action|next\s+steps|contact\s+us|learn\s+more|get\s+started|sign\s+up|subscribe|follow\s+us/i.test(
    content.split('\n').slice(-10).join('\n') // Check the last 10 lines
  );

  // Check if the content has a proper markdown structure (headers followed by content)
  const sections = content.split(/^##\s+/m).filter(Boolean);
  const lastSection = sections[sections.length - 1] || '';
  const lastSectionIsShort = lastSection.split('\n').length < 3;

  // Combine all checks to determine if the content is likely truncated
  return (endsAbruptly || lastSectionIsShort || (!hasConclusion && !hasCallToAction && !hasProperEnding));
}

// Export additional enhanced functions
export {
  getEnhancedCompetitorContent,
  performGapAnalysis,
  generateEnhancedOutline,
  generateEnhancedBlogPost,
  verifyContentUniqueness,
  enhanceContentDifferentiation,
  generateBlogWithMultiStageProcess,
  detectTruncatedContent
};