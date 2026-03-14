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
  
  const regions = Object.entries(prices).filter(
    ([key, price]) => {
      if (key === 'base_cost' || key.startsWith('enabled_') || price == null) return false;
      const enabledKey = `enabled_${key}`;
      return prices[enabledKey] !== false;
    }
  );
  if (regions.length === 0) return 'Unknown';
  const uniquePrices = new Set(regions.map(([_, price]) => price));

  if (uniquePrices.size === 1 && regions.length > 1) {
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
    console.log(`\nTesting Heidi's output for ${storeEndpoint}...\n`);
    
    const headers = {};
    if (FLAVORTOWN_API_KEY) {
      headers['Authorization'] = `Bearer ${FLAVORTOWN_API_KEY}`;
    }

    const response = await fetch(storeEndpoint, { headers });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    
    const data = await response.json();
    console.log(`Successfully fetched ${data.length} items.\n`);

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
        console.log(`Block 1: <!channel> *Ooooh lookie here!* Heidi just spotted something new on the menu! :ultrafastparrot: :flavortown: :yay:`);
        console.log(`         *${item.name}*`);
        console.log(`         > ${markdownToSlack(item.description) || '_No description provided, it\'s a mystery!_'}`);
        console.log(`Block 2: :ft-cookie: *Prices:\n${formatPrices(item.ticket_cost)}`);
        console.log(`Block 3: *Stock:* ${item.stock ?? 'Unlimited'} left!`);
        if (item.type && item.type.toLowerCase().includes('accessory')) {
          console.log(`Block 3.5: *Accessory type:* ${item.type}`);
          if (item.accessory_tag) console.log(`           *Accessory tag:* ${item.accessory_tag}`);
          if (item.attached_shop_item_ids && item.attached_shop_item_ids.length) {
            console.log(`           *Attached items:* ${item.attached_shop_item_ids.filter(Boolean).join(', ')}`);
          }
        }
        if (item.image_url) console.log(`Block 4: [Image] ${item.image_url}`);
        console.log(`Block 5: *<${buyLink}|Buy now!>*`);
        console.log('--------------------------------------\n');
        // Accessory-change preview: find accessory items attached to this main item
        const attachedAccessories = data.filter(i => Array.isArray(i.attached_shop_item_ids) && i.attached_shop_item_ids.filter(Boolean).includes(item.id) && String(i.type || '').toLowerCase().includes('accessory'));
        if (attachedAccessories.length) {
          // try to read previous cache to show Before list
          let prevItems = null;
          try {
            const cachePath = path.join(__dirname, '..', 'cache.json');
            if (fs.existsSync(cachePath)) {
              prevItems = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
            }
          } catch (e) {
            prevItems = null;
          }

          const prevAccessories = prevItems ? prevItems.filter(i => Array.isArray(i.attached_shop_item_ids) && i.attached_shop_item_ids.filter(Boolean).includes(item.id) && String(i.type || '').toLowerCase().includes('accessory')) : [];

          const formatAccLine = (a) => {
            const base = a.ticket_cost && typeof a.ticket_cost.base_cost === 'number' && a.ticket_cost.base_cost > 0 ? a.ticket_cost.base_cost : null;
            return base ? `${a.name}: ${base} :ft-cookie:` : `${a.name}`;
          };

          function formatAccessoryGroups(accessories) {
            if (!accessories || accessories.length === 0) return '_No accessories_';

            const guessCategory = (a) => {
              const tagRaw = (a.accessory_tag || '').toString().trim();
              if (tagRaw) return tagRaw.replace(/[-_]/g, ' ').replace(/^./, s => s.toUpperCase());
              const name = (a.name || '').toString();
              if (/\b(GB|TB|Storage|256|512|1TB|500GB)\b/i.test(name)) return 'Storage';
              if (/\b(Space|Starlight|Blue|Purple|Violet|Pink|Gold|Orange|Yellow|Rose|Indigo|Magenta|Grey|Silver|Black|White|Red|Green|Teal|Bronze|Charcoal|Brown)\b/i.test(name)) return 'Colour';
              if (/\b(13\"|13'|13 inch|13-inch|model)\b/i.test(name)) return 'Size';
              return 'Other upgrades';
            };

            const groups = {};
            for (const a of accessories) {
              const cat = guessCategory(a);
              if (!groups[cat]) groups[cat] = [];
              groups[cat].push(a);
            }

            const lines = [];
            for (const cat of Object.keys(groups)) {
              lines.push(`*${cat}*`);
              const items = groups[cat];
              if (/colour|color/i.test(cat)) {
                const names = items.map(i => i.name).join(', ');
                lines.push(names);
              } else {
                for (const a of items) {
                  const base = a.ticket_cost && typeof a.ticket_cost.base_cost === 'number' && a.ticket_cost.base_cost > 0 ? a.ticket_cost.base_cost : null;
                  if (base != null) lines.push(`${a.name}  :ft-cookie: ${base}`);
                  else lines.push(`${a.name}`);
                }
              }
              lines.push('');
            }

            return lines.join('\n');
          }

          const beforeLines = prevAccessories.map(formatAccLine).join('\n') || '_No accessories_';
          const nowLines = attachedAccessories.map(formatAccLine).join('\n') || '_No accessories_';

          // determine which accessories actually changed (compare ticket_cost against previous cache)
          const changedNowAccessories = attachedAccessories.filter(a => {
            const prev = prevAccessories.find(p => p.id === a.id);
            if (!prev) return true;
            try {
              return JSON.stringify(prev.ticket_cost) !== JSON.stringify(a.ticket_cost);
            } catch (e) {
              return true;
            }
          });

          // detect brand-new accessories (attached now but missing in the previous cache)
          const newAccessories = changedNowAccessories.filter(a => !prevAccessories.some(p => p.id === a.id));
          const hasNew = newAccessories.length > 0;

          console.log('\n--- PREVIEW: Accessory-change notification ---');
          console.log(`Text: ${hasNew ? `Heidi found something new for ${item.name} :ultrafastparrot: :flavortown: :yay:` : `Accessory changes for ${item.name}`}`);
          if (!hasNew) {
            console.log('\nBefore:');
            if (changedNowAccessories.length) {
              const prevChanged = prevAccessories.filter(p => changedNowAccessories.some(c => c.id === p.id));
              console.log(prevChanged.map(formatAccLine).join('\n') || '_No accessories_');
            } else {
              console.log(beforeLines);
            }
          }

          console.log('\nNow:');
          // If there are new accessories, show all current attached accessories; otherwise show changed or all
          if (hasNew) {
            console.log(formatAccessoryGroups(attachedAccessories));
          } else if (changedNowAccessories.length) {
            console.log(formatAccessoryGroups(changedNowAccessories));
          } else {
            console.log(formatAccessoryGroups(attachedAccessories));
          }

          // Determine Base price: prefer main item's base_cost when available (>0), otherwise use minimum of changed (or attached) accessories
          const mainBase = item.ticket_cost && typeof item.ticket_cost.base_cost === 'number' && item.ticket_cost.base_cost > 0 ? item.ticket_cost.base_cost : null;
          let minBase = null;
          if (mainBase != null) {
            minBase = mainBase;
          } else {
            const accBases = (changedNowAccessories.length ? changedNowAccessories : attachedAccessories).map(a => (a.ticket_cost && typeof a.ticket_cost.base_cost === 'number' && a.ticket_cost.base_cost > 0) ? a.ticket_cost.base_cost : Infinity).filter(Number.isFinite);
            if (accBases.length) minBase = Math.min(...accBases);
          }
          if (minBase != null) console.log(`\nBase price: ${minBase} :ft-cookie:`);

          console.log(`Image: ${item.image_url}`);
          console.log(`Buy now: ${buyLink}`);
          console.log('--------------------------------------\n');
        }

        console.log('--- PREVIEW: Update Notification ---');
        console.log(`Text: Heidi noticed a change for ${item.name}!`);
        console.log(`Block 1: <!channel> *Heads up!* Heidi noticed some changes for *${item.name}*! :huh:`);
        console.log(`         :ft-cookie: *Prices changed:*`);
        console.log(`         *Before:* \n${formatPrices(item.ticket_cost)}`);
        console.log(`         *Now:* \n${formatPrices(item.ticket_cost)}`);
        console.log(`         *Stock changed:* ${item.stock ?? 'Unlimited'} -> ${item.stock ?? 'Unlimited'} left!`);
        console.log(`         *Description changed:*`);
          console.log(`         *Before:* \n${markdownToSlack(truncate(item.description))}`);
          console.log(`         *Now:* \n${markdownToSlack(truncate(item.description))}`);
          // Long description logic moved to separate blocks
          console.log(`         *Name changed:* ${truncate(item.name)} -> ${truncate(item.name)}`);
          console.log(`         *Image updated.*`);

          if (item.type && item.type.toLowerCase().includes('accessory')) {
            console.log(`         *Accessory type:* ${item.type}`);
            if (item.accessory_tag) console.log(`                 *Accessory tag:* ${item.accessory_tag}`);
            if (item.attached_shop_item_ids && item.attached_shop_item_ids.length) {
              console.log(`                 *Attached items:* ${item.attached_shop_item_ids.filter(Boolean).join(', ')}`);
            }
          }

          console.log(`Block 2: :ft-cookie: *Prices (Dedicated Block):*`);
          console.log(`         ${formatPrices(item.ticket_cost)}`);

          console.log(`Block 3: *Long description changed:*`);
          console.log(`Block 4: *Before:* \n${markdownToSlack(truncate(item.long_description, 2000))}`);
          console.log(`Block 5: *Now:* \n${markdownToSlack(truncate(item.long_description, 2000))}`);
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
