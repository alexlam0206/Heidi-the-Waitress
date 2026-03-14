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

// Shortcut to edit message
app.shortcut('edit_heidi_message', async ({ shortcut, ack, client, body }) => {
  await ack();

  // Check if user is authorized
  const allowedUserIds = ['U054VC2KM9P', 'U0A1NME3EJD'];
  
  if (!allowedUserIds.includes(body.user.id)) {
    try {
      await client.chat.postEphemeral({
        channel: shortcut.channel.id,
        user: body.user.id,
        text: ":stop: Sorry, only @nok and @amber can edit messages, DM @nok if you need access!"
      });
    } catch (e) {
      console.error(e);
    }
    return;
  }

  try {
    // Extract text and image from existing blocks
    let markdownContent = '';
    let imageUrl = '';
    let buyLink = '';

    if (shortcut.message.blocks) {
      const textSections = [];
      for (const block of shortcut.message.blocks) {
        if (block.type === 'section' && block.text && block.text.type === 'mrkdwn') {
          const text = block.text.text;
          // Check if it's the "Buy now!" link section
          const buyMatch = text.match(/<([^|]+)\|Buy now!>/);
          if (buyMatch) {
            buyLink = buyMatch[1];
          } else {
            textSections.push(text);
          }
        } else if (block.type === 'image') {
          imageUrl = block.image_url;
        }
      }
      markdownContent = textSections.join('\n\n---\n\n');
    }

    const blocksJson = shortcut.message.blocks ? JSON.stringify(shortcut.message.blocks, null, 2) : '';
    
    await client.views.open({
      trigger_id: shortcut.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'edit_message_submission',
        private_metadata: JSON.stringify({
          channel: shortcut.channel.id,
          ts: shortcut.message.ts
        }),
        title: {
          type: 'plain_text',
          text: 'Edit Message'
        },
        blocks: [
          {
            type: 'input',
            block_id: 'markdown_input',
            element: {
              type: 'plain_text_input',
              action_id: 'content',
              multiline: true,
              initial_value: markdownContent,
              placeholder: {
                type: 'plain_text',
                text: 'Enter message content here...'
              }
            },
            label: {
              type: 'plain_text',
              text: 'Message Content (Markdown)'
            },
            hint: {
              type: 'plain_text',
              text: 'Use --- on a new line to separate sections into different blocks.'
            }
          },
          {
            type: 'input',
            block_id: 'image_input',
            optional: true,
            element: {
              type: 'plain_text_input',
              action_id: 'url',
              initial_value: imageUrl,
              placeholder: {
                type: 'plain_text',
                text: 'https://...'
              }
            },
            label: {
              type: 'plain_text',
              text: 'Image URL'
            }
          },
          {
            type: 'input',
            block_id: 'buy_link_input',
            optional: true,
            element: {
              type: 'plain_text_input',
              action_id: 'url',
              initial_value: buyLink,
              placeholder: {
                type: 'plain_text',
                text: 'https://...'
              }
            },
            label: {
              type: 'plain_text',
              text: 'Buy Link URL'
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*Advanced Options*'
            }
          },
          {
            type: 'input',
            block_id: 'text_input',
            optional: true,
            element: {
              type: 'plain_text_input',
              action_id: 'content',
              multiline: true,
              initial_value: shortcut.message.text || ''
            },
            label: {
              type: 'plain_text',
              text: 'Fallback Text'
            }
          },
          {
            type: 'input',
            block_id: 'blocks_input',
            optional: true,
            element: {
              type: 'plain_text_input',
              action_id: 'content',
              multiline: true,
              initial_value: blocksJson,
              placeholder: {
                type: 'plain_text',
                text: '[]'
              }
            },
            label: {
              type: 'plain_text',
              text: 'Raw Blocks (JSON) - Fallback if Markdown is empty'
            }
          }
        ],
        submit: {
          type: 'plain_text',
          text: 'Save Changes'
        }
      }
    });
  } catch (error) {
    console.error('Error opening edit modal:', error);
  }
});

