# English Reader - Indian Voices

A web app that reads text word-by-word with Indian English voices. Supports typing, pasting, and uploading files (.txt, .docx, .pdf, images).

## Features

- **Text Input** — Type, paste, or upload files
- **File Extraction** — .txt, .docx (mammoth.js), .pdf (pdf.js), images via OCR (tesseract.js)
- **Indian English Voices** — Browser TTS with en-IN voice prioritization
- **Piper Offline TTS** — Download ONNX voice models, cached in OPFS for offline use
- **Word-by-Word Reading** — Configurable pause (0.5s–2.0s) between words
- **Speed Control** — 0.5x to 2.0x speech rate
- **Pause & Resume** — Resumes from exact position
- **Mobile Optimized** — Touch-friendly, works on Android Chrome
- **Dark Mode** — Automatic based on system preference

## How to Use

1. Open the app in a browser (Chrome recommended)
2. Type/paste text or upload a file
3. Select a voice and adjust pause/speed settings
4. Click Play

### Offline Mode (Piper TTS)

1. Switch to "Piper Offline" engine
2. Select a voice and click "Download Voice Model"
3. The model downloads from HuggingFace and caches in your browser
4. Once downloaded, works without internet

## Hosting on GitHub Pages

1. Push this repo to GitHub
2. Go to **Settings > Pages**
3. Set source to **Deploy from a branch** > **main** > **/ (root)**
4. Your app will be live at `https://<username>.github.io/<repo>/`

## Files

```
index.html  — Main page
style.css   — Styles (mobile-first, dark mode)
app.js      — Application logic (TTS, file extraction, playback)
README.md   — This file
```

## Tech Stack

- Web Speech API (browser TTS)
- piper-tts-web (offline WASM TTS)
- mammoth.js (DOCX extraction)
- pdf.js (PDF extraction)
- tesseract.js (image OCR)
- Origin Private File System (model caching)

All libraries loaded from CDN — no build step required.
