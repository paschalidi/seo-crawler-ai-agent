#!/usr/bin/env node
// Simple CLI for generating blog posts directly from crawled data

import { Command } from 'commander';
import inquirer from 'inquirer';
import * as fs from 'fs';
import * as path from 'path';
import { generateBlogPost, BlogPostParams } from './blog-writer';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const program = new Command();

program
  .name('blog-cli')
  .description('Generate blog posts from crawled competitor data')
  .version('1.0.0');

// Command to generate a blog post
program
  .command('generate')
  .description('Generate a blog post based on competitor intelligence')
  .option('-d, --debug', 'Enable debug mode to see more detailed logs')
  .action(async (options) => {
    // Prevent duplicate vector store creation
    process.env.BLOG_WRITER_INITIALIZED = 'false';
    // Check for API keys
    if (!process.env.OPENAI_API_KEY) {
      console.error('ERROR: Missing API key. Please set OPENAI_API_KEY in your .env file');
      return;
    }

    // Check if debug mode is enabled
    const debug = options.debug || false;
    if (debug) {
      console.log('Debug mode enabled - you will see more detailed logs');
    }

    // Get blog post parameters from user
    const answers = await inquirer.prompt<{topic: string, keywords: string[], targetWordCount: number, tone: string}>([
      {
        type: 'input',
        name: 'topic',
        message: 'Enter blog post topic:',
        validate: (input: string) => input.trim() !== '' ? true : 'Topic cannot be empty'
      },
      {
        type: 'input',
        name: 'keywords',
        message: 'Enter keywords (comma-separated):',
        filter: (input: string) => input.split(',').map((k: string) => k.trim()).filter((k: string) => k !== '')
      },
      {
        type: 'number',
        name: 'targetWordCount',
        message: 'Target word count:',
        default: 1500
      },
      {
        type: 'list',
        name: 'tone',
        message: 'Select content tone:',
        choices: [
          'professional',
          'conversational',
          'academic',
          'technical',
          'thought leadership',
          'persuasive',
          'educational'
        ],
        default: 'professional'
      }
    ]);

    console.log('\nGenerating blog post... (this may take a few minutes)');

    try {
      // Generate blog post
      const blogPost = await generateBlogPost({
        topic: answers.topic,
        keywords: answers.keywords,
        targetWordCount: answers.targetWordCount,
        tone: answers.tone
      }, debug);

      // Create output directory if it doesn't exist
      const outputDir = './generated_posts';
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // Save to file with sanitized filename
      const sanitizedTopic = answers.topic
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');

      const date = new Date().toISOString().split('T')[0];
      const filePath = path.join(outputDir, `${date}-${sanitizedTopic}.md`);

      fs.writeFileSync(filePath, blogPost);

      console.log(`\n✅ Blog post generated successfully!`);
      console.log(`📄 Saved to: ${filePath}`);

      // Print the first few lines of the blog post
      const previewLines = blogPost.split('\n').slice(0, 10).join('\n');
      console.log('\nPreview:');
      console.log('-----------------------------------');
      console.log(previewLines);
      console.log('-----------------------------------');
      console.log('... (see the full post in the saved file)');

    } catch (error) {
      console.error('Error generating blog post:', error);
    }
  });

// Command to generate a blog post with predefined parameters
program
  .command('quick-generate <topic>')
  .description('Quickly generate a blog post on a specific topic')
  .option('-d, --debug', 'Enable debug mode to see more detailed logs')
  .action(async (topic, options) => {
    // Prevent duplicate vector store creation
    process.env.BLOG_WRITER_INITIALIZED = 'false';
    // Check for API keys
    if (!process.env.OPENAI_API_KEY) {
      console.error('ERROR: Missing API key. Please set OPENAI_API_KEY in your .env file');
      return;
    }

    // Check if debug mode is enabled
    const debug = options.debug || false;
    if (debug) {
      console.log('Debug mode enabled - you will see more detailed logs');
    }

    console.log(`\nGenerating blog post on topic: "${topic}"... (this may take a few minutes)`);

    try {
      // Generate blog post with default parameters
      const blogPost = await generateBlogPost({
        topic,
        keywords: ["digital agency", "web design", "user experience", "innovation"],
        targetWordCount: 1200,
        tone: "professional"
      }, debug);

      // Create output directory if it doesn't exist
      const outputDir = './generated_posts';
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // Save to file with sanitized filename
      const sanitizedTopic = topic
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');

      const date = new Date().toISOString().split('T')[0];
      const filePath = path.join(outputDir, `${date}-${sanitizedTopic}.md`);

      fs.writeFileSync(filePath, blogPost);

      console.log(`\n✅ Blog post generated successfully!`);
      console.log(`📄 Saved to: ${filePath}`);

      // Print the first few lines of the blog post
      const previewLines = blogPost.split('\n').slice(0, 10).join('\n');
      console.log('\nPreview:');
      console.log('-----------------------------------');
      console.log(previewLines);
      console.log('-----------------------------------');
      console.log('... (see the full post in the saved file)');

    } catch (error) {
      console.error('Error generating blog post:', error);
    }
  });

// Run the program
program.parse(process.argv);

// If no arguments, show help
if (process.argv.length <= 2) {
  program.help();
}
