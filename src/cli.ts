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
import { humanizeBlogPostFile } from "./agents/blog-humanizer";
import { IMAGE_STYLES, STYLE_TEMPLATE_NAMES, generateImage } from "./agents/image-generator";
import { applyStyleTemplate } from "./agents/image-style-templates";

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
  .option('--model <model>', 'Choose Gemini model to use (default: "gemini-2.5-pro-exp-03-25")')
  .option('--temperature <temp>', 'Set creativity level (0.0-1.0, default: 0.7)')
  .option('--focus <focus>', 'Content focus strategy (default: "comprehensive")')
  .option('--humanize', 'Apply additional humanization pass to the blog post')
  .option('--humanize-model <model>', 'Choose Claude model for additional humanization (default: "claude-3-7-sonnet-20250219")')
  .option('--humanize-temp <temp>', 'Set humanization creativity level (0.0-1.0, default: 0.7)')
  .option('--generate-image', 'Generate a thumbnail image for the blog post')
  .option('--image-style <style>', 'Specify the style for the generated image')
  .option('--image-aspect <ratio>', 'Set the aspect ratio for the image (1:1, 16:9, 3:2)', '16:9')
  .option('--use-template', 'Use the glassy anime portrait template for image generation (default)')
  .option('--image-subject <subject>', 'Subject for the template image', 'character')
  .option('--image-color <color>', 'Main color for the template image', 'cyan-blue')
  .option('--image-secondary-color <color>', 'Secondary color for the template image', 'pink')
  .option('--image-clothing <description>', 'Clothing description for the template image', 'simple white tank top')
  .action(async (options) => {
    // Prevent duplicate vector store creation
    process.env.BLOG_WRITER_INITIALIZED = 'false';

    // Check for API keys
    if (!process.env.OPENAI_API_KEY) {
      console.error('ERROR: Missing OpenAI API key. Please set OPENAI_API_KEY in your .env file for embeddings and image generation');
      return;
    }

    // Check for Google API key
    if (!process.env.GOOGLE_API_KEY) {
      console.error('ERROR: Missing Google API key. Please set GOOGLE_API_KEY in your .env file for Gemini');
      return;
    }

    // Check for Anthropic API key if humanization is enabled
    if (options.humanize && !process.env.ANTHROPIC_API_KEY) {
      console.error('ERROR: Missing Anthropic API key. Please set ANTHROPIC_API_KEY in your .env file for humanization');
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
      },
      {
        type: 'confirm',
        name: 'humanize',
        message: 'Use Claude to make the blog post more human-like?',
        default: options.humanize || false
      },
      {
        type: 'input',
        name: 'writingStyle',
        message: 'Describe the human writing style to emulate:',
        when: (answers) => answers.humanize,
        default: (answers) => answers.tone === 'custom' ? answers.customTone : answers.tone
      },
      {
        type: 'input',
        name: 'personalityTraits',
        message: 'Enter personality traits to incorporate (comma-separated):',
        when: (answers) => answers.humanize,
        default: 'knowledgeable, approachable, thoughtful',
        filter: (input: string) => input.split(',').map((t: string) => t.trim()).filter((t: string) => t !== '')
      },
      {
        type: 'confirm',
        name: 'generateImage',
        message: 'Generate a thumbnail image for the blog post?',
        default: options.generateImage || false
      },
      {
        type: 'list',
        name: 'imageStyleChoice',
        message: 'Choose a style option:',
        when: (answers) => answers.generateImage,
        choices: [
          { name: 'Use a style template', value: 'template' },
          { name: 'Use a standard style', value: 'standard' }
        ],
        default: 'template'
      },
      {
        type: 'list',
        name: 'imageTemplate',
        message: 'Choose a style template:',
        when: (answers) => answers.generateImage && answers.imageStyleChoice === 'template',
        choices: STYLE_TEMPLATE_NAMES.map(name => ({
          name: name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          value: name
        })),
        default: STYLE_TEMPLATE_NAMES[0]
      },
      {
        type: 'input',
        name: 'imageSubject',
        message: 'What is the main subject for the image?',
        when: (answers) => answers.generateImage,
        default: options.imageSubject || 'object'
      },
      {
        type: 'list',
        name: 'imageStyle',
        message: 'Choose a style:',
        when: (answers) => answers.generateImage && answers.imageStyleChoice === 'standard',
        choices: IMAGE_STYLES,
        default: 'photorealistic'
      },
      {
        type: 'list',
        name: 'imageAspectRatio',
        message: 'Choose the aspect ratio for the thumbnail image:',
        when: (answers) => answers.generateImage,
        choices: [
          { name: 'Widescreen (16:9)', value: '16:9' },
          { name: 'Standard (3:2)', value: '3:2' },
          { name: 'Square (1:1)', value: '1:1' }
        ],
        default: options.imageAspect || '16:9'
      }
    ]);

    // Prepare final configuration
    const finalTone = answers.tone === 'custom' ? answers.customTone : answers.tone;
    const finalAudience = answers.audience === 'custom' ? answers.customAudience : answers.audience;

    console.log('\nGenerating blog post with Gemini... (this may take a few minutes)');

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
        modelName: options.model || 'gemini-2.5-pro-exp-03-25',
        temperature: options.temperature ? parseFloat(options.temperature) : 0.7,
        // Humanization parameters
        humanize: answers.humanize || options.humanize || false,
        humanizeParams: answers.humanize ? {
          writingStyle: answers.writingStyle,
          personalityTraits: answers.personalityTraits,
          preserveKeywords: answers.keywords,
          preserveSEO: true,
          preserveStructure: true,
          modelName: options.humanizeModel || 'claude-3-7-sonnet-20250219',
          temperature: options.humanizeTemp ? parseFloat(options.humanizeTemp) : 0.7
        } : undefined,
        // Image generation parameters
        generateImage: answers.generateImage || options.generateImage || false,
        useStyleTemplate: answers.imageStyleChoice === 'template',
        imageParams: answers.generateImage ? {
          style: answers.imageStyleChoice === 'standard' ? answers.imageStyle : undefined,
          styleTemplate: answers.imageStyleChoice === 'template' ? answers.imageTemplate : undefined,
          subject: answers.imageSubject || options.imageSubject || 'object',
          aspectRatio: answers.imageAspectRatio,
          quality: 'hd',
          size: 'large'
        } : undefined
      }, debug);

      // Extract blog post content and outline if available
      let postContent: string, outlineContent: string | undefined, wordCount: number | undefined, title: string | undefined, seoTitle: string | undefined;

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
          // Use formattedContent (with frontmatter) if available, otherwise use regular content
          postContent = blogPost.formattedContent || blogPost.content;
          if ('wordCount' in blogPost && typeof blogPost.wordCount === 'number') {
            wordCount = blogPost.wordCount;
          }
          if ('title' in blogPost && typeof blogPost.title === 'string') {
            title = blogPost.title;
          }
          if ('seoTitle' in blogPost && typeof blogPost.seoTitle === 'string') {
            seoTitle = blogPost.seoTitle;
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

      // Use SEO title for filename if available, otherwise sanitize the topic
      let filenameBase;
      if (seoTitle) {
        // Sanitize the SEO title for use in filename
        filenameBase = seoTitle
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '');
        console.log(`Using SEO title for filename: ${seoTitle}`);
      } else {
        // Fallback to sanitized topic (but limit length to avoid filename too long error)
        filenameBase = answers.topic
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '')
          .substring(0, 50); // Limit to 50 chars to avoid filename too long errors
      }

      const date = new Date().toISOString().split('T')[0];
      const filePath = path.join(outputDir, `${date}-${filenameBase}.md`);

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
      if (seoTitle) {
        console.log(`🔍 SEO Title: ${seoTitle}`);
      }

      // Save outline if available and requested
      if (outlineContent && options.saveOutline) {
        const outlineFilePath = path.join(outputDir, `${date}-${filenameBase}-outline.md`);
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

// Command to generate an image
program
  .command('generate-image')
  .description('Generate an image using DALL-E 3')
  .option('-p, --prompt <prompt>', 'Direct prompt for image generation')
  .option('-t, --template <template>', 'Style template to use')
  .option('-s, --subject <subject>', 'Main subject for the image', 'object')
  .option('-a, --aspect <ratio>', 'Aspect ratio (1:1, 16:9, 3:2)', '16:9')
  .option('-q, --quality <quality>', 'Image quality (standard, hd)', 'hd')
  .option('-o, --output <path>', 'Output directory for the image')
  .option('-n, --name <filename>', 'Filename for the generated image')
  .option('--debug', 'Enable debug mode to see more detailed logs')
  .action(async (options) => {
    // Check for OpenAI API key
    if (!process.env.OPENAI_API_KEY) {
      console.error('ERROR: Missing OpenAI API key. Please set OPENAI_API_KEY in your .env file');
      return;
    }

    // Check if debug mode is enabled
    const debug = options.debug || false;
    if (debug) {
      console.log('Debug mode enabled - you will see more detailed logs');
    }

    // If no direct prompt is provided, guide the user through the options
    if (!options.prompt) {
      // Ask if they want to use a template or standard style
      const styleChoice = await inquirer.prompt([
        {
          type: 'list',
          name: 'choice',
          message: 'Choose a style option:',
          choices: [
            { name: 'Use a style template', value: 'template' },
            { name: 'Use a standard style', value: 'standard' }
          ],
          default: 'template'
        }
      ]);

      const useTemplate = styleChoice.choice === 'template';

      if (useTemplate) {
        // Ask which template to use
        const templateChoice = await inquirer.prompt([
          {
            type: 'list',
            name: 'template',
            message: 'Choose a style template:',
            choices: STYLE_TEMPLATE_NAMES.map(name => ({
              name: name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
              value: name
            })),
            default: STYLE_TEMPLATE_NAMES[0]
          },
          {
            type: 'input',
            name: 'subject',
            message: 'What is the main subject of the image?',
            default: options.subject || 'object'
          }
        ]);

        options.template = templateChoice.template;
        options.subject = templateChoice.subject;

        // Generate the prompt using the template
        options.prompt = applyStyleTemplate(
          options.template,
          options.subject
        );
      } else {
        // Ask for standard style
        const styleAnswers = await inquirer.prompt([
          {
            type: 'list',
            name: 'style',
            message: 'Choose a style:',
            choices: IMAGE_STYLES,
            default: 'photorealistic'
          },
          {
            type: 'input',
            name: 'subject',
            message: 'What is the main subject of the image?',
            default: options.subject || 'object'
          },
          {
            type: 'input',
            name: 'prompt',
            message: 'Enter additional details for the prompt:',
            default: ''
          }
        ]);

        options.subject = styleAnswers.subject;
        const style = styleAnswers.style;
        const additionalDetails = styleAnswers.prompt;

        // Generate a prompt with the standard style
        options.prompt = `${style} of ${options.subject}${additionalDetails ? ', ' + additionalDetails : ''}, high quality, detailed, 8k resolution`;
      }

      console.log('\nGenerated prompt:');
      console.log('-----------------------------------');
      console.log(options.prompt);
      console.log('-----------------------------------');

      // Ask if user wants to edit the prompt
      const editAnswer = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'editPrompt',
          message: 'Would you like to edit this prompt before generating the image?',
          default: false
        }
      ]);

      if (editAnswer.editPrompt) {
        const finalPromptAnswer = await inquirer.prompt([
          {
            type: 'editor',
            name: 'finalPrompt',
            message: 'Edit the prompt:',
            default: options.prompt
          }
        ]);
        options.prompt = finalPromptAnswer.finalPrompt;
      }
    }

    console.log('\nGenerating image...');
    console.log(`Prompt: ${options.prompt.substring(0, 100)}...`);
    console.log(`Aspect Ratio: ${options.aspect}`);
    console.log(`Quality: ${options.quality}`);

    try {
      // Call the image generation function
      const imagePath = await generateImage(options.prompt, {
        aspectRatio: options.aspect as '1:1' | '16:9' | '3:2',
        quality: options.quality as 'standard' | 'hd',
        size: 'large',
        outputPath: options.output,
        filename: options.name
      });

      console.log(`\n✅ Image generated successfully!`);
      console.log(`📄 Saved to: ${imagePath}`);
    } catch (error) {
      console.error('Error generating image:', error);
    }
  });

