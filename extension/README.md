# Homer - AI Semantic Search Chrome Extension 🔍

> **A browser extension that lets you search webpages by meaning and concept, not just exact keywords.**
> Powered by System One AI.

---

## ⚡ Quick Install (Install in 30 Seconds)

You do **not** need Node.js or any build tools to install and use this extension. A pre-compiled build is included in the `dist/` directory.

1. **Download / Clone** this repository to your computer.
2. Open Google Chrome (or any Chromium browser like Brave, Edge, Arc) and go to:
   ```text
   chrome://extensions
   ```
3. Enable **Developer mode** using the toggle in the top-right corner.
4. Click the **Load unpacked** button in the top-left.
5. Select the **`dist`** folder inside this directory (`extension/dist`).

*That is it! Homer is now installed and active in your browser.*

---

## 🌐 Connecting to the Server

Homer uses a lightweight backend proxy to securely run AI rankings without exposing API keys:

1. Click the **Homer** puzzle icon in your Chrome toolbar to open the popup.
2. Click **Advanced Configuration** to expand the settings drawer.
3. In **Proxy Service URL**, enter the backend URL:
   - If using the hosted public server: enter the provided URL (e.g. `https://your-server.onrender.com`).
   - If running locally: enter `http://127.0.0.1:8787`.
4. The proxy status indicator at the top will turn from grey to dark when connected.

---

## ⌨️ How to Use

- **Activate**: Press **`Ctrl+F`** (or **`Cmd+F`** on macOS) on any standard webpage.
- **Search conceptually**: Type what you are looking for in plain language, even if the exact words are not on the page.
  - Example: Search for *"how do spacecraft land"* on an aerospace article.
  - Example: Search for *"executive compensation"* on a corporate report.
- **Navigate**:
  - `Enter`: Next match
  - `Shift + Enter`: Previous match
  - `Esc`: Close search bar

---

## 🛠️ Building From Source (For Developers)

If you want to modify the extension or build it yourself:

```bash
# 1. Install dependencies
npm install

# 2. Build the extension bundle
npm run build

# 3. Watch for changes during development
npm run watch
```

The compiled files will output directly into the `dist/` folder.
