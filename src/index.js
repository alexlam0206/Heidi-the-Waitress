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
      const data = fs.readFileSync(CACHE_FILE, 'utf8').trim();
      if (!data) return null;
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Error loading cache:', err.message);
  }
  return null;
}

function saveCache(items) {
  try {
    console.log(`Saving ${items.length} items to cache...`);
    fs.writeFileSync(CACHE_FILE, JSON.stringify(items, null, 2));
    console.log('Cache saved successfully.');
  } catch (err) {
    console.error('Error saving cache:', err.message);
  }
}

let previousItems = loadCache();

function detectChanges(currentItems) {
  if (!previousItems) {
    console.log('No previous cache found, initializing...');
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
      const descriptionChanged = (prevItem.description || '') !== (item.description || '');
      const longDescChanged = (prevItem.long_description || '') !== (item.long_description || '');
      const nameChanged = (prevItem.name || '') !== (item.name || '');
      const photoChanged = (prevItem.image_url || '') !== (item.image_url || '');

      if (priceChanged || stockChanged || descriptionChanged || longDescChanged || nameChanged || photoChanged) {
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
          oldDescription: prevItem.description,
          newDescription: item.description,
          descriptionChanged,
          oldLongDescription: prevItem.long_description,
          newLongDescription: item.long_description,
          longDescChanged,
          oldName: prevItem.name,
          newName: item.name,
          nameChanged,
          oldPhoto: prevItem.image_url,
          newPhoto: item.image_url,
          photoChanged,
          photo: item.image_url,
          buy_link: `${SHOP_PAGE_URL.replace(/\/$/, '')}/order?shop_item_id=${item.id}`
        });
      }
    }
  }

  const hasActualChanges = JSON.stringify(previousItems) !== JSON.stringify(currentItems);

  if (hasActualChanges) {
    console.log(`Changes detected (Total changes: ${changes.length}). Updating cache...`);
    
    for (const change of changes) {
      if (change.type === 'update') {
        if (change.priceChanged) {
          console.log(`[SYNC] Price changed for ${change.name}: ${JSON.stringify(change.oldPrices)} -> ${JSON.stringify(change.newPrices)}`);
        }
        if (change.stockChanged) {
          console.log(`[SYNC] Stock changed for ${change.name}: ${change.oldStock} -> ${change.newStock}`);
        }
        if (change.descriptionChanged) {
          console.log(`[SYNC] Description changed for ${change.name}`);
        }
        if (change.longDescChanged) {
          console.log(`[SYNC] Long description changed for ${change.name}`);
        }
        if (change.nameChanged) {
          console.log(`[SYNC] Name changed: ${change.oldName} -> ${change.newName}`);
        }
        if (change.photoChanged) {
          console.log(`[SYNC] Image URL changed for ${change.name}`);
        }
      }
    }
    
    saveCache(currentItems);
    previousItems = currentItems;
  } else {
    console.log('No changes detected since last fetch.');
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
  const BOLD = '\u0002'; // Start of text
  out = out.replace(/\*\*(.*?)\*\*/g, `${BOLD}$1${BOLD}`);
  out = out.replace(/__(.*?)__/g, `${BOLD}$1${BOLD}`);
  
  // 3. Italic: *text* -> _text_
  out = out.replace(/\*([^\*]+)\*/g, '_$1_');
  
  // 4. Restore Bold
  out = out.split(BOLD).join('*');
  
  // 5. Strikethrough
  out = out.replace(/~~(.*?)~~/g, '~$1~');
  
  // 6. Headers
  out = out.replace(/^#+\s*(.*)$/gm, '*$1*');
  
  return out;
}

async function fetchShopItems() {
  try {
    const storeEndpoint = `${FLAVORTOWN_API_URL.replace(/\/$/, '')}/api/v1/store?t=${Date.now()}`;
    console.log(`Fetching shop items from ${storeEndpoint}...`);
    
    const headers = {
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    };
    if (FLAVORTOWN_API_KEY) {
      headers['Authorization'] = `Bearer ${FLAVORTOWN_API_KEY}`;
    }

    const response = await fetch(storeEndpoint, { headers });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
    }
    
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
                text: `<!channel> *Ooooh lookie here!* Heidi just spotted something new on the menu! :ultrafastparrot: :flavortown: :yay: \n\n*${change.name}* \n> ${markdownToSlack(change.description) || '_No description provided, it\'s a mystery!_'}`
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
                text: `*Stock:* ${change.stock ?? 'Unlimited'} left!`
              }
            }
          ];
        } else if (change.type === 'update') {
          messageText = `Heidi noticed a change for ${change.name}!`;
          let updateDetails = '';
          let priceDetails = '';
          if (change.priceChanged) {
            priceDetails = `*Prices changed:*\n*Before:*\n${formatPrices(change.oldPrices)}\n*Now:*\n${formatPrices(change.newPrices)}\n`;
          } else {
            priceDetails = `*Current Prices:*\n${formatPrices(change.newPrices)}\n`;
          }

          if (change.stockChanged) {
            updateDetails += `*Stock changed:* ${change.oldStock ?? 'Unlimited'} -> ${change.newStock ?? 'Unlimited'} left!\n`;
          }
          if (change.descriptionChanged) {
            updateDetails += `*Description changed:*\n*Before:*\n${markdownToSlack(truncate(change.oldDescription))}\n*Now:*\n${markdownToSlack(truncate(change.newDescription))}\n`;
          }
          if (change.longDescChanged) {
            updateDetails += `*Long description changed:*\n*Before:*\n${markdownToSlack(truncate(change.oldLongDescription))}\n*Now:*\n${markdownToSlack(truncate(change.newLongDescription))}\n`;
          }
          if (change.nameChanged) {
            updateDetails += `*Name changed:* ${truncate(change.oldName, 120)} -> ${truncate(change.newName, 120)}\n`;
          }
          if (change.photoChanged) {
            updateDetails += `*Image updated.*\n`;
          }

          blocks = [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `<!channel> *Heads up!* Heidi noticed some changes for *${change.name}*! :huh: \n\n${updateDetails}`
              }
            },
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: priceDetails
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
            text: `*<${change.buy_link}|Buy now!>*`
          }
        });

        await app.client.chat.postMessage({
          channel: SLACK_CHANNEL_ID,
          text: messageText,
          blocks: blocks,
          link_names: true,
          unfurl_links: false,
          unfurl_media: false
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
