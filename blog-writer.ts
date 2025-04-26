// Blog Writer - Direct from crawled data
// This module reads crawled data directly from JSON files and generates blog posts

import { Document } from "@langchain/core/documents";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { RunnableSequence } from "@langchain/core/runnables";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { PromptTemplate } from "@langchain/core/prompts";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
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
}

// Global configuration
const CRAWLED_DATA_DIR = "./crawled_data";

// Initialize clients based on environment variables
function initializeClients() {
  const openaiApiKey = process.env.OPENAI_API_KEY || "";

  const embeddings = new OpenAIEmbeddings({ openAIApiKey: openaiApiKey });
  const llm = new ChatOpenAI({
    modelName: "gpt-3.5-turbo", // Using a simpler model for faster generation
    temperature: 0.7,
    openAIApiKey: openaiApiKey
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
      jsonData.forEach((item: any) => {
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
export async function createVectorStore(debug: boolean = false): Promise<MemoryVectorStore | null> {
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

/**
 * Generates a blog post based on a topic and the competitive intelligence
 * @param blogParams Parameters for the blog post
 * @param debug Enable debug logging
 * @returns Generated blog post content
 */
// Global variable to store the vector store instance
let globalVectorStore: MemoryVectorStore | null = null;

export async function generateBlogPost(blogParams: BlogPostParams, debug: boolean = false): Promise<string> {
  const { llm } = initializeClients();

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

  const { topic, keywords = [], targetWordCount = 1500, tone = "professional" } = blogParams;

  // Create a retriever from the vector store
  const retriever = vectorStore.asRetriever({
    k: 10, // Retrieve 10 most relevant chunks
    searchType: "mmr" // Use Maximal Marginal Relevance for diversity
  });

  // Retrieve relevant competitor content
  debugLog(`Retrieving content relevant to topic: ${topic}`);
  const relevantDocs = await retriever.getRelevantDocuments(topic);

  debugLog(`Retrieved ${relevantDocs.length} relevant documents`);
  if (debug && relevantDocs.length > 0) {
    debugLog("First 3 relevant documents:");
    relevantDocs.slice(0, 3).forEach((doc, i) => {
      debugLog(`${i+1}. From ${doc.metadata.competitorName}: ${doc.metadata.title || 'No title'}`);
      debugLog(`   First 100 chars: ${doc.pageContent.substring(0, 100)}...`);
    });
  }

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
  console.log("Generating blog post...");
  const blogPost = await blogChain.invoke({
    topic,
    keywords: keywords.join(", "),
    targetWordCount: targetWordCount.toString(),
    tone,
    competitorContext
  });

  console.log("Blog post generated successfully");
  return blogPost;
}

// Example usage
export async function generateBlogExample(topic: string, debug: boolean = false): Promise<void> {
  try {
    const blogPost = await generateBlogPost({
      topic,
      keywords: ["digital agency", "web design", "user experience", "innovation"],
      targetWordCount: 1200,
      tone: "professional"
    }, debug);

    // Save the blog post to a file
    const sanitizedTopic = topic
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    const date = new Date().toISOString().split('T')[0];
    const outputDir = './generated_posts';

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const filePath = path.join(outputDir, `${date}-${sanitizedTopic}.md`);
    fs.writeFileSync(filePath, blogPost);

    console.log(`Blog post saved to: ${filePath}`);
  } catch (error) {
    console.error("Error generating blog post:", error);
  }
}

// Uncomment to run the example
generateBlogExample("The Future of Digital Design", true).catch(console.error);
