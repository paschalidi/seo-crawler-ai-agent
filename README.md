# Competitor Intelligence Blog Generator - Setup Guide

This tool helps your digital agency generate high-quality blog posts based on competitive intelligence. It crawls competitor websites, analyzes their content, and generates unique blog posts on topics you specify.

## Prerequisites

- Node.js (v16 or newer)
- An OpenAI API key
- An Apify API key

## Installation

1. **Clone or download the project files**

2. **Install dependencies**
   ```bash
   npm install langchain @langchain/openai chromadb apify-client dotenv commander inquirer
   ```

3. **Configure environment variables**

   Create a `.env` file in the project root:
   ```
   OPENAI_API_KEY=your_openai_api_key_here
   APIFY_API_KEY=your_apify_api_key_here
   ```

4. **Compile TypeScript**
   ```bash
   npx tsc
   ```

## Usage

The tool comes with a command-line interface to make it easy to use:

### Adding Competitors

Add competitors you want to track:

```bash
node cli.js add-competitor
```

Follow the prompts to enter competitor names and URLs. You can add multiple competitors.

### Listing Competitors

View all competitors you're currently tracking:

```bash
node cli.js list-competitors
```

### Crawling Competitor Sites

Crawl and analyze all competitor websites:

```bash
node cli.js crawl
```

This process will:
1. Visit each competitor website
2. Extract content using Apify's crawler
3. Process the content and store it in a vector database
4. Save raw crawled data in the `crawled_data` directory

*Note: This may take some time depending on the number and size of competitor websites.*

### Generating Blog Posts

Generate a blog post based on competitor intelligence:

```bash
node cli.js generate-blog
```

Follow the prompts to specify:
- Blog post topic
- Keywords
- Target word count
- Content tone

The generated blog post will be saved as a Markdown file in the `generated_posts` directory.

## Advanced Usage

If you want to integrate this into your own applications, you can import and use the `CompetitorIntelligenceSystem` class directly:

```typescript
import { CompetitorIntelligenceSystem } from './competitive-blog-generator-ts';

async function example() {
  const system = new CompetitorIntelligenceSystem();
  
  // Load existing data or crawl new data
  const loaded = await system.loadExistingVectorStore();
  
  if (!loaded) {
    // Crawl and process new data
    // ...
  }
  
  // Generate a blog post
  const blogPost = await system.generateBlogPost({
    topic: "Your Topic Here",
    keywords: ["keyword1", "keyword2"],
    targetWordCount: 1500,
    tone: "professional"
  });
}
```

## Directory Structure

- `config/` - Stores competitor information
- `crawled_data/` - Raw data from competitor websites
- `chroma_db/` - Vector database storage
- `generated_posts/` - Output directory for generated blog posts

## Customization

You can customize the behavior by modifying:

- Crawling parameters in `crawlCompetitorSites()` method
- Blog post generation prompts in `generateBlogPost()` method
- Vector database settings

## Troubleshooting

- If crawling fails, check competitor URLs and your Apify API key
- If generation fails, ensure your OpenAI API key is valid and has sufficient credits
- For vector database issues, try deleting the `chroma_db` directory and re-crawling

## Rate Limits & Costs

Be aware of:
- Apify's crawler rate limits and pricing
- OpenAI API rate limits and pricing

Monitor your usage to avoid unexpected charges.