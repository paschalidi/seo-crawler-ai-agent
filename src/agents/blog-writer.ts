// Blog Writer - Direct from crawled data with ReAct approach
// This module reads crawled data directly from JSON files and generates blog posts using ReAct (Reasoning + Action)

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
  audience?: string; // Added audience parameter
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
}

// Global configuration
const CRAWLED_DATA_DIR = "./crawled_data";

// Initialize clients based on environment variables
function initializeClients() {
  const openaiApiKey = process.env.OPENAI_API_KEY || "";
  const googleApiKey = process.env.GOOGLE_API_KEY || "";

  if (!googleApiKey) {
    throw new Error("GOOGLE_API_KEY is not set in environment variables");
  }

  // Still using OpenAI for embeddings as Gemini doesn't provide embedding API
  const embeddings = new OpenAIEmbeddings({ openAIApiKey: openaiApiKey });

  // Using Gemini for primary content generation
  const llm = new ChatGoogleGenerativeAI({
    model: "gemini-2.5-pro-exp-03-25", // Using Gemini's most capable model for blog generation
    temperature: 0.7,
    apiKey: googleApiKey,
    maxOutputTokens: 8192 // Ensure we can generate long blog posts
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

// Global variable to store the vector store instance
let globalVectorStore: MemoryVectorStore | null = null;

/**
 * Generates a blog post outline based on competitive intelligence
 * @param topic Blog topic
 * @param competitorContext Context from competitors
 * @param blogParams Additional blog parameters
 * @returns Blog outline
 */
async function generateBlogOutline(
  topic: string,
  competitorContext: string,
  blogParams: BlogPostParams
): Promise<string> {
  const { llm } = initializeClients();
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
 * Generates a full blog post based on the outline
 * @param topic Blog topic
 * @param outline Blog outline
 * @param competitorContext Context from competitors
 * @param blogParams Additional blog parameters
 * @returns Complete blog post content
 */
async function generateFullBlogPost(
  topic: string,
  outline: string,
  competitorContext: string,
  blogParams: BlogPostParams
): Promise<BlogPostContent> {
  const { llm } = initializeClients();
  const { keywords = [], targetWordCount = 2500, tone = "professional", audience = "business professionals" } = blogParams;

  // Create a prompt for the blog post generation using ReAct
  const blogPromptTemplate = PromptTemplate.fromTemplate(`
  You are an expert content writer for a high-end digital products agency.

  TASK: Create a comprehensive, engaging, and SEO-optimized blog post on the topic: "${topic}".

  TARGET WORD COUNT: Approximately ${targetWordCount} words.
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

  11. ACTION: The markdown section should never be in any markdown wrapper, all the rest of the tools expect the markdown text to come without any wrapper.

  Now, write the complete blog post in Markdown format. Make it comprehensive, engaging, and uniquely valuable compared to competitor content. Include an attention-grabbing headline.
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

  return {
    content: blogPost,
    title,
    wordCount
  };
}

/**
 * Generates frontmatter for the blog post
 * @param title The blog post title
 * @param seoTitle SEO-friendly title
 * @param date Current date in YYYY-MM-DD format
 * @param imagePath Path to the thumbnail image
 * @returns Formatted frontmatter in YAML format
 */
function generateFrontmatter(title: string, seoTitle: string, date: string, imagePath: string = '/images/blog/agency-partnership.jpg'): string {
  return `---
title: '${title}'
date: '${date}'
excerpt: 'Navigate the complex landscape of digital agencies to find partners that deliver exceptional quality without breaking the bank.'
coverImage: '${imagePath}'
author:
  name: 'Christos Paschalidis'
  picture: '/images/authors/christos-paschalidis.jpg'
---

`;
}

/**
 * Generates a short SEO-friendly title based on a topic
 * @param topic The original topic or description
 * @param keywords Keywords to include if possible
 * @returns A short SEO-friendly title (max 60 characters)
 */
async function generateSEOTitle(topic: string, keywords: string[] = []): Promise<string> {
  const { llm } = initializeClients();

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
  console.log("Generating SEO-friendly title...");
  const seoTitle = await seoTitleChain.invoke({
    topic,
    keywords: keywords.join(", ")
  });

  // Ensure the title is not too long
  return seoTitle.trim().substring(0, 60);
}

/**
 * Generates a blog post based on a topic and competitive intelligence using ReAct approach
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

  const { topic, keywords = [], targetWordCount = 2500, tone = "professional", audience = "business professionals" } = blogParams;

  // Create a retriever from the vector store
  const retriever = vectorStore.asRetriever({
    k: 15, // Increased from 10 to get more diverse content
    searchType: "mmr" // Use Maximal Marginal Relevance for diversity
  });

  // Retrieve relevant competitor content
  debugLog(`Retrieving content relevant to topic: ${topic}`);

  // First retrieve based on topic
  const topicDocs = await retriever.getRelevantDocuments(topic);

  // Then retrieve based on keywords for more diversity
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

  // 1. Generate outline using ReAct approach
  console.log("Step 1: Generating blog outline using ReAct approach...");
  const outline = await generateBlogOutline(topic, competitorContext, blogParams);

  if (debug) {
    debugLog("Generated Outline:");
    debugLog(outline.substring(0, 500) + "...");
  }

  // 2. Generate full blog post based on the outline
  console.log("Step 2: Generating full blog post based on outline...");
  let blogPost = await generateFullBlogPost(topic, outline, competitorContext, blogParams);

  // 2.5. Generate a short SEO-friendly title for the filename
  console.log("Generating SEO-friendly title for filename...");
  const seoTitle = await generateSEOTitle(topic, keywords);
  blogPost.seoTitle = seoTitle;

  // 2.6. Generate thumbnail image if requested
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
      console.log(`Thumbnail image generated: ${imagePath}`);
    } catch (error) {
      console.error("Error generating thumbnail image:", error);
      console.log("Using default image instead");
    }
  }

  // 2.7. Add frontmatter to the content
  console.log("Adding frontmatter to the blog post...");
  const date = new Date().toISOString().split('T')[0];
  const title = blogPost.title || seoTitle || topic;
  const frontmatter = generateFrontmatter(title, seoTitle, date, imagePath);
  blogPost.formattedContent = frontmatter + blogPost.content;

  // 3. Humanize the blog post with Claude if requested
  if (blogParams.humanize) {
    console.log("Step 3: Humanizing blog post with Claude...");
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
        // Also update the formatted content with frontmatter
        formattedContent: frontmatter + humanizedContent,
        // Recalculate word count
        wordCount: humanizedContent.split(/\s+/).length
      };

      console.log("Blog post successfully humanized with Claude");
    } catch (error) {
      console.error("Error humanizing blog post with Claude:", error);
      console.log("Continuing with the original blog post content");
    }
  }

  console.log("Blog post generation completed successfully");
  return blogPost;
}

// Example usage
export async function generateBlogExample(topic: string, debug: boolean = false): Promise<void> {
  try {
    const blogPost = await generateBlogPost({
      topic,
      keywords: ["digital agency", 'tips', "gotchas", 'first time client', "agency", "digital services"],
      targetWordCount: 2000,
      tone: "professional and sharing tips",
      audience: "small business owners looking for digital services"
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
    fs.writeFileSync(filePath, blogPost.content);

    console.log(`Blog post saved to: ${filePath}`);
    if (blogPost.title) {
      console.log(`Title: ${blogPost.title}`);
    }
    if (blogPost.seoTitle) {
      console.log(`SEO Title: ${blogPost.seoTitle}`);
    }

    // Optional: Also save the outline for reference
    // const outlineFilePath = path.join(outputDir, `${date}-${filenameBase}-outline.md`);
    // You would need to modify the code to return the outline separately to enable this feature

  } catch (error) {
    console.error("Error generating blog post:", error);
  }
}

// Uncomment to run the example
// generateBlogExample("Best AI tools used by digital agencies today for lead generation", true).catch(console.error);