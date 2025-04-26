#!/usr/bin/env node

import { Command } from 'commander';
import inquirer from 'inquirer';
import * as fs from 'fs';
import * as path from 'path';
import {
  CompetitorData,
  crawlCompetitorSites,
  processCompetitorData
} from './crawler';
import * as dotenv from 'dotenv';
import { generateBlogPost } from "./agents/blog-writer";

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

// Load tone suggestions from file or use default values
function loadToneSuggestions() {
  try {
    const configPath = './config/tone_suggestions.json';
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (error) {
    console.warn('Could not load tone suggestions, using defaults');
  }

  // Default tone suggestions
  return [
    'professional',
    'conversational',
    'academic',
    'technical',
    'thought leadership',
    'persuasive',
    'educational',
    'inspirational',
    'actionable',
    'analytical'
  ];
}

// Load audience suggestions from file or use default values
function loadAudienceSuggestions() {
  try {
    const configPath = './config/audience_suggestions.json';
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (error) {
    console.warn('Could not load audience suggestions, using defaults');
  }

  // Default audience suggestions
  return [
    'business professionals',
    'small business owners',
    'enterprise decision makers',
    'marketing managers',
    'technical professionals',
    'c-suite executives',
    'startups',
    'general consumers',
    'industry experts'
  ];
}

// Generate blog post command
program
  .command('generate')
  .description('Generate a blog post based on competitor intelligence')
  .option('-d, --debug', 'Enable debug mode to see more detailed logs')
  .option('--save-outline', 'Also save the blog outline separately')
  .option('--model <model>', 'Choose AI model to use (default: "gpt-4-turbo-preview")')
  .option('--temperature <temp>', 'Set creativity level (0.0-1.0, default: 0.7)')
  .option('--focus <focus>', 'Content focus strategy (default: "comprehensive")')
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

    // Load tone and audience suggestions
    const toneSuggestions = loadToneSuggestions();
    const audienceSuggestions = loadAudienceSuggestions();

    // Content focus options
    const focusOptions = [
      { name: 'Comprehensive (balanced coverage)', value: 'comprehensive' },
      { name: 'Competitor Gap Analysis (focus on what others miss)', value: 'gap_analysis' },
      { name: 'Thought Leadership (unique perspective)', value: 'thought_leadership' },
      { name: 'SEO-Optimized (maximize search visibility)', value: 'seo_optimized' },
      { name: 'Action-Oriented (practical steps and guidance)', value: 'actionable' },
      { name: 'Data-Driven (emphasize statistics and research)', value: 'data_driven' }
    ];

    // Format options
    const formatOptions = [
      { name: 'Standard Blog Post', value: 'standard' },
      { name: 'How-To Guide', value: 'how_to' },
      { name: 'Listicle (Top X...)', value: 'listicle' },
      { name: 'Comparison/Analysis', value: 'comparison' },
      { name: 'Case Study', value: 'case_study' },
      { name: 'Thought Leadership', value: 'opinion' }
    ];

    // Get blog post parameters from user
    const answers = await inquirer.prompt([
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
        choices: [...toneSuggestions, new inquirer.Separator(), { name: 'Custom tone (specify)', value: 'custom' }],
        default: 'professional'
      },
      {
        type: 'input',
        name: 'customTone',
        message: 'Enter custom tone description:',
        when: (answers) => answers.tone === 'custom',
        validate: (input: string) => input.trim() !== '' ? true : 'Custom tone cannot be empty'
      },
      {
        type: 'list',
        name: 'audience',
        message: 'Select target audience:',
        choices: [...audienceSuggestions, new inquirer.Separator(), { name: 'Custom audience (specify)', value: 'custom' }],
        default: 'business professionals'
      },
      {
        type: 'input',
        name: 'customAudience',
        message: 'Enter custom audience description:',
        when: (answers) => answers.audience === 'custom',
        validate: (input: string) => input.trim() !== '' ? true : 'Custom audience cannot be empty'
      },
      {
        type: 'list',
        name: 'contentFocus',
        message: 'Select content focus strategy:',
        choices: focusOptions,
        default: options.focus || 'comprehensive'
      },
      {
        type: 'list',
        name: 'contentFormat',
        message: 'Select blog post format:',
        choices: formatOptions,
        default: 'standard'
      },
      {
        type: 'confirm',
        name: 'includeCallToAction',
        message: 'Include strong call-to-action?',
        default: true
      },
      {
        type: 'input',
        name: 'ctaType',
        message: 'What type of call-to-action?',
        when: (answers) => answers.includeCallToAction,
        default: 'Contact us for a free consultation'
      },
      {
        type: 'confirm',
        name: 'includeExamples',
        message: 'Include practical examples?',
        default: true
      },
      {
        type: 'confirm',
        name: 'includeStats',
        message: 'Emphasize data and statistics?',
        default: true
      },
      {
        type: 'list',
        name: 'seoOptimizationLevel',
        message: 'SEO optimization level:',
        choices: [
          { name: 'Light (natural keyword usage)', value: 'light' },
          { name: 'Moderate (strategic keyword placement)', value: 'moderate' },
          { name: 'Aggressive (maximum keyword optimization)', value: 'aggressive' }
        ],
        default: 'moderate'
      }
    ]);

    // Prepare final configuration
    const finalTone = answers.tone === 'custom' ? answers.customTone : answers.tone;
    const finalAudience = answers.audience === 'custom' ? answers.customAudience : answers.audience;

    console.log('\nGenerating blog post... (this may take a few minutes)');

    try {
      // Generate blog post with extended parameters
      const blogPost = await generateBlogPost({
        topic: answers.topic,
        keywords: answers.keywords,
        targetWordCount: answers.targetWordCount,
        tone: finalTone,
        audience: finalAudience,
        contentFocus: answers.contentFocus,
        contentFormat: answers.contentFormat,
        includeCallToAction: answers.includeCallToAction,
        ctaType: answers.ctaType,
        includeExamples: answers.includeExamples,
        includeStats: answers.includeStats,
        seoOptimizationLevel: answers.seoOptimizationLevel,
        saveOutline: options.saveOutline || false,
        modelName: options.model || 'gpt-4-turbo-preview',
        temperature: options.temperature ? parseFloat(options.temperature) : 0.7
      }, debug);

      // Extract blog post content and outline if available
      let postContent: string, outlineContent: string | undefined, wordCount: number | undefined, title: string | undefined;

      if (typeof blogPost === 'string') {
        postContent = blogPost;
      } else if (blogPost && typeof blogPost === 'object') {
        if ('post' in blogPost && typeof blogPost.post === 'string') {
          // Legacy format
          postContent = blogPost.post;
          if ('outline' in blogPost && typeof blogPost.outline === 'string') {
            outlineContent = blogPost.outline;
          }
        } else if ('content' in blogPost && typeof blogPost.content === 'string') {
          // New BlogPostContent format
          postContent = blogPost.content;
          if ('wordCount' in blogPost && typeof blogPost.wordCount === 'number') {
            wordCount = blogPost.wordCount;
          }
          if ('title' in blogPost && typeof blogPost.title === 'string') {
            title = blogPost.title;
          }
        } else {
          throw new Error('Invalid blog post format returned');
        }
      } else {
        throw new Error('Invalid blog post format returned');
      }

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

      fs.writeFileSync(filePath, postContent);

      console.log(`\n✅ Blog post generated successfully!`);
      console.log(`📄 Saved to: ${filePath}`);

      // Display additional information if available
      if (wordCount) {
        console.log(`📊 Word count: ${wordCount} words`);
      }
      if (title) {
        console.log(`📝 Title: ${title}`);
      }

      // Save outline if available and requested
      if (outlineContent && options.saveOutline) {
        const outlineFilePath = path.join(outputDir, `${date}-${sanitizedTopic}-outline.md`);
        fs.writeFileSync(outlineFilePath, outlineContent);
        console.log(`📝 Outline saved to: ${outlineFilePath}`);
      }

      // Print the first few lines of the blog post
      const previewLines = postContent.split('\n').slice(0, 10).join('\n');
      console.log('\nPreview:');
      console.log('-----------------------------------');
      console.log(previewLines);
      console.log('-----------------------------------');
      console.log('... (see the full post in the saved file)');

    } catch (error) {
      console.error('Error generating blog post:', error);
    }
  });

