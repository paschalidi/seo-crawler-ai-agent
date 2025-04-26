#!/usr/bin/env node

import { Command } from 'commander';
import inquirer from 'inquirer';
import * as fs from 'fs';
import * as path from 'path';
import {
  CompetitorData,
  crawlCompetitorSites,
  generateBlogPost,
  loadExistingVectorStore,
  processCompetitorData
} from './competitive-blog-generator-ts';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const program = new Command();

program
  .name('blog-generator')
  .description('Generate blog posts based on competitor intelligence')
  .version('1.0.0');

// Command to add competitor
program
  .command('add-competitor')
  .description('Add a competitor to track')
  .action(async () => {
    const answers = await inquirer.prompt<{ name: string, url: string }>([
      {
        type: 'input',
        name: 'name',
        message: 'Enter competitor name:',
        validate: (input: string) => input.trim() !== '' ? true : 'Name cannot be empty'
      },
      {
        type: 'input',
        name: 'url',
        message: 'Enter competitor website URL:',
        validate: (input: string) => {
          try {
            new URL(input);
            return true;
          } catch (e) {
            return 'Please enter a valid URL (including http:// or https://)';
          }
        }
      }
    ]);

    // Load existing competitors or create new array
    let competitors: CompetitorData[] = [];
    const configDir = './config';
    const configPath = path.join(configDir, 'competitors.json');

    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    if (fs.existsSync(configPath)) {
      competitors = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }

    // Add new competitor
    competitors.push({
      name: answers.name,
      url: answers.url
    });

    // Save updated list
    fs.writeFileSync(configPath, JSON.stringify(competitors, null, 2));
    console.log(`Added competitor: ${answers.name} (${answers.url})`);
  });

// Command to list competitors
program
  .command('list-competitors')
  .description('List all tracked competitors')
  .action(() => {
    const configPath = './config/competitors.json';
    if (fs.existsSync(configPath)) {
      const competitors: CompetitorData[] = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      console.log('\nTracked Competitors:');
      console.log('-------------------');
      competitors.forEach((comp, index) => {
        console.log(`${index + 1}. ${comp.name} - ${comp.url}`);
      });
      console.log(`\nTotal: ${competitors.length} competitors`);
    } else {
      console.log('No competitors tracked yet. Use add-competitor command to add one.');
    }
  });

// Command to crawl competitors
program
  .command('crawl')
  .description('Crawl all competitor websites and process the data')
  .option('-p, --patterns <patterns>', 'Comma-separated list of URL patterns to crawl (regex format)')
  .option('-d, --debug', 'Enable debug mode to see more detailed logs')
  .action(async (options) => {
    // Check for API keys
    if (!process.env.OPENAI_API_KEY || !process.env.APIFY_API_KEY) {
      console.error('ERROR: Missing API keys. Please set OPENAI_API_KEY and APIFY_API_KEY in your .env file');
      return;
    }

    // Load competitors
    const configPath = './config/competitors.json';
    if (!fs.existsSync(configPath)) {
      console.error('No competitors found. Use add-competitor command first.');
      return;
    }

    const competitors: CompetitorData[] = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (competitors.length === 0) {
      console.error('No competitors found. Use add-competitor command first.');
      return;
    }

    // Parse custom crawl patterns if provided
    let customCrawlPatterns: string[] | undefined;
    if (options.patterns) {
      // Ensure patterns are properly formatted for regex matching
      customCrawlPatterns = options.patterns.split(',').map((pattern: string) => {
        const trimmedPattern = pattern.trim();
        // If the pattern doesn't start with .* or ^, add .* to match anywhere in URL
        if (!trimmedPattern.startsWith('.*') && !trimmedPattern.startsWith('^')) {
          return `.*${trimmedPattern}`;
        }
        return trimmedPattern;
      });
      console.log(`Using custom crawl patterns: ${customCrawlPatterns?.join(', ')}`);
    } else {
      console.log('Using default blog-related crawl patterns');
    }

    console.log(`Starting crawl of ${competitors.length} competitors...`);

    // Check if debug mode is enabled
    const debug = options.debug || false;
    if (debug) {
      console.log('Debug mode enabled - you will see more detailed logs');
    }

    try {
      // Crawl competitor sites with optional custom patterns and debug flag
      const crawledData = await crawlCompetitorSites(competitors, customCrawlPatterns, debug);
      console.log(`Successfully crawled ${crawledData.length} pages across all competitors.`);

      // Process and embed the competitor data
      await processCompetitorData(crawledData);
      console.log('✅ Competitor data processed and stored in vector database.');
    } catch (error) {
      console.error('Error during crawling or processing:', error);
    }
  });

// Command to generate a blog post
program
  .command('generate-blog')
  .description('Generate a blog post based on competitor intelligence')
  .action(async () => {
    // Check for API keys
    if (!process.env.OPENAI_API_KEY) {
      console.error('ERROR: Missing API key. Please set OPENAI_API_KEY in your .env file');
      return;
    }

    // Try to load existing vector store
    const vectorStore = await loadExistingVectorStore();
    if (!vectorStore) {
      console.error('No competitor data found. Use the crawl command first.');
      return;
    }

    // Get blog post parameters from user
    const answers = await inquirer.prompt<{
      topic: string,
      keywords: string[],
      targetWordCount: number,
      tone: string
    }>([
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
      });

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