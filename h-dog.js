#!/usr/bin/env node
const readline = require('readline');
const { Anthropic } = require('@anthropic-ai/sdk');
require('dotenv').config();

const client = new Anthropic();
const conversationHistory = [];

const SYSTEM_PROMPT = `You are H-Dog, Healthcare Price Transparency Chief of Staff for Hosparent.

Your job: Find hospital markups on procedures, draft aggressive pitches for employers like Angela at Oncor, and write UGC social media scripts.

When the user asks you to analyze a CPT code:
1. Use your knowledge of healthcare pricing to find markups (hospital charges vs Medicare benchmarks)
2. For example, if Medicare pays $635 for CPT 47562 (cholecystectomy) but hospitals charge $6,000-$12,000, that's a 10-18x markup
3. Draft a punchy, aggressive 3-sentence pitch comparing these prices
4. Draft a 60-second UGC script for social media (TikTok/LinkedIn style)

Example:
CPT 47562 (Cholecystectomy/Gallbladder Removal)
- Medicare pays: $635
- Hospital average: $9,000
- Markup: 14x

PITCH: "Your employees paid $12,000 for a gallbladder removal at Regional Medical. Medicare's benchmark? $635. We found the same procedure at a competing hospital for $6,500—saving $5,500 per employee. Hosparent identifies these markups across your entire claims data."

Be aggressive, be specific, be ready to send (the user will review and decide to send via email or social).`;

const chat = async (userMessage) => {
  conversationHistory.push({
    role: 'user',
    content: userMessage,
  });

  try {
    const response = await client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: conversationHistory,
    });

    const assistantMessage = response.content[0].text;
    conversationHistory.push({
      role: 'assistant',
      content: assistantMessage,
    });

    return assistantMessage;
  } catch (error) {
    return `Error: ${error.message}`;
  }
};

const startLoop = () => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = () => {
    rl.question('\nYou: ', async (input) => {
      if (input.toLowerCase() === 'exit') {
        console.log('\nH-Dog signing off. 🐕\n');
        rl.close();
        return;
      }

      if (!input.trim()) {
        prompt();
        return;
      }

      const response = await chat(input);
      console.log('\nH-Dog:\n' + response);
      prompt();
    });
  };

  console.log('\n🐕 H-DOG v1.0 — Healthcare Price Transparency Chief of Staff');
  console.log('Hosparent: Find hospital markups, draft pitches, write social scripts');
  console.log('Type "exit" to quit\n');
  prompt();
};

startLoop();
