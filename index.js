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
const CACHE_FILE = path.join(__dirname, 'cache.json');

function getChannelId(input) {
  if (!input) return null;
  const match = input.match(/archives\/([A-Z0-9]+)/i);
  return match ? match[1] : input;
}

const SLACK_CHANNEL_ID = getChannelId(SLACK_CHANNEL_URL);

// load cached items from local json file
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

// save items to local json file
function saveCache(items) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(items, null, 2));
  } catch (err) {
    console.error('Error saving cache:', err.message);
  }
}

let previousItems = loadCache();

function detectChanges(currentItems) {
  // compare new fetch with cache to detect new items
  if (!previousItems) {
    saveCache(currentItems);
    previousItems = currentItems;
    return [];
  }

  const changes = [];
  const previousMap = new Map(previousItems.map(item => [item.id, item]));

  for (const item of currentItems) {
    if (!previousMap.has(item.id)) {
      // new item found
      changes.push({
        name: item.name,
        description: item.description,
        price: item.ticket_cost?.base_cost,
        stock: item.stock,
        photo: item.image_url,
        buy_link: SHOP_PAGE_URL
      });
    }
  }

  if (changes.length > 0) {
    saveCache(currentItems);
    previousItems = currentItems;
  }
  
  return changes;
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
    
    const newItems = detectChanges(data);

    // if there are new items, send slack message pinging everyone
    if (SLACK_CHANNEL_ID && newItems.length > 0) {
      for (const item of newItems) {
        const blocks = [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `<!channel> *Ooooh lookie here!* Heidi just spotted something new on the menu! 🥨✨\n\n*${item.name}* 🌟\n> ${item.description || '_No description provided, it\'s a mystery!_'} 🕵️‍♀️`
            }
          },
          {
            type: "section",
            fields: [
              {
                type: "mrkdwn",
                text: `💸 *Price:* ${item.price || '??'} tickets`
              },
              {
                type: "mrkdwn",
                text: `📦 *Stock:* ${item.stock} left!`
              }
            ]
          }
        ];

        if (item.photo) {
          blocks.push({
            type: "image",
            image_url: item.photo,
            alt_text: item.name
          });
        }

        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `🔗 *Snag it here:* <${item.buy_link}|Flavortown Shop>`
          }
        });

        await app.client.chat.postMessage({
          channel: SLACK_CHANNEL_ID,
          text: `Heidi found a new item: ${item.name}!`,
          blocks: blocks,
          link_names: true
        });
      }
      console.log(`Posted ${newItems.length} new items to Slack.`);
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


