require('dotenv').config();
const { App } = require('@slack/bolt');
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

// track items in memory for now
let previousItems = null;

function detectChanges(currentItems) {
  // compare the fetched items with previously seen items
  if (!previousItems) {
    previousItems = new Map(currentItems.map(item => [item.id, item]));
    return [];
  }

  const changes = [];
  const currentItemsMap = new Map(currentItems.map(item => [item.id, item]));

  for (const item of currentItems) {
    const oldItem = previousItems.get(item.id);

    if (!oldItem) {
      // parse name, price, stock, description, photo link
      changes.push({
        type: 'new',
        name: item.name,
        description: item.description,
        price: item.ticket_cost?.base_cost,
        stock: item.stock,
        photo: item.image_url,
        buy_link: `https://flavortown.hackclub.com/shop` // general shop link
      });
    }
  }

  previousItems = currentItemsMap;
  return changes;
}

async function fetchShopItems() {
  try {
    // fetch json data from the shop api
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
