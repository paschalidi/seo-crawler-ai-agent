// Image Generator - Creates thumbnail images for blog posts based on content and style preferences
// This module uses OpenAI's DALL-E 3 to generate images that match the blog post content

import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import { applyStyleTemplate, STYLE_TEMPLATE_NAMES } from './image-style-templates';
import * as https from 'https';
import * as dotenv from 'dotenv';
import sharp from 'sharp';
import { StringOutputParser } from "@langchain/core/output_parsers";
import { RunnableSequence } from "@langchain/core/runnables";
import { PromptTemplate } from "@langchain/core/prompts";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

// Load environment variables
dotenv.config();

// Type definitions
export interface ImageGenerationParams {
  prompt?: string;           // Direct prompt for image generation
  style?: string;            // Style of the image (e.g., photorealistic, digital art)
  styleTemplate?: string;    // Name of a style template to apply
  subject?: string;          // Main subject for the style template
  aspectRatio?: '1:1' | '16:9' | '3:2';
  quality?: 'standard' | 'hd';
  size?: 'small' | 'medium' | 'large';
  model?: string;
  outputPath?: string;       // Custom output path
  filename?: string;         // Custom filename
  enhancePrompt?: boolean;   // Whether to enhance the prompt with AI
}

// Available image styles
export const IMAGE_STYLES = [
  'photorealistic',
  'digital art',
  '3D render',
  'watercolor painting',
  'oil painting',
  'pencil sketch',
  'minimalist',
  'isometric',
  'flat design',
  'abstract',
  'vintage',
  'futuristic',
  'cartoon',
  'comic book',
  'cyberpunk',
  'steampunk',
  'vaporwave',
  'custom-template' // Special option for using style templates
];

// Export style template names for CLI
export { STYLE_TEMPLATE_NAMES };

/**
 * Generates a prompt for image creation based on blog post content
 * @param blogContent The blog post content
 * @param style The desired image style
 * @returns A prompt for image generation
 */
async function generateImagePrompt(blogContent: string, style: string): Promise<string> {
  // Initialize Google Generative AI client for prompt generation
  const googleApiKey = process.env.GOOGLE_API_KEY || "";

  if (!googleApiKey) {
    throw new Error("GOOGLE_API_KEY is not set in environment variables");
  }

  const llm = new ChatGoogleGenerativeAI({
    model: "gemini-2.5-pro-exp-03-25",
    temperature: 0.7,
    apiKey: googleApiKey,
  });

  // Create a prompt for generating the image description
  const imagePromptTemplate = PromptTemplate.fromTemplate(`
  You are an expert at creating detailed image prompts for AI image generators.

  I need you to create a detailed prompt for a thumbnail image for a blog post. The prompt should describe a visually appealing image that represents the main theme of the article.

  BLOG POST CONTENT:
  """
  ${blogContent.substring(0, 2000)}
  """

  DESIRED STYLE: ${style}

  REQUIREMENTS:
  - Create a prompt for a single, cohesive image that captures the essence of the blog post
  - The image should be appropriate for a professional business blog
  - Include specific details about composition, colors, and elements to include
  - The prompt should be 2-3 sentences long
  - DO NOT include any text or typography in the image description (no titles, words, or labels)
  - Focus on creating a metaphorical or conceptual image rather than literal text
  - Make sure the image would work well as a thumbnail/featured image

  Return ONLY the image prompt, with no additional explanations, introductions, or quotation marks.
  `);

  // Create the image prompt generation chain
  const imagePromptChain = RunnableSequence.from([
    imagePromptTemplate,
    llm,
    new StringOutputParser()
  ]);

  // Generate the image prompt
  console.log("Generating image prompt...");
  const imagePrompt = await imagePromptChain.invoke({});
  console.log("Image prompt generated:", imagePrompt);

  return imagePrompt;
}

/**
 * Generates an image using OpenAI's DALL-E 3
 * @param prompt The prompt for image generation
 * @param params Additional parameters for image generation
 * @returns Path to the generated image
 */
