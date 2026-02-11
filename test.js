require('dotenv').config();
const { WebClient } = require('@slack/web-api');

const token = process.env.SLACK_BOT_TOKEN;
const client = new WebClient(token);

function getChannelId(input) {
  if (!input) return null;
  const match = input.match(/archives\/([A-Z0-9]+)/i);
  return match ? match[1] : input;
}

const channelId = getChannelId(process.env.SLACK_CHANNEL_URL);

(async () => {
  try {
    if (!channelId) {
      console.error('No SLACK_CHANNEL_URL found in .env');
      process.exit(1);
    }

    console.log(`Sending test message to ${channelId}...`);
    const result = await client.chat.postMessage({
      channel: channelId,
      text: "<!channel> Test Hello World from Heidi! :ultrafastparrot: :flavortown: (This message will self-destruct in 10 seconds...)"
    });

    console.log('Message sent! Waiting 10 seconds to delete...');

    setTimeout(async () => {
      try {
        await client.chat.delete({
          channel: channelId,
          ts: result.ts
        });
        console.log('Test message deleted successfully! ✨');
        process.exit(0);
      } catch (error) {
        console.error('Error deleting message:', error.message);
        process.exit(1);
      }
    }, 10000);

  } catch (error) {
    console.error('Error in test script:', error.message);
    process.exit(1);
  }
})();
