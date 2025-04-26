// Test OpenAI API key
import { ChatOpenAI } from "@langchain/openai";
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function testOpenAI() {
  try {
    console.log("Testing OpenAI API key...");
    console.log(`API Key: ${process.env.OPENAI_API_KEY?.substring(0, 10)}...`);
    
    const llm = new ChatOpenAI({
      modelName: "gpt-3.5-turbo", // Using a simpler model for testing
      temperature: 0.7,
      openAIApiKey: process.env.OPENAI_API_KEY
    });
    
    const result = await llm.invoke("Say hello world");
    console.log("Response:", result.content);
    console.log("API key is working!");
  } catch (error) {
    console.error("Error testing OpenAI API key:", error);
  }
}

testOpenAI().catch(console.error);