async function generateImageWithDALLE(prompt: string, params: ImageGenerationParams = {}): Promise<string> {
  const openaiApiKey = process.env.OPENAI_API_KEY || "";

  if (!openaiApiKey) {
    throw new Error("OPENAI_API_KEY is not set in environment variables");
  }

  const openai = new OpenAI({
    apiKey: openaiApiKey,
  });

  // Set default parameters
  const {
    quality = 'standard',
    size = 'medium',
    aspectRatio = '16:9'
  } = params;

  // Map size to actual dimensions
  const sizeMap: Record<string, '1024x1024' | '1792x1024'> = {
    'small': '1024x1024',
    'medium': '1792x1024',
    'large': '1792x1024'
  };

  // Generate the image
  console.log("Generating image with DALL-E 3...");
  const response = await openai.images.generate({
    model: "dall-e-3",
    prompt: prompt,
    n: 1,
    quality: quality,
    size: sizeMap[size] || '1024x1024',
    style: "natural"
  });

  const imageUrl = response.data?.[0]?.url;
  if (!imageUrl) {
    throw new Error("Failed to generate image: No URL returned");
  }

  // Determine the output directory
  let outputDir = path.join(process.cwd(), 'public', 'images', 'blog');
  if (params.outputPath) {
    outputDir = params.outputPath;
  }

  // Create directory if it doesn't exist
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Generate a filename
  let filename;
  if (params.filename) {
    // Use provided filename, ensure it has .png extension
    filename = params.filename.endsWith('.png') ? params.filename : `${params.filename}.png`;
  } else {
    // Generate a filename based on the current timestamp
    const timestamp = new Date().getTime();
    filename = `image-${timestamp}.png`;
  }

  const filePath = path.join(outputDir, filename);

  // Download the image
  console.log("Downloading generated image...");
  await downloadImage(imageUrl, filePath);

  // Resize the image if needed
  if (aspectRatio !== '1:1') {
    await resizeImage(filePath, aspectRatio);
  }

  // Return the relative path if it's in the public directory, otherwise return the full path
  if (outputDir.includes('public')) {
    const publicIndex = outputDir.indexOf('public');
    const relativePath = outputDir.substring(publicIndex + 'public'.length);
    return path.join(relativePath, filename).replace(/\\/g, '/');
  }
  return filePath;
}

/**
 * Downloads an image from a URL
 * @param url The URL of the image
 * @param filePath The path to save the image
 * @returns Promise that resolves when the download is complete
 */
function downloadImage(url: string, filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download image: ${response.statusCode}`));
        return;
      }

      const fileStream = fs.createWriteStream(filePath);
      response.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        resolve();
      });

      fileStream.on('error', (err) => {
        fs.unlink(filePath, () => {}); // Delete the file if there's an error
        reject(err);
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Resizes an image to the specified aspect ratio
 * @param filePath The path to the image
 * @param aspectRatio The desired aspect ratio
 * @returns Promise that resolves when the resize is complete
 */
async function resizeImage(filePath: string, aspectRatio: '16:9' | '3:2'): Promise<void> {
  try {
    const image = sharp(filePath);
    const metadata = await image.metadata();

    if (!metadata.width || !metadata.height) {
      throw new Error("Could not determine image dimensions");
    }

    let width = metadata.width;
    let height = metadata.height;

    // Calculate new dimensions based on aspect ratio
    if (aspectRatio === '16:9') {
      height = Math.round(width * 9 / 16);
    } else if (aspectRatio === '3:2') {
      height = Math.round(width * 2 / 3);
    }

    // Resize the image
    await sharp(filePath)
      .resize(width, height, {
        fit: 'cover',
        position: 'center'
      })
      .toFile(`${filePath}.new.png`);

    // Replace the original file
    fs.unlinkSync(filePath);
    fs.renameSync(`${filePath}.new.png`, filePath);
  } catch (error) {
    console.error("Error resizing image:", error);
    throw error;
  }
}

/**
 * Generates an image based on a direct prompt or blog content
 * @param promptOrContent The direct prompt or blog content
 * @param params Image generation parameters
 * @returns Path to the generated image
 */
export async function generateImage(
  promptOrContent: string,
  params: ImageGenerationParams = {}
): Promise<string> {
  try {
    let finalPrompt = promptOrContent;

    // Check if we're using a style template
    if (params.styleTemplate && STYLE_TEMPLATE_NAMES.includes(params.styleTemplate)) {
      console.log(`Applying style template: ${params.styleTemplate}`);
      const subject = params.subject || "object";
      finalPrompt = applyStyleTemplate(params.styleTemplate, subject);
      console.log("Generated template prompt:", finalPrompt);
    }
    // If enhancePrompt is true and we don't have a direct prompt or style template, generate one
    else if (params.enhancePrompt && !params.prompt && !params.styleTemplate) {
      // Extract the main content if there's frontmatter
      let contentForPrompt = promptOrContent;
      if (promptOrContent.startsWith('---')) {
        const frontmatterEndIndex = promptOrContent.indexOf('---', 3);
        if (frontmatterEndIndex !== -1) {
          contentForPrompt = promptOrContent.substring(frontmatterEndIndex + 3).trim();
        }
      }

      // Generate a prompt for the image
      const style = params.style || 'photorealistic';
      finalPrompt = await generateImagePrompt(contentForPrompt, style);
      console.log("Enhanced prompt:", finalPrompt);
    } else if (params.prompt) {
      // Use the direct prompt if provided
      finalPrompt = params.prompt;
    }

    // Generate the image
    const imagePath = await generateImageWithDALLE(finalPrompt, params);

    console.log(`Image generated successfully: ${imagePath}`);
    return imagePath;
  } catch (error) {
    console.error("Error generating thumbnail image:", error);
    throw error;
  }
}
