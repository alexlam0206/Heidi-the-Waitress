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
const FETCH_INTERVAL_MS = parseInt(process.env.FETCH_INTERVAL_MS || '300000', 10);
const FLAVORTOWN_API_KEY = process.env.FLAVORTOWN_API_KEY;
const SLACK_CHANNEL_URL = process.env.SLACK_CHANNEL_URL;
const SHOP_PAGE_URL = process.env.SHOP_PAGE_URL || 'https://flavortown.hackclub.com/shop';
const CACHE_FILE = path.join(__dirname, '..', 'cache.json');

function getChannelId(input) {
  if (!input) return null;
  const match = input.match(/archives\/([A-Z0-9]+)/i);
  return match ? match[1] : input;
}

const SLACK_CHANNEL_ID = getChannelId(SLACK_CHANNEL_URL);

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = fs.readFileSync(CACHE_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Error loading cache:', err.message);
  }
  return null;
}

function saveCache(items) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(items, null, 2));
  } catch (err) {
    console.error('Error saving cache:', err.message);
  }
}

let previousItems = loadCache();

function detectChanges(currentItems) {
  if (!previousItems) {
    saveCache(currentItems);
    previousItems = currentItems;
    return [];
  }

  const changes = [];
  const previousMap = new Map(previousItems.map(item => [item.id, item]));

  for (const item of currentItems) {
    const prevItem = previousMap.get(item.id);
    
    if (!prevItem) {
      changes.push({
        type: 'new',
        name: item.name,
        description: item.description,
        prices: item.ticket_cost,
        stock: item.stock,
        photo: item.image_url,
        buy_link: `${SHOP_PAGE_URL.replace(/\/$/, '')}/order?shop_item_id=${item.id}`
      });
    } else {
      const priceChanged = JSON.stringify(prevItem.ticket_cost) !== JSON.stringify(item.ticket_cost);
      const stockChanged = prevItem.stock !== item.stock;

      if (priceChanged || stockChanged) {
        changes.push({
          type: 'update',
          name: item.name,
          description: item.description,
          oldPrices: prevItem.ticket_cost,
          newPrices: item.ticket_cost,
          oldStock: prevItem.stock,
          newStock: item.stock,
          priceChanged,
          stockChanged,
          photo: item.image_url,
          buy_link: `${SHOP_PAGE_URL.replace(/\/$/, '')}/order?shop_item_id=${item.id}`
        });
      }
    }
  }

  if (changes.length > 0) {
    saveCache(currentItems);
    previousItems = currentItems;
  }
  
  return changes;
}

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

async function fetchShopItems() {
  try {
    const storeEndpoint = `${FLAVORTOWN_API_URL.replace(/\/$/, '')}/api/v1/store`;
    console.log(`Fetching shop items from ${storeEndpoint}...`);
    
    const headers = {};
    if (FLAVORTOWN_API_KEY) {
      headers['Authorization'] = `Bearer ${FLAVORTOWN_API_KEY}`;
    }

    const response = await fetch(storeEndpoint, { headers });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    
    const data = await response.json();
    console.log('Successfully fetched shop items.');
    
    const changes = detectChanges(data);

    if (SLACK_CHANNEL_ID && changes.length > 0) {
      for (const change of changes) {
        let messageText = '';
        let blocks = [];

        if (change.type === 'new') {
          messageText = `Heidi found a new item: ${change.name}!`;
          blocks = [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `<!channel> *Ooooh lookie here!* Heidi just spotted something new on the menu! :ultrafastparrot: :flavortown:\n\n*${change.name}* 🌟\n> ${change.description || '_No description provided, it\'s a mystery!_'}`
              }
            },
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `*Prices:*\n${formatPrices(change.prices)}`
              }
            },
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `*Stock:* ${change.stock ?? 'Unknown'} left!`
              }
            }
          ];
        } else if (change.type === 'update') {
          messageText = `Heidi noticed a change for ${change.name}!`;
          let updateDetails = '';
          if (change.priceChanged) {
            updateDetails += `*Prices changed:*\n*Before:*\n${formatPrices(change.oldPrices)}\n*Now:*\n${formatPrices(change.newPrices)}\n`;
          }
          if (change.stockChanged) {
            updateDetails += `*Stock changed:* ${change.oldStock ?? 'Unknown'} -> ${change.newStock ?? 'Unknown'} left!\n`;
          }

          blocks = [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `<!channel> *Heads up!* Heidi noticed some changes for *${change.name}*! 🧐\n\n${updateDetails}`
              }
            }
          ];
        }

        if (change.photo) {
          blocks.push({
            type: "image",
            image_url: change.photo,
            alt_text: change.name
          });
        }

        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `🔗 *Check it out here:* <${change.buy_link}|Flavortown Shop>`
          }
        });

        await app.client.chat.postMessage({
          channel: SLACK_CHANNEL_ID,
          text: messageText,
          blocks: blocks,
          link_names: true
        });
      }
      console.log(`Posted ${changes.length} updates to Slack.`);
    }

    return data;
  } catch (error) {
    console.error('Error fetching shop items:', error.message);
  }
}

(async () => {
  try {
    await app.start();
    console.log('Heidi is ready!');

    if (FLAVORTOWN_API_URL) {
      fetchShopItems();
      setInterval(fetchShopItems, FETCH_INTERVAL_MS);
    }
  } catch (error) {
    console.error('Failed to start Heidi:', error);
    process.exit(1);
  }
})();


