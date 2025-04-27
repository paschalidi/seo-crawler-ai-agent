// Blog Humanizer - Uses Claude to make AI-generated content more human-like
// This module takes AI-generated blog posts and enhances them to sound more natural and human-written

import { StringOutputParser } from "@langchain/core/output_parsers";
import { RunnableSequence } from "@langchain/core/runnables";
import { PromptTemplate } from "@langchain/core/prompts";
import { ChatAnthropic } from "@langchain/anthropic";
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables
dotenv.config();

// Type definitions
export interface HumanizerParams {
  writingStyle?: string;
  personalityTraits?: string[];
  avoidPatterns?: string[];
  preserveKeywords?: string[];
  preserveSEO?: boolean;
  preserveStructure?: boolean;
  modelName?: string;
  temperature?: number;
}

// Initialize Claude client
function initializeClaudeClient(modelName?: string, temperature?: number) {
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY || "";

  if (!anthropicApiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set in environment variables");
  }

  // Initialize Claude client with specified or default parameters
  const claude = new ChatAnthropic({
    apiKey: anthropicApiKey,
    model: modelName || "claude-3-7-sonnet-20250219",
    temperature: temperature !== undefined ? temperature : 0.7,
  });

  return claude;
}

/**
 * Humanizes an AI-generated blog post to make it sound more natural and human-written
 * @param blogContent The AI-generated blog content to humanize
 * @param params Additional parameters for the humanization process
 * @returns Humanized blog content
 */
export async function humanizeBlogPost(
  blogContent: string,
  params: HumanizerParams = {},
  debug: boolean = false
): Promise<string> {
  // Extract frontmatter if present
  let frontmatter = "";
  let contentToHumanize = blogContent;

  // Check if the content starts with frontmatter (---)
  if (blogContent.startsWith('---')) {
    const frontmatterEndIndex = blogContent.indexOf('---', 3);
    if (frontmatterEndIndex !== -1) {
      // Extract frontmatter including the closing --- and the following newline
      frontmatter = blogContent.substring(0, frontmatterEndIndex + 3) + '\n\n';
      // Extract the content after frontmatter
      contentToHumanize = blogContent.substring(frontmatterEndIndex + 3).trim();
    }
  }
  // Debug logging function
  const debugLog = (message: string) => {
    if (debug) {
      console.log(`[DEBUG] ${message}`);
    }
  };

  try {
    debugLog("Initializing Claude client for blog humanization");
    const claude = initializeClaudeClient(params.modelName, params.temperature);

    const {
      writingStyle = "conversational yet professional",
      personalityTraits = ["knowledgeable", "approachable", "thoughtful"],
      avoidPatterns = ["excessive use of transition phrases", "repetitive sentence structures", "overuse of passive voice"],
      preserveKeywords = [],
      preserveSEO = true,
      preserveStructure = true
    } = params;

    // Create a prompt for the humanization process
    const humanizePromptTemplate = PromptTemplate.fromTemplate(`
    You are an expert editor who specializes in making AI-generated content sound more natural and human-written.

    Your task is to rewrite the following blog post to make it sound like it was written by a human expert, while preserving the key information, insights, and SEO value.

    WRITING STYLE: ${writingStyle}

    PERSONALITY TRAITS TO INCORPORATE:
    ${personalityTraits.join(", ")}

    PATTERNS TO AVOID (these make text sound AI-generated):
    ${avoidPatterns.join(", ")}

    KEYWORDS TO PRESERVE:
    ${preserveKeywords.join(", ")}

    SPECIAL INSTRUCTIONS:
    ${preserveSEO ? "- Maintain SEO optimization by preserving keywords and semantic relevance" : ""}
    ${preserveStructure ? "- Maintain the overall structure and headings of the original post" : ""}
    - Vary sentence structures and lengths to create a more natural flow
    - Use more natural transitions between ideas
    - Add occasional personal touches or anecdotes where appropriate
    - Include some imperfections that make the writing feel more human
    - Replace generic phrases with more specific, vivid language
    - Ensure the tone is consistent throughout
    - Make sure the content flows naturally and doesn't feel formulaic

    ORIGINAL BLOG POST:
    """
    ${contentToHumanize}
    """

    Please rewrite the entire blog post to sound more human-written while preserving the key information and insights. Return only the rewritten blog post in Markdown format, without any explanations or notes.
    `);

    // Create the humanization chain
    const humanizeChain = RunnableSequence.from([
      humanizePromptTemplate,
      claude,
      new StringOutputParser()
    ]);

    // Humanize the blog post
    debugLog("Starting blog humanization process with Claude");
    console.log("Humanizing blog post with Claude...");
    const humanizedContent = await humanizeChain.invoke({});

    debugLog("Blog humanization completed successfully");
    // Combine frontmatter with humanized content
    return frontmatter + humanizedContent;
  } catch (error) {
    console.error("Error humanizing blog post:", error);
    throw error;
  }
}

/**
 * Humanizes a blog post file and saves the result
 * @param filePath Path to the blog post file
 * @param params Humanization parameters
 * @param debug Enable debug logging
 * @returns Path to the humanized blog post file
 */
export async function humanizeBlogPostFile(
  filePath: string,
  params: HumanizerParams = {},
  debug: boolean = false
): Promise<string> {
  // Debug logging function
  const debugLog = (message: string) => {
    if (debug) {
      console.log(`[DEBUG] ${message}`);
    }
  };

  try {
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      throw new Error(`Blog post file not found: ${filePath}`);
    }

    // Read the blog post content
    debugLog(`Reading blog post from file: ${filePath}`);
    const blogContent = fs.readFileSync(filePath, 'utf8');

    // Humanize the blog post
    debugLog("Starting humanization process");
    const humanizedContent = await humanizeBlogPost(blogContent, params, debug);

    // Note: The humanizeBlogPost function will preserve any frontmatter in the content

    // Create the output file path
    const parsedPath = path.parse(filePath);
    const humanizedFilePath = path.join(
      parsedPath.dir,
      `${parsedPath.name}-humanized${parsedPath.ext}`
    );

    // Save the humanized blog post
    debugLog(`Saving humanized blog post to: ${humanizedFilePath}`);
    fs.writeFileSync(humanizedFilePath, humanizedContent);

    console.log(`Humanized blog post saved to: ${humanizedFilePath}`);
    return humanizedFilePath;
  } catch (error) {
    console.error("Error humanizing blog post file:", error);
    throw error;
  }
}