// Command to customize tone suggestions
program
  .command('customize-tones')
  .description('Customize tone suggestions for blog generation')
  .action(async () => {
    const currentTones = loadToneSuggestions();

    console.log('\nCurrent tone suggestions:');
    console.log(currentTones.join(', '));

    const answers = await inquirer.prompt([
      {
        type: 'editor',
        name: 'tones',
        message: 'Edit tone suggestions (one per line):',
        default: currentTones.join('\n'),
        filter: (input: string) => input.split('\n').map(t => t.trim()).filter(t => t !== '')
      }
    ]);

    const configDir = './config';
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    fs.writeFileSync(
      path.join(configDir, 'tone_suggestions.json'),
      JSON.stringify(answers.tones, null, 2)
    );

    console.log('✅ Tone suggestions updated successfully');
  });

// Command to customize audience suggestions
program
  .command('customize-audiences')
  .description('Customize audience suggestions for blog generation')
  .action(async () => {
    const currentAudiences = loadAudienceSuggestions();

    console.log('\nCurrent audience suggestions:');
    console.log(currentAudiences.join(', '));

    const answers = await inquirer.prompt([
      {
        type: 'editor',
        name: 'audiences',
        message: 'Edit audience suggestions (one per line):',
        default: currentAudiences.join('\n'),
        filter: (input: string) => input.split('\n').map(a => a.trim()).filter(a => a !== '')
      }
    ]);

    const configDir = './config';
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    fs.writeFileSync(
      path.join(configDir, 'audience_suggestions.json'),
      JSON.stringify(answers.audiences, null, 2)
    );

    console.log('✅ Audience suggestions updated successfully');
  });

// Run the program
program.parse(process.argv);

// If no arguments, show help
if (process.argv.length <= 2) {
  program.help();
}