// Command to humanize an existing blog post
program
  .command('humanize')
  .description('Use Claude to make an existing blog post more human-like')
  .argument('<file>', 'Path to the blog post file to humanize')
  .option('-d, --debug', 'Enable debug mode to see more detailed logs')
  .option('--model <model>', 'Choose Claude model (default: "claude-3-7-sonnet-20250219")')
  .option('--temperature <temp>', 'Set creativity level (0.0-1.0, default: 0.7)')
  .option('--style <style>', 'Writing style to emulate', 'conversational yet professional')
  .action(async (filePath, options) => {
    // Check for Anthropic API key
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error('ERROR: Missing Anthropic API key. Please set ANTHROPIC_API_KEY in your .env file');
      return;
    }

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      console.error(`ERROR: File not found: ${filePath}`);
      return;
    }

    // Check if debug mode is enabled
    const debug = options.debug || false;
    if (debug) {
      console.log('Debug mode enabled - you will see more detailed logs');
    }

    console.log(`\nHumanizing blog post: ${filePath}`);
    console.log('This may take a few minutes...');

    try {
      // Get personality traits from user
      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'personalityTraits',
          message: 'Enter personality traits to incorporate (comma-separated):',
          default: 'knowledgeable, approachable, thoughtful',
          filter: (input: string) => input.split(',').map((t: string) => t.trim()).filter((t: string) => t !== '')
        },
        {
          type: 'confirm',
          name: 'preserveSEO',
          message: 'Preserve SEO optimization?',
          default: true
        },
        {
          type: 'confirm',
          name: 'preserveStructure',
          message: 'Preserve overall structure and headings?',
          default: true
        }
      ]);

      // Humanize the blog post
      const humanizedFilePath = await humanizeBlogPostFile(
        filePath,
        {
          writingStyle: options.style,
          personalityTraits: answers.personalityTraits,
          preserveSEO: answers.preserveSEO,
          preserveStructure: answers.preserveStructure,
          modelName: options.model || 'claude-3-7-sonnet-20250219',
          temperature: options.temperature ? parseFloat(options.temperature) : 0.7
        },
        debug
      );

      console.log(`\n✅ Blog post humanized successfully!`);
      console.log(`📄 Saved to: ${humanizedFilePath}`);

      // Print a preview of the humanized blog post
      const humanizedContent = fs.readFileSync(humanizedFilePath, 'utf8');
      const previewLines = humanizedContent.split('\n').slice(0, 10).join('\n');
      console.log('\nPreview:');
      console.log('-----------------------------------');
      console.log(previewLines);
      console.log('-----------------------------------');
      console.log('... (see the full post in the saved file)');

    } catch (error) {
      console.error('Error humanizing blog post:', error);
    }
  });

// Run the program
program.parse(process.argv);

// If no arguments, show help
if (process.argv.length <= 2) {
  program.help();
}