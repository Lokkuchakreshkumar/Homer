# Homer 🔍

> **AI-powered browser extension for conceptual find and semantic search.**
> Search webpages by meaning, concept, and intent — not just exact keywords.

---

## ⚡ Quick Install (Load Unpacked in Chrome)

You do **not** need Node.js or any build tools to install and use Homer. A pre-compiled build is included in the `extension/dist/` directory.

1. **Clone or Download** this repository:
   ```bash
   git clone https://github.com/Lokkuchakreshkumar/Homer.git
   ```
2. Open Google Chrome (or any Chromium browser like Brave, Edge, Arc) and go to:
   ```text
   chrome://extensions
   ```
3. Enable **Developer mode** using the toggle in the top-right corner.
4. Click **Load unpacked** in the top-left corner.
5. Select the **`extension/dist`** folder inside this repository.
6. Pin **Homer** to your browser toolbar!

---

## 🌐 Connecting to the Backend Proxy

Homer uses a lightweight backend proxy to securely execute AI rankings:

1. Click the **Homer** icon in your toolbar to open the extension popup.
2. Click **Advanced Configuration** to reveal the proxy settings.
3. Enter your backend URL in **Proxy Service URL**:
   - If using a hosted Render deployment: `https://your-service.onrender.com`
   - If using local dev server: `http://127.0.0.1:8787`
4. The status indicator will turn online once connected.

---

## ⌨️ How to Use

- **Activate**: Press **`Ctrl+F`** (or **`Cmd+F`** on macOS) on any webpage.
- **Search by Meaning**: Type naturally (e.g., *"where is the CEO's office"*, *"how does pricing work"*). Homer highlights the most relevant passages even when exact words differ.
- **Navigate**:
  - `Enter`: Next match
  - `Shift + Enter`: Previous match
  - `Esc`: Close search bar

---

## 🛠️ Building & Running Locally

### Extension
```bash
cd extension
npm install
npm run build
```

### Server (Deploy to Render or Run Locally)
```bash
cd server
npm install
cp .env.example .env
npm run dev
```

---

## 🚀 Deploying Server to Render

The `server/` directory is 100% ready for instant deployment to [Render](https://render.com):
1. Create a new **Web Service** on Render and point it to this repo.
2. Set Root Directory to `server` (or let Render use `server/Dockerfile` / `server/render.yaml`).
3. Add your `TYPESAFE_API_KEY` in Render environment variables.
4. Render will provide a live HTTPS URL (e.g., `https://your-homer-server.onrender.com`).
5. In Homer extension popup → **Advanced Configuration** → paste your Render URL in **Proxy Service URL**.

---

## Features

- **Semantic Find**: Floating search bar running inside an encapsulated Shadow DOM.
- **Pure White Monochrome Aesthetic**: Clean `#ffffff` / `#09090b` UI with `#e4e4e7` borders.
- **Keyboard Shortcuts**: Native interception for `Ctrl+F` / `Cmd+F`, `Enter` for next, `Shift+Enter` for previous, `Esc` to dismiss.
- **Privacy & Controls**: Debounce sensitivity slider, ignore hosts lists, and proxy health telemetry.
- **Interactive Playground**: Served directly at the server root (`http://127.0.0.1:8787/`) for sandbox testing.

