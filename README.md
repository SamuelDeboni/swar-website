# SWAR Website

A static website hosted on GitHub Pages.

## 🚀 Setup

This repository is configured to automatically deploy to GitHub Pages using GitHub Actions.

### Prerequisites

1. Ensure GitHub Pages is enabled in repository settings
2. Set the source to "GitHub Actions" in Settings → Pages

### Deployment

The website automatically deploys to GitHub Pages when changes are pushed to the `main` branch.

**Workflow file**: `.github/workflows/deploy.yml`

### Manual Deployment

You can also trigger a manual deployment:
1. Go to the "Actions" tab in GitHub
2. Select "Deploy to GitHub Pages" workflow
3. Click "Run workflow"

## 🌐 Accessing the Website

Once deployed, your website will be available at:
```
https://samueldeboni.github.io/swar-website/
```

## 📝 Making Changes

1. Edit `index.html` or add new HTML/CSS/JS files
2. Commit and push changes to the `main` branch
3. GitHub Actions will automatically deploy the updates

## 🛠️ Local Development

To view the website locally:
```bash
# Simple HTTP server with Python
python -m http.server 8000

# Or with Node.js
npx http-server
```

Then open `http://localhost:8000` in your browser.