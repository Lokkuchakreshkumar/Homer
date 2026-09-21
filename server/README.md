# Homer Server (Deploy to Render)

This is the private backend proxy for **Homer**. It holds your TypeSafe API credentials, performs semantic search ranking using the Jev model, manages LRU caches, and serves the interactive Web Playground.

---

## 🚀 Deploying Directly to Render

You can deploy this server to [Render](https://render.com) in under 2 minutes.

### Method 1: Deploy with Docker (Recommended)

1. Push this folder to a GitHub repository (can be private).
2. Go to your [Render Dashboard](https://dashboard.render.com/) and click **New +** → **Web Service**.
3. Connect your GitHub repository.
4. Render will auto-detect the `Dockerfile` inside this folder.
5. In the **Environment Variables** section, add:
   - `TYPESAFE_API_KEY`: Your key from [TypeSafe Console](https://console.typesafe.ai/keys)
   - `HOST`: `0.0.0.0`
6. Click **Deploy Web Service**.

---

### Method 2: Deploy with Render Blueprint (`render.yaml`)

1. Go to [Render Blueprints](https://dashboard.render.com/blueprints).
2. Click **New Blueprint Instance**.
3. Select your repository. Render will automatically configure the service and health checks using `render.yaml`.
4. Enter your `TYPESAFE_API_KEY` when prompted.
5. Click **Apply**.

---

## 🔍 Verifying Your Deployment

Once deployed, Render gives you a live HTTPS URL (e.g. `https://homer-server.onrender.com`):

1. **Test Health Endpoint**:
   ```bash
   curl https://your-service.onrender.com/v1/health
   # Response: {"mode":"jev","model":"jev-latest","version":"0.1.0"}
   ```
2. **Open Web Playground**:
   Navigate to `https://your-service.onrender.com/` in your browser to interact with the search playground.

3. **Connect Your Extension**:
   Open the Homer extension popup in Chrome → expand **Advanced Configuration** → enter your Render URL in **Proxy Service URL**.
