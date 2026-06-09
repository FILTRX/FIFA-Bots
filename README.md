# FIFA WC 2026 Ticket Bot

A Chrome extension for FIFA World Cup 2026 resale ticket monitoring.

Automatically scans FIFA resale seat maps, finds the cheapest adjacent tickets matching your preferences, selects them, and adds them to the cart.

---

## Features

- Automatically monitors FIFA resale seat maps
- Intercepts seat availability directly from STX network responses
- Finds the cheapest adjacent seats
- Filters tickets by:
  - Category
  - Minimum price
  - Maximum price
  - Number of adjacent tickets
- Automatically selects matching seats on the map
- Automatically clicks **Add to cart**
- Built-in floating control panel on FIFA pages
- Popup configuration interface
- Saves settings between sessions
- Automatically resumes after page reloads
- Supports up to 3 Performance IDs simultaneously

---

## Supported Websites

- `https://fwc26-resale-usd.tickets.fifa.com`
  
---

## Installation

1. Download or clone this repository
2. Open Chrome and navigate to:
   ```
   chrome://extensions
   ```
3. Enable **Developer Mode** (top right toggle)
4. Click **Load unpacked**
5. Select the extension folder
6. The FIFA Ticket Bot icon will appear in your Chrome toolbar

---

## How to Use

1. Open a FIFA resale match seat map page:
   ```
   https://fwc26-resale-usd.tickets.fifa.com/secure/selection/event/seat/performance/<PERFORMANCE_ID>/lang/en
   ```

2. Click the extension icon in the toolbar

3. Configure your preferences:
   - **Performance IDs** — the match ID(s) from the URL (up to 3)
   - **Seat category** — e.g. Category 3
   - **Tickets needed** — number of adjacent seats
   - **Min price / Max price** — price range in USD (set 0 for no limit)
   - **Polling interval** — how often to refresh (seconds)

4. Press **Start Bot**

5. Keep the FIFA tab open and active

The bot will automatically:
- Collect available seat data from the seat map
- Search for the cheapest adjacent group matching your filters
- Select matching tickets on the map
- Click **Add to cart**
- Stop when tickets reach the cart page

---

## How It Works

The extension injects two scripts into FIFA pages:

- **`interceptor.js`** — runs in the page's main world at `document_start`, before any other scripts including anti-bot protection. Hooks into `XMLHttpRequest` to intercept STX seat availability responses and stores data in a hidden DOM element accessible from both worlds.

- **`content.js`** — runs in the isolated extension world. Reads intercepted data, applies filters, dispatches STX Custom Events to select seats, and clicks the cart button.

### Workflow

```
Page loads
    ↓
interceptor.js hooks XHR before Datadome loads
    ↓
Bot triggers selectBlockByAvailabilities event
    ↓
STX widget fetches /seats/free/ol → interceptor captures response
    ↓
content.js reads seat data from DOM storage
    ↓
Filter by category + price range
    ↓
Find cheapest N adjacent seats in same block/row
    ↓
Dispatch selectSeatsByIds → STX selects seats on map
    ↓
Wait for Add to cart button → click
    ↓
Redirect to cart → bot stops
```

---

## Project Structure

```
fifa_extension/
├── manifest.json
├── icons/
│   └── icon48.png
└── src/
    ├── interceptor.js    # XHR hook (MAIN world, document_start)
    ├── content.js        # Bot logic (ISOLATED world)
    ├── background.js     # Service worker
    └── popup/
        ├── popup.html
        └── popup.js
```

---

## Important Notes

- The extension only works while the FIFA tab remains **open and visible**
- You must be **logged into your FIFA account** before starting the bot
- Set **Max price to 0** to disable the price ceiling (bot will take any price)
- The bot finds the cheapest adjacent group — if none exist at the minimum price, it will retry on the next interval
- FIFA and STX may update their website structure at any time, which may require extension updates

---
