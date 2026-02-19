require('dotenv').config();
const { App } = require('@slack/bolt');
const fs = require('fs');
const path = require('path');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN
});

const FLAVORTOWN_API_URL = process.env.FLAVORTOWN_API_URL || 'https://flavortown.hackclub.com';
const FLAVORTOWN_API_KEY = process.env.FLAVORTOWN_API_KEY;
const SHOP_PAGE_URL = process.env.SHOP_PAGE_URL || 'https://flavortown.hackclub.com/shop';
const SLACK_CHANNEL_URL = process.env.SLACK_CHANNEL_URL;

function getChannelId(input) {
  if (!input) return null;
  const match = input.match(/archives\/([A-Z0-9]+)/i);
  return match ? match[1] : input;
}

const SLACK_CHANNEL_ID = getChannelId(SLACK_CHANNEL_URL);

function formatPrices(prices) {
  if (!prices) return 'Unknown';
  
  const regions = Object.entries(prices).filter(([key]) => key !== 'base_cost');
  const uniquePrices = new Set(regions.map(([_, price]) => price));

  if (uniquePrices.size === 1) {
    return `${uniquePrices.values().next().value} :ft-cookie:`;
  }

  const countryEmojis = {
    au: ':flag-au:',
    ca: ':flag-ca:',
    eu: ':flag-eu:',
    in: ':flag-in:',
    uk: ':flag-gb:',
    us: ':flag-us:',
    xx: ':earth_americas:'
  };
  
  return regions
    .map(([country, price]) => `${countryEmojis[country] || country.toUpperCase()}: ${price} :ft-cookie:`)
    .join('\n');
}

function truncate(text, max = 500) {
  if (!text) return '_None_';
  const str = String(text);
  return str.length > max ? `${str.slice(0, max)}…` : str;
}

function markdownToSlack(text) {
  if (!text) return text;
  let out = text;
  
  // 1. Links: [text](url) -> <url|text>
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>');
  
  // 2. Bold: **text** -> *text*
  // We use a temporary placeholder for the * to avoid confusing it with italic *
  const BOLD = '\u0002'; // Start of text
  out = out.replace(/\*\*(.*?)\*\*/g, `${BOLD}$1${BOLD}`);
  out = out.replace(/__(.*?)__/g, `${BOLD}$1${BOLD}`);
  
  // 3. Italic: *text* -> _text_
  // Only match * if it's not our placeholder
  out = out.replace(/\*([^\*]+)\*/g, '_$1_');
  // _text_ is already correct for Slack, so we leave it (or ensure it's _text_)
  
  // 4. Restore Bold
  out = out.split(BOLD).join('*');
  
  // 5. Strikethrough
  out = out.replace(/~~(.*?)~~/g, '~$1~');
  
  // 6. Headers
  out = out.replace(/^#+\s*(.*)$/gm, '*$1*');
  
  return out;
}

async function testOutput() {
  try {
    const storeEndpoint = `${FLAVORTOWN_API_URL.replace(/\/$/, '')}/api/v1/store`;
    console.log(`\n🔍 Testing Heidi's output for ${storeEndpoint}...\n`);
    
    const headers = {};
    if (FLAVORTOWN_API_KEY) {
      headers['Authorization'] = `Bearer ${FLAVORTOWN_API_KEY}`;
    }

    const response = await fetch(storeEndpoint, { headers });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    
    const data = await response.json();
    console.log(`✅ Successfully fetched ${data.length} items.\n`);

    if (data.length > 0) {
      // Find specific items to test
      const testItems = [
        data.find(i => i.name.toLowerCase().includes('raspberry pi 5')) || data[0],
        data.find(i => i.name.toLowerCase().includes('hyperpixel'))
      ].filter(Boolean);

      for (const item of testItems) {
        const buyLink = `${SHOP_PAGE_URL.replace(/\/$/, '')}/order?shop_item_id=${item.id}`;
        
        console.log(`\n=== PREVIEW FOR: ${item.name} ===`);
        console.log('--- PREVIEW: New Item Notification ---');
        console.log(`Text: Heidi found a new item: ${item.name}!`);
        console.log(`Block 1: <!channel> *Ooooh lookie here!* Heidi just spotted something new on the menu!`);
        console.log(`         *${item.name}* 🌟`);
        console.log(`         > ${markdownToSlack(item.description) || '_No description provided, it\'s a mystery!_'} 🕵️‍♀️`);
        console.log(`Block 2: 💸 *Prices:*\n${formatPrices(item.ticket_cost)}`);
        console.log(`Block 3: 📦 *Stock:* ${item.stock ?? 'Unlimited'} left!`);
        if (item.image_url) console.log(`Block 4: [Image] ${item.image_url}`);
        console.log(`Block 5: 🔗 *Check it out here:* <${buyLink}|Flavortown Shop>`);
        console.log('--------------------------------------\n');

        console.log('--- PREVIEW: Update Notification ---');
        console.log(`Text: Heidi noticed a change for ${item.name}!`);
        console.log(`Block 1: <!channel> *Heads up!* Heidi noticed some changes for *${item.name}*! 🧐`);
        console.log(`         💸 *Prices changed:*`);
        console.log(`         *Before:* \n${formatPrices(item.ticket_cost)}`);
        console.log(`         *Now:* \n${formatPrices(item.ticket_cost)}`);
        console.log(`         📦 *Stock changed:* ${item.stock ?? 'Unlimited'} -> ${item.stock ?? 'Unlimited'} left!`);
        console.log(`         📝 *Description changed:*`);
        console.log(`         *Before:* \n${markdownToSlack(truncate(item.description))}`);
        console.log(`         *Now:* \n${markdownToSlack(truncate(item.description))}`);
        console.log(`         📖 *Long description changed:*`);
        console.log(`         *Before:* \n${markdownToSlack(truncate(item.long_description))}`);
        console.log(`         *Now:* \n${markdownToSlack(truncate(item.long_description))}`);
        console.log(`         🏷️ *Name changed:* ${truncate(item.name)} -> ${truncate(item.name)}`);
        console.log(`         🖼️ *Image updated.*`);
        console.log(`Block 2: 💸 *Prices (Dedicated Block):*`);
        console.log(`         ${formatPrices(item.ticket_cost)}`);
        console.log('--------------------------------------\n');
      }
    }
    console.log('Heidi is ready to serve!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during test-output:', error.message);
    process.exit(1);
  }
}

testOutput();
