# Competitor Intelligence Blog Generator - Setup Guide

This tool helps your digital agency generate high-quality blog posts based on competitive intelligence. It crawls competitor websites, analyzes their content, and generates unique blog posts on topics you specify.

## Prerequisites

- Node.js (v16 or newer)
- A Google API key (for Gemini-based blog generation)
- An OpenAI API key (for embeddings and image generation)
- An Apify API key (for web crawling)
- An Anthropic API key (optional, for additional humanization)

## Installation

1. **Clone or download the project files**

2. **Install dependencies**
   ```bash
   npm install langchain @langchain/openai @langchain/google-genai @langchain/anthropic chromadb apify-client dotenv commander inquirer
   ```

3. **Configure environment variables**

   Create a `.env` file in the project root:
   ```
   GOOGLE_API_KEY=your_google_api_key_here
   OPENAI_API_KEY=your_openai_api_key_here
   APIFY_API_KEY=your_apify_api_key_here
   ANTHROPIC_API_KEY=your_anthropic_api_key_here  # Optional, for additional humanization
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
node cli.js generate
```

Follow the prompts to specify:
- Blog post topic
- Keywords
- Target word count
- Content tone
- Audience
- Content focus and format
- Whether to apply an additional humanization pass
- Whether to generate a thumbnail image and in what style

The generated blog post will be saved as a Markdown file in the `generated_posts` directory.

### Generating Images

#### Automatic Thumbnail Generation

The tool can automatically generate thumbnail images for your blog posts based on the content:

```bash
# Using the glassy anime portrait template (default)
node cli.js generate --generate-image --image-subject "boy" --image-color "emerald-green" --image-secondary-color "gold" --image-clothing "futuristic armor"

# Using a standard style (if preferred)
node cli.js generate --generate-image --image-style "digital art" --image-aspect "16:9"
```

#### Dedicated Image Generation Command

For more control over image generation, use the dedicated command:

```bash
node cli.js generate-image -p "A futuristic cityscape with flying cars and neon lights" -s "digital art" -a "16:9" -q "hd"
```

This command offers extensive options:

```bash
# Generate from a prompt file
node cli.js generate-image -f prompt.txt -s "oil painting" -o "./my-images"

# Enhance a simple prompt with AI
node cli.js generate-image -p "Mountain landscape" -e -s "watercolor painting"

# Specify custom filename and output location
node cli.js generate-image -p "Abstract shapes" -n "my-artwork.png" -o "./artwork"

# Use the glassy anime portrait template (this is now the default option in the interactive mode)
node cli.js generate-image -t "glassy-anime-portrait" --subject "robot" --main-color "silver" --secondary-color "blue" --clothing "futuristic armor"

# The tool will always ask about using the template, even with command-line options
node cli.js generate-image -p "A mountain landscape"
```

#### Available Image Styles

You can choose from various image styles including:
- photorealistic
- digital art
- 3D render
- watercolor painting
- oil painting
- pencil sketch
- minimalist
- isometric
- flat design
- abstract
- vintage
- futuristic
- cartoon
- comic book
- cyberpunk
- steampunk
- vaporwave

### Applying Additional Humanization

You can also apply an additional humanization pass to an existing blog post to make it sound even more natural and human-written:

```bash
node cli.js humanize path/to/your/blog-post.md
```

Follow the prompts to specify:
- Personality traits to incorporate
- Whether to preserve SEO optimization
- Whether to preserve the overall structure

The humanized blog post will be saved as a new file with "-humanized" appended to the original filename.

#### Command-line Options for Humanization

```bash
node cli.js humanize path/to/your/blog-post.md --style "casual and friendly" --model "claude-3-7-sonnet-20250219" --temperature 0.8
```

- `--style`: Specify the writing style to emulate
- `--model`: Choose the Claude model to use
- `--temperature`: Set the creativity level (0.0-1.0)

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
- Humanization parameters in `humanizeBlogPost()` method
- Vector database settings

You can also customize tone and audience suggestions:

```bash
node cli.js customize-tones
node cli.js customize-audiences
```

## Troubleshooting

- If crawling fails, check competitor URLs and your Apify API key
- If generation fails, ensure your OpenAI API key is valid and has sufficient credits
- If humanization fails, check your Anthropic API key
- For vector database issues, try deleting the `chroma_db` directory and re-crawling

## Rate Limits & Costs

Be aware of:
- Apify's crawler rate limits and pricing
- OpenAI API rate limits and pricing
- Anthropic API rate limits and pricing

Monitor your usage to avoid unexpected charges.