// Handle edit message submission
app.view('edit_message_submission', async ({ ack, body, view, client }) => {
  const metadata = JSON.parse(view.private_metadata);
  const fallbackText = view.state.values.text_input.content.value;
  const blocksString = view.state.values.blocks_input.content.value;
  const markdownContent = view.state.values.markdown_input.content.value;
  const imageUrl = view.state.values.image_input.url.value;
  const buyLink = view.state.values.buy_link_input.url.value;
  
  let blocks = undefined;
  
  if (markdownContent && markdownContent.trim() !== '') {
    // Rebuild blocks from markdown content
    blocks = [];
    
    // Split content by separator '---' or handle it as one big block
    const sections = markdownContent.split(/\n\s*---\s*\n/).filter(s => s.trim() !== '');
    
    for (const section of sections) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: section.trim()
        }
      });
    }

    if (imageUrl) {
      blocks.push({
        type: "image",
        image_url: imageUrl,
        alt_text: "Attached image"
      });
    }

    if (buyLink) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*<${buyLink}|Buy now!>*`
        }
      });
    }
  } else if (blocksString && blocksString.trim() !== '') {
    // Fallback to raw JSON if Markdown is empty
    try {
      blocks = JSON.parse(blocksString);
    } catch (e) {
      await ack({
        response_action: 'errors',
        errors: {
          blocks_input: 'Invalid JSON format'
        }
      });
      return;
    }
  }

  await ack();

  try {
    await client.chat.update({
      channel: metadata.channel,
      ts: metadata.ts,
      text: fallbackText || 'Heidi update!',
      blocks: blocks
    });
  } catch (error) {
    console.error('Error updating message:', error);
    try {
      await client.chat.postEphemeral({
        channel: metadata.channel,
        user: body.user.id,
        text: `:warning: Failed to update message: ${error.message}`
      });
    } catch (e) {
      console.error(e);
    }
  }
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
        id: item.id,
        type: 'new',
        name: item.name,
        description: item.description,
        type_field: item.type,
        accessory_tag: item.accessory_tag,
        attached_shop_item_ids: item.attached_shop_item_ids,
        long_description: item.long_description,
        prices: item.ticket_cost,
          sale: item.sale_percentage,
        enabled: item.enabled,
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
      const saleChanged = (prevItem.sale_percentage || null) !== (item.sale_percentage || null);

      if (priceChanged || stockChanged || descriptionChanged || longDescChanged || nameChanged || photoChanged || saleChanged) {
        changes.push({
          id: item.id,
          type: 'update',
          name: item.name,
          type_field: item.type,
          accessory_tag: item.accessory_tag,
          attached_shop_item_ids: item.attached_shop_item_ids,
          description: item.description,
          oldPrices: prevItem.ticket_cost,
          newPrices: item.ticket_cost,
          oldEnabled: prevItem.enabled,
          newEnabled: item.enabled,
          oldStock: prevItem.stock,
          newStock: item.stock,
          priceChanged,
          stockChanged,
          saleChanged,
          oldSale: prevItem.sale_percentage,
          newSale: item.sale_percentage,
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

function formatPrices(prices, enabled, salePercentage) {
  if (!prices) return 'Unknown';
  
  const regions = Object.entries(prices).filter(
    ([key, price]) => {
      if (key === 'base_cost' || price == null) return false;
      const enabledKey = `enabled_${key}`;
      // Check if the region is enabled in the provided enabled object
      if (enabled && typeof enabled === 'object') {
        return enabled[enabledKey] !== false;
      }
      return true;
    }
  );
  if (regions.length === 0) return 'Unknown';
  const uniquePrices = new Set(regions.map(([_, price]) => price));

  if (uniquePrices.size === 1 && regions.length > 1) {
    const base = uniquePrices.values().next().value;
    if (salePercentage != null && salePercentage !== 0) {
      const discounted = Math.round((base * (100 - salePercentage) / 100) * 100) / 100;
      const dispDiscounted = Number.isInteger(discounted) ? discounted : discounted.toFixed(2);
      const dispBase = Number.isInteger(base) ? base : base.toFixed(2);
      return `~${dispBase}~ ${dispDiscounted} :ft-cookie: (${salePercentage}% off)`;
    }
    return `${base} :ft-cookie:`;
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
    .map(([country, price]) => {
      const dispBase = Number.isInteger(price) ? price : price.toFixed(2);
      if (salePercentage != null && salePercentage !== 0) {
        const discounted = Math.round((price * (100 - salePercentage) / 100) * 100) / 100;
        const dispDiscounted = Number.isInteger(discounted) ? discounted : discounted.toFixed(2);
        return `${countryEmojis[country] || country.toUpperCase()}: ~${dispBase}~ ${dispDiscounted} :ft-cookie: (${salePercentage}% off)`;
      }
      return `${countryEmojis[country] || country.toUpperCase()}: ${dispBase} :ft-cookie:`;
    })
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

function formatAccessoryGroups(accessories) {
  if (!accessories || accessories.length === 0) return '_No accessories_';

  // heuristic mapping for common accessory_tag -> user-friendly header
  const tagMap = {
    colour: 'Colour',
    color: 'Colour',
    colours: 'Colour',
    storage: 'Storage',
    size: 'Size',
    ram: 'Memory'
  };

  const guessCategory = (a) => {
    const tag = (a.accessory_tag || '').toString().trim().toLowerCase();
    if (tag) return tagMap[tag] || tag.replace(/[-_]/g, ' ').replace(/^./, s => s.toUpperCase());
    const name = (a.name || '').toString();
    if (/\b(GB|TB|Storage|256|512|1TB|500GB)\b/i.test(name)) return 'Storage';
    if (/\b(Space|Starlight|Blue|Purple|Grey|Silver|Black|White|Red|Green)\b/i.test(name)) return 'Colour';
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
    lines.push(`${cat}`);
    for (const a of groups[cat]) {
      lines.push(`${a.name}`);
      const base = a.ticket_cost && typeof a.ticket_cost.base_cost === 'number' && a.ticket_cost.base_cost > 0 ? a.ticket_cost.base_cost : null;
      if (base != null) lines.push(`:ft-cookie: ${base}`);
    }
    lines.push('');
  }

  return lines.join('\n');
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
      // Group accessory changes by the main item they attach to
      const accessoryChanges = changes.filter(c => c.type_field && String(c.type_field).includes('Accessory'));
      const accessoryChangesByMain = new Map();
      for (const acc of accessoryChanges) {
        const attached = Array.isArray(acc.attached_shop_item_ids) ? acc.attached_shop_item_ids.filter(Boolean) : [];
        for (const mainId of attached) {
          if (!accessoryChangesByMain.has(mainId)) accessoryChangesByMain.set(mainId, []);
          accessoryChangesByMain.get(mainId).push(acc);
        }
      }

      // Post accessory-change messages grouped by main item id
      for (const [mainId, accList] of accessoryChangesByMain.entries()) {
        const mainItem = data.find(i => i.id === mainId);
        if (!mainItem) continue;

        // find all current accessories attached to this main item
        const allCurrentAccessories = data.filter(i => Array.isArray(i.attached_shop_item_ids) && i.attached_shop_item_ids.filter(Boolean).includes(mainId) && String(i.type || '').toLowerCase().includes('accessory'));

        // find previous accessories attached to this main item (if cache exists)
        const prevMain = previousItems ? previousItems.find(i => i.id === mainId) : null;
        const prevAccessories = previousItems ? previousItems.filter(i => Array.isArray(i.attached_shop_item_ids) && i.attached_shop_item_ids.filter(Boolean).includes(mainId) && String(i.type || '').toLowerCase().includes('accessory')) : [];

        const accIds = accList.map(a => a.id).filter(Boolean);

        const formatAccLine = (a) => {
          const base = a.ticket_cost && typeof a.ticket_cost.base_cost === 'number' && a.ticket_cost.base_cost > 0 ? a.ticket_cost.base_cost : null;
          return base ? `${a.name}: ${base} :ft-cookie:` : `${a.name}`;
        };

        // show Before/Now for the accessories that actually changed (fall back to all attached accessories)
        const changedPrevAccessories = previousItems ? previousItems.filter(i => accIds.includes(i.id)) : [];
        const changedNowAccessories = data.filter(i => accIds.includes(i.id));
        const beforeLines = (changedPrevAccessories.length ? changedPrevAccessories : prevAccessories).map(formatAccLine).join('\n') || '_No accessories_';
        const nowLines = (changedNowAccessories.length ? changedNowAccessories : allCurrentAccessories).map(formatAccLine).join('\n') || '_No accessories_';

        // Determine Base price: prefer main item's base_cost when available (>0), otherwise use minimum of changed (or attached) accessories
        const mainBase = mainItem.ticket_cost && typeof mainItem.ticket_cost.base_cost === 'number' && mainItem.ticket_cost.base_cost > 0 ? mainItem.ticket_cost.base_cost : null;
        let minBase = null;
        if (mainBase != null) {
          minBase = mainBase;
        } else {
          const accBasesFromChanged = changedNowAccessories.length ? changedNowAccessories.map(a => (a.ticket_cost && typeof a.ticket_cost.base_cost === 'number' && a.ticket_cost.base_cost > 0) ? a.ticket_cost.base_cost : Infinity).filter(Number.isFinite) : [];
          const accBases = accBasesFromChanged.length ? accBasesFromChanged : allCurrentAccessories.map(a => (a.ticket_cost && typeof a.ticket_cost.base_cost === 'number' && a.ticket_cost.base_cost > 0) ? a.ticket_cost.base_cost : Infinity).filter(Number.isFinite);
          if (accBases.length) minBase = Math.min(...accBases);
        }

        // detect newly added accessories among the reported accessory changes
        const newAccs = accList.filter(a => a.type === 'new');
        const hasNewAccessories = newAccs.length > 0;

        const headerText = hasNewAccessories ? `<!channel> *Heidi found something new for ${mainItem.name}!* :ultrafastparrot: :flavortown: :yay:` : `<!channel> *Accessory changes for ${mainItem.name}*`;

        // If new accessories, omit the Before section and show all current accessories (with prices) under Now
        let blocks;
        if (hasNewAccessories) {
          const nowAll = formatAccessoryGroups(allCurrentAccessories);
          blocks = [
            { type: 'section', text: { type: 'mrkdwn', text: headerText } },
            { type: 'section', text: { type: 'mrkdwn', text: `*Now:*\n${nowAll}` } }
          ];
        } else {
          const beforeGrouped = formatAccessoryGroups((changedPrevAccessories.length ? changedPrevAccessories : prevAccessories));
          const nowGrouped = formatAccessoryGroups((changedNowAccessories.length ? changedNowAccessories : allCurrentAccessories));
          blocks = [
            { type: 'section', text: { type: 'mrkdwn', text: headerText } },
            { type: 'section', text: { type: 'mrkdwn', text: `*Before:*\n${beforeGrouped}` } },
            { type: 'section', text: { type: 'mrkdwn', text: `*Now:*\n${nowGrouped}` } }
          ];
        }

        if (minBase != null) {
          blocks.push({
            type: 'section',
            text: { type: 'mrkdwn', text: `*Base price:* ${minBase} :ft-cookie:` }
          });
        }

        // include main item image (no accessory images)
        if (mainItem.image_url) {
          blocks.push({
            type: 'image',
            image_url: mainItem.image_url,
            alt_text: mainItem.name
          });
        }

        blocks.push({
          type: 'section',
          text: { type: 'mrkdwn', text: `*<${SHOP_PAGE_URL.replace(/\/$/, '')}/order?shop_item_id=${mainItem.id}|Buy now!>*` }
        });

        await app.client.chat.postMessage({
          channel: SLACK_CHANNEL_ID,
          text: `Accessory changes for ${mainItem.name}`,
          blocks,
          link_names: true,
          unfurl_links: false,
          unfurl_media: false
        });
      }

      // Process non-accessory changes normally (but include accessory info only if accessories themselves changed)
      for (const change of changes.filter(c => !(c.type_field && String(c.type_field).includes('Accessory')))) {
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
                text: `*Prices:*\n${formatPrices(change.prices, change.enabled, change.sale)}`
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

          if (change.long_description) {
            blocks.push({
              type: "section",
              text: {
                type: "mrkdwn",
                text: `*Description:* \n${markdownToSlack(truncate(change.long_description, 2000))}`
              }
            });
          }
          if (change.sale != null) {
            blocks.splice(1, 0, {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `*Sale:* ${change.sale}% off`
              }
            });
          }
        } else if (change.type === 'update') {
          messageText = `Heidi noticed a change for ${change.name}!`;
          let updateDetails = '';
          let priceDetails = '';
          if (change.priceChanged) {
            priceDetails = `*Prices changed:*\n*Before:*\n${formatPrices(change.oldPrices, change.oldEnabled, change.oldSale)}\n*Now:*\n${formatPrices(change.newPrices, change.newEnabled, change.newSale)}\n`;
          } else {
            priceDetails = `*Current Prices:*\n${formatPrices(change.newPrices, change.newEnabled, change.newSale)}\n`;
          }

          if (change.stockChanged) {
            updateDetails += `*Stock changed:* ${change.oldStock ?? 'Unlimited'} -> ${change.newStock ?? 'Unlimited'} left!\n`;
          }
          if (change.saleChanged) {
            if (change.oldSale == null && change.newSale != null) {
              updateDetails += `*Sale started:* ${change.newSale}% off\n`;
            } else if (change.oldSale != null && change.newSale == null) {
              updateDetails += `*Sale removed:* was ${change.oldSale}%\n`;
            } else {
              updateDetails += `*Sale changed:* ${change.oldSale}% -> ${change.newSale}%\n`;
            }
          }
          if (change.descriptionChanged) {
            updateDetails += `*Description changed:*\n*Before:*\n${markdownToSlack(truncate(change.oldDescription))}\n*Now:*\n${markdownToSlack(truncate(change.newDescription))}\n`;
          }
          // Long description changes handled in separate blocks below
          if (change.nameChanged) {
            updateDetails += `*Name changed:* ${truncate(change.oldName, 120)} -> ${truncate(change.newName, 120)}\n`;
          }
          if (change.photoChanged) {
            updateDetails += `*Image updated.*\n`;
          }

          let headerText = `<!channel> *Heads up!* Heidi noticed some changes for *${change.name}*! :huh:`;
          if (updateDetails) {
            headerText += `\n\n${updateDetails}`;
          }

          blocks = [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: headerText
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

          if (change.saleChanged && !updateDetails.includes('*Sale')) {
            let saleText = '';
            if (change.newSale == null) saleText = `Sale removed (was ${change.oldSale}%)`;
            else if (change.oldSale == null) saleText = `Sale started: ${change.newSale}% off`;
            else saleText = `Sale: ${change.oldSale}% -> ${change.newSale}%`;
            blocks.splice(2, 0, {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `*Sale:* ${saleText}`
              }
            });
          }

          // Always include current stock in the message
          blocks.push({
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Stock:* ${change.newStock ?? 'Unlimited'} left!`
            }
          });

          if (change.longDescChanged) {
            blocks.push({
              type: "section",
              text: {
                type: "mrkdwn",
                text: "*Long description changed:*"
              }
            });
            blocks.push({
              type: "section",
              text: {
                type: "mrkdwn",
                text: `*Before:*\n${markdownToSlack(truncate(change.oldLongDescription, 2000))}`
              }
            });
            blocks.push({
              type: "section",
              text: {
                type: "mrkdwn",
                text: `*Now:*\n${markdownToSlack(truncate(change.newLongDescription, 2000))}`
              }
            });
          }
        }

        if (change.photo) {
          blocks.push({
            type: "image",
            image_url: change.photo,
            alt_text: change.name
          });
        }

        // Show accessory info only if any accessory attached to this main item has a reported change
        try {
          const accChangesForThisMain = accessoryChangesByMain.get(change.id) || [];
          if (accChangesForThisMain.length) {
            const accText = accChangesForThisMain.map(a => {
              const base = a.ticket_cost && typeof a.ticket_cost.base_cost === 'number' ? a.ticket_cost.base_cost : null;
              return base && base > 0 ? `${a.name}: ${base} :ft-cookie:` : `${a.name}`;
            }).join('\n');
            blocks.splice(blocks.length - 1, 0, {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*Accessory changes:*
${accText}`
              }
            });
            // compute and show min base price among main and changed accessories
            const mainBase = change.newPrices && typeof change.newPrices.base_cost === 'number' && change.newPrices.base_cost > 0 ? change.newPrices.base_cost : (change.prices && typeof change.prices.base_cost === 'number' && change.prices.base_cost > 0 ? change.prices.base_cost : Infinity);
            const accBases = accChangesForThisMain.map(a => (a.ticket_cost && typeof a.ticket_cost.base_cost === 'number' && a.ticket_cost.base_cost > 0) ? a.ticket_cost.base_cost : Infinity).filter(Number.isFinite);
            const allBases = [mainBase, ...accBases].filter(Number.isFinite);
            if (allBases.length) {
              const minBase = Math.min(...allBases);
              blocks.splice(blocks.length - 1, 0, {
                type: 'section',
                text: { type: 'mrkdwn', text: `*Min base price:* ${minBase} :ft-cookie:` }
              });
            }
          }
        } catch (e) {
          // ignore accessory rendering errors
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
