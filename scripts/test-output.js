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
    return `${uniquePrices.values().next().value} :ftt-cookie:`;
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
    .map(([country, price]) => `${countryEmojis[country] || country.toUpperCase()}: ${price} :ftt-cookie:`)
    .join('\n');
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
      const item = data[0]; // Test with the first item
      const buyLink = `${SHOP_PAGE_URL.replace(/\/$/, '')}/order?shop_item_id=${item.id}`;
      
      console.log('--- PREVIEW: New Item Notification ---');
      console.log(`Text: Heidi found a new item: ${item.name}!`);
      console.log(`Block 1: <!channel> *Ooooh lookie here!* Heidi just spotted something new on the menu!`);
      console.log(`         *${item.name}* 🌟`);
      console.log(`         > ${item.description || '_No description provided, it\'s a mystery!_'} 🕵️‍♀️`);
      console.log(`Block 2: 💸 *Prices:*\n${formatPrices(item.ticket_cost)}`);
      console.log(`Block 3: 📦 *Stock:* ${item.stock ?? 'Unknown'} left!`);
      if (item.image_url) console.log(`Block 4: [Image] ${item.image_url}`);
      console.log(`Block 5: 🔗 *Check it out here:* <${buyLink}|Flavortown Shop>`);
      console.log('--------------------------------------\n');

      console.log('--- PREVIEW: Update Notification ---');
      console.log(`Text: Heidi noticed a change for ${item.name}!`);
      console.log(`Block 1: <!channel> *Heads up!* Heidi noticed some changes for *${item.name}*! 🧐`);
      console.log(`         💸 *Prices changed:*`);
      console.log(`         *Before:* \n${formatPrices(item.ticket_cost)}`);
      console.log(`         *Now:* \n${formatPrices(item.ticket_cost)}`);
      console.log(`         📦 *Stock changed:* ${item.stock ?? 'Unknown'} -> ${item.stock ?? 'Unknown'} left!`);
      console.log('--------------------------------------\n');
    }

    console.log('Heidi is ready to serve!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during test-output:', error.message);
    process.exit(1);
  }
}

testOutput();
