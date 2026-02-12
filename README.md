# Heidi the Waitress

**Heidi serves you the dish! Heidi has different jobs, apart from telling you the updates on your project and paying you cookies, she has got a part time job. Ye, watch the menu and tell you if there's any changes on the menu! **

> TL:DR. Heidi the Waitress is a shop tracker slack bot of the shop in flavortown

## How it work
Heidi the Waitress is a slack bot that tracks the menu of the shop in flavortown. She will notify you when there's any changes on the menu.

## Installation
1. Clone the repository obviously

2. Install the dependencies
```bash
npm install
```

3. Set up the environment variables
```
You need to set up the following environment variables:
- SLACK_BOT_TOKEN=xoxb-your-token
- SLACK_SIGNING_SECRET=your-signing-secret
- SLACK_APP_TOKEN=xapp-your-app-token
- FLAVORTOWN_API_URL=https://flavortown.hackclub.com
- FETCH_INTERVAL_MS=300000  Default 5 minutes
- FLAVORTOWN_API_KEY=your-flavortown-api-key
- SLACK_CHANNEL_URL=https://hackclub.enterprise.slack.com/archives/C0123456789
- SHOP_PAGE_URL=https://flavortown.hackclub.com/shop
```

4. Run the bot
```bash
npm run start
```
