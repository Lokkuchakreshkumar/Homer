# Homer

Homer is a browser extension that finds text on web pages by meaning rather than exact string matches.

## Quick install

You do not need Node.js or a build toolchain to run Homer. The pre-built extension lives in `extension/dist/`.

1. Clone the repository:
   ```bash
   git clone https://github.com/Lokkuchakreshkumar/Homer.git
   ```
2. Open `chrome://extensions` in Chrome, Brave, or Edge.
3. Turn on the **Developer mode** toggle.
4. Click **Load unpacked**.
5. Select the `extension/dist` directory.
6. Pin Homer to the browser toolbar.

## Connect the backend proxy

The extension connects to a local or remote proxy server to score passages.

1. Click the Homer icon in the toolbar.
2. Click **Advanced Configuration**.
3. Set **Proxy Service URL**:
   - For a hosted Render instance: `https://your-service.onrender.com`
   - For local development: `http://127.0.0.1:8787`
4. The status badge indicates connection state.

## Usage

- Press `Ctrl+F` (`Cmd+F` on macOS) on any page to open the Homer bar.
- Type a conceptual question or query, such as "where is the corporate headquarters" or "refund policy details".
- Homer scores passages on the active page and highlights the strongest matches.
- `Enter` steps to the next match.
- `Shift+Enter` steps to the previous match.
- `Esc` closes the bar.

## Build and run locally

### Extension
```bash
cd extension
npm install
npm run build
```

### Server
```bash
cd server
npm install
cp .env.example .env
npm run dev
```

The local proxy listens on `http://127.0.0.1:8787` and serves an interactive search sandbox at `http://127.0.0.1:8787/`.

## Deploy the server to Render

The `server/` directory contains `Dockerfile` and `render.yaml` configurations for Render:

1. Create a **Web Service** on Render connected to this repository.
2. Set the root directory to `server`.
3. Add the `TYPESAFE_API_KEY` environment variable in the Render dashboard.
4. Copy the assigned URL into the extension's **Proxy Service URL** setting.

## Capabilities

- Shadow DOM isolation prevents host page CSS from altering the search bar.
- Monochrome design system (`#ffffff`, `#09090b`, `#e4e4e7`).
- Native keyboard interception for `Ctrl+F` and navigation keys.
- Configurable debounce timeout and per-host exclusion lists.
- Interactive test sandbox at `/` on the proxy server.
