// English Reader - Complete Rewrite
// Features: Web Speech API + Piper Offline TTS, file extraction, proper pause/resume

// ─── Text Extraction ──────────────────────────────────────────────────────────

async function extractText(file) {
    const name = file.name.toLowerCase();
    const type = file.type;

    if (file.size > 10 * 1024 * 1024) {
        throw new Error('File too large (max 10 MB)');
    }

    if (type.startsWith('text/') || name.endsWith('.txt')) {
        return readAsText(file);
    }
    if (name.endsWith('.docx')) {
        return extractDocx(file);
    }
    if (type === 'application/pdf' || name.endsWith('.pdf')) {
        return extractPdf(file);
    }
    if (type.startsWith('image/')) {
        return extractImage(file);
    }
    throw new Error('Unsupported format. Use .txt, .docx, .pdf, or image files.');
}

function readAsText(file) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(new Error('Failed to read file'));
        r.readAsText(file);
    });
}

async function extractDocx(file) {
    if (typeof mammoth === 'undefined') {
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.8.0/mammoth.browser.min.js');
    }
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value;
}

async function extractPdf(file) {
    if (!window.pdfjsLib) {
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs', true);
        window.pdfjsLib = globalThis.pdfjsLib;
    }
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let text = '';
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map(item => item.str).join(' ') + '\n';
    }
    return text;
}

async function extractImage(file) {
    if (!window.Tesseract) {
        await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js');
    }
    const worker = await Tesseract.createWorker('eng');
    const { data: { text } } = await worker.recognize(file);
    await worker.terminate();
    return text;
}

function loadScript(src, isModule = false) {
    return new Promise((resolve, reject) => {
        const el = document.createElement('script');
        el.src = src;
        if (isModule) el.type = 'module';
        el.onload = resolve;
        el.onerror = () => reject(new Error(`Failed to load: ${src}`));
        document.head.appendChild(el);
    });
}

// ─── OPFS Storage Helpers ─────────────────────────────────────────────────────

const OPFS = {
    async getDir(name) {
        const root = await navigator.storage.getDirectory();
        return root.getDirectoryHandle(name, { create: true });
    },
    async has(dirName, fileName) {
        try {
            const dir = await this.getDir(dirName);
            await dir.getFileHandle(fileName);
            return true;
        } catch { return false; }
    },
    async read(dirName, fileName) {
        const dir = await this.getDir(dirName);
        const fh = await dir.getFileHandle(fileName);
        const file = await fh.getFile();
        return file.arrayBuffer();
    },
    async write(dirName, fileName, data) {
        const dir = await this.getDir(dirName);
        const fh = await dir.getFileHandle(fileName, { create: true });
        const writable = await fh.createWritable();
        await writable.write(data);
        await writable.close();
    }
};

// ─── Piper TTS Engine ─────────────────────────────────────────────────────────

class PiperTTS {
    constructor() {
        this.engine = null;
        this.ready = false;
        this.loading = false;
        this.currentVoice = null;
        this.audioCtx = null;
    }

    async init(voiceId, onProgress) {
        if (this.loading) return;
        this.loading = true;
        this.ready = false;

        try {
            // Dynamic import from esm.sh CDN
            const mod = await import('https://esm.sh/piper-tts-web@1.1.2');
            const { PiperWebEngine } = mod;

            if (onProgress) onProgress(10, 'Initializing TTS engine...');

            // Check if model is cached in OPFS
            const modelFile = voiceId + '.onnx';
            const configFile = voiceId + '.onnx.json';
            const opfsDir = 'piper-models';
            let modelData, configData;

            const hasCached = await OPFS.has(opfsDir, modelFile);

            if (hasCached) {
                if (onProgress) onProgress(20, 'Loading cached model...');
                modelData = await OPFS.read(opfsDir, modelFile);
                configData = await OPFS.read(opfsDir, configFile);
                if (onProgress) onProgress(80, 'Model loaded from cache');
            } else {
                // Download from HuggingFace
                const baseUrl = this._getModelUrl(voiceId);

                if (onProgress) onProgress(15, 'Downloading voice model...');
                const modelResp = await fetch(baseUrl + modelFile);
                if (!modelResp.ok) throw new Error('Failed to download model: ' + modelResp.status);
                modelData = await modelResp.arrayBuffer();

                if (onProgress) onProgress(60, 'Downloading config...');
                const configResp = await fetch(baseUrl + configFile);
                if (!configResp.ok) throw new Error('Failed to download config: ' + configResp.status);
                configData = await configResp.arrayBuffer();

                // Cache in OPFS
                if (onProgress) onProgress(70, 'Caching for offline use...');
                await OPFS.write(opfsDir, modelFile, modelData);
                await OPFS.write(opfsDir, configFile, configData);
                if (onProgress) onProgress(80, 'Cached in OPFS');
            }

            // Create engine
            if (onProgress) onProgress(85, 'Loading into TTS engine...');

            const modelBlob = new Blob([modelData], { type: 'application/octet-stream' });
            const configBlob = new Blob([configData], { type: 'application/json' });

            this.engine = new PiperWebEngine();
            await this.engine.init(modelBlob, configBlob);

            this.currentVoice = voiceId;
            this.ready = true;
            if (onProgress) onProgress(100, 'Ready!');

        } catch (err) {
            console.error('Piper init failed:', err);
            throw err;
        } finally {
            this.loading = false;
        }
    }

    _getModelUrl(voiceId) {
        // voiceId format: "en_GB-jenny_dioco-medium"
        const parts = voiceId.split('-');
        const lang = parts[0]; // en_GB
        const langShort = lang.split('_')[0]; // en
        const name = parts.slice(1, -1).join('-'); // jenny_dioco
        const quality = parts[parts.length - 1]; // medium
        return `https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/${langShort}/${lang}/${name}/${quality}/`;
    }

    async speak(text) {
        if (!this.ready || !this.engine) throw new Error('Piper not ready');

        const result = await this.engine.generate(text, this.currentVoice, 0);
        if (!result || !result.file) throw new Error('No audio generated');

        return new Promise((resolve, reject) => {
            const audio = new Audio();
            audio.src = URL.createObjectURL(result.file);
            audio.onended = () => {
                URL.revokeObjectURL(audio.src);
                resolve();
            };
            audio.onerror = () => {
                URL.revokeObjectURL(audio.src);
                reject(new Error('Audio playback failed'));
            };
            audio.play().catch(reject);
        });
    }
}

// ─── Browser TTS (Web Speech API) ─────────────────────────────────────────────

class BrowserTTS {
    constructor() {
        this.voices = [];
        this.selectedVoice = null;
        this.loaded = false;
        this.rate = 1.0;
    }

    init() {
        return new Promise((resolve) => {
            const tryLoad = () => {
                const v = speechSynthesis.getVoices();
                if (v.length > 0) {
                    this.voices = v;
                    this.loaded = true;
                    resolve();
                    return true;
                }
                return false;
            };

            if (tryLoad()) return;

            speechSynthesis.addEventListener('voiceschanged', () => tryLoad());

            // Polling fallback for Android Chrome
            let attempts = 0;
            const poll = () => {
                if (this.loaded || attempts++ > 50) { resolve(); return; }
                if (!tryLoad()) setTimeout(poll, 100);
            };
            setTimeout(poll, 100);
        });
    }

    getVoicesSorted() {
        return [...this.voices].sort((a, b) => {
            return this._score(b) - this._score(a);
        });
    }

    _score(v) {
        let s = 0;
        const lang = v.lang.toLowerCase();
        const name = v.name.toLowerCase();
        if (lang.includes('en-in')) s += 100;
        if (lang.includes('hi-in')) s += 90;
        if (name.includes('indian')) s += 80;
        if (name.includes('india')) s += 70;
        if (lang.includes('en-us')) s += 50;
        if (lang.includes('en-gb')) s += 40;
        if (lang.startsWith('en')) s += 30;
        return s;
    }

    selectVoice(voice) {
        this.selectedVoice = voice;
    }

    speak(word) {
        return new Promise((resolve) => {
            // Cancel any stuck utterances first
            speechSynthesis.cancel();

            const u = new SpeechSynthesisUtterance(word);
            if (this.selectedVoice) {
                u.voice = this.selectedVoice;
                u.lang = this.selectedVoice.lang;
            }
            u.rate = this.rate;
            u.pitch = 1.0;
            u.volume = 1.0;
            u.onend = () => resolve();
            u.onerror = () => resolve();
            speechSynthesis.speak(u);
        });
    }
}

// ─── Main Application ─────────────────────────────────────────────────────────

class ReadingApp {
    constructor() {
        this.browserTTS = new BrowserTTS();
        this.piperTTS = new PiperTTS();
        this.engine = 'browser'; // 'browser' or 'piper'

        this.words = [];
        this.wordIndex = 0;
        this.isPlaying = false;
        this.isPaused = false;
        this.pauseMs = 1000;
        this.speed = 1.0;
        this._abortController = null;

        this._bindElements();
        this._bindEvents();
        this._initVoices();
    }

    // ── Setup ──

    _bindElements() {
        this.els = {
            textInput: document.getElementById('textInput'),
            fileInput: document.getElementById('fileInput'),
            uploadArea: document.getElementById('uploadArea'),
            uploadProgress: document.getElementById('uploadProgress'),
            progressFill: document.getElementById('progressFill'),
            progressText: document.getElementById('progressText'),
            voiceSelect: document.getElementById('voiceSelect'),
            piperVoiceSelect: document.getElementById('piperVoiceSelect'),
            pauseSlider: document.getElementById('pauseSlider'),
            pauseValue: document.getElementById('pauseValue'),
            speedSlider: document.getElementById('speedSlider'),
            speedValue: document.getElementById('speedValue'),
            playBtn: document.getElementById('playBtn'),
            pauseResumeBtn: document.getElementById('pauseResumeBtn'),
            stopBtn: document.getElementById('stopBtn'),
            readingStatus: document.getElementById('readingStatus'),
            readingProgress: document.getElementById('readingProgress'),
            btnEngineBrowser: document.getElementById('btnEngineBrowser'),
            btnEnginePiper: document.getElementById('btnEnginePiper'),
            browserVoicePanel: document.getElementById('browserVoicePanel'),
            piperVoicePanel: document.getElementById('piperVoicePanel'),
            downloadVoiceBtn: document.getElementById('downloadVoiceBtn'),
            piperStatus: document.getElementById('piperStatus'),
            modelProgress: document.getElementById('modelProgress'),
            modelProgressFill: document.getElementById('modelProgressFill'),
            modelProgressText: document.getElementById('modelProgressText'),
            statusToast: document.getElementById('statusToast'),
            toastIcon: document.getElementById('toastIcon'),
            toastText: document.getElementById('toastText'),
            loadingOverlay: document.getElementById('loadingOverlay'),
            loadingText: document.getElementById('loadingText'),
        };
    }

    _bindEvents() {
        // File upload
        this.els.fileInput.addEventListener('change', (e) => {
            if (e.target.files[0]) this._handleFile(e.target.files[0]);
        });
        this.els.uploadArea.addEventListener('click', (e) => {
            if (e.target === this.els.fileInput) return;
            this.els.fileInput.click();
        });
        this.els.uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            this.els.uploadArea.classList.add('dragover');
        });
        this.els.uploadArea.addEventListener('dragleave', (e) => {
            e.preventDefault();
            this.els.uploadArea.classList.remove('dragover');
        });
        this.els.uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            this.els.uploadArea.classList.remove('dragover');
            if (e.dataTransfer.files[0]) this._handleFile(e.dataTransfer.files[0]);
        });

        // Controls
        this.els.pauseSlider.addEventListener('input', (e) => {
            this.pauseMs = parseFloat(e.target.value) * 1000;
            this.els.pauseValue.textContent = parseFloat(e.target.value).toFixed(1);
        });
        this.els.speedSlider.addEventListener('input', (e) => {
            this.speed = parseFloat(e.target.value);
            this.els.speedValue.textContent = parseFloat(e.target.value).toFixed(1);
            this.browserTTS.rate = this.speed;
        });
        this.els.voiceSelect.addEventListener('change', (e) => {
            const idx = parseInt(e.target.value);
            if (!isNaN(idx)) {
                this.browserTTS.selectVoice(this.browserTTS.voices[idx]);
            }
        });

        // Playback
        this.els.playBtn.addEventListener('click', () => this.play());
        this.els.pauseResumeBtn.addEventListener('click', () => this.togglePauseResume());
        this.els.stopBtn.addEventListener('click', () => this.stop());

        // Engine toggle
        this.els.btnEngineBrowser.addEventListener('click', () => this._setEngine('browser'));
        this.els.btnEnginePiper.addEventListener('click', () => this._setEngine('piper'));

        // Piper download
        this.els.downloadVoiceBtn.addEventListener('click', () => this._downloadPiperVoice());
    }

    async _initVoices() {
        await this.browserTTS.init();
        this._populateVoiceSelect();
    }

    _populateVoiceSelect() {
        const select = this.els.voiceSelect;
        select.innerHTML = '';

        if (this.browserTTS.voices.length === 0) {
            select.innerHTML = '<option value="">No voices found</option>';
            return;
        }

        const sorted = this.browserTTS.getVoicesSorted();
        sorted.forEach((voice) => {
            const origIdx = this.browserTTS.voices.indexOf(voice);
            const opt = document.createElement('option');
            opt.value = origIdx;
            const isIndian = voice.lang.includes('en-IN') || voice.lang.includes('hi-IN');
            opt.textContent = `${voice.name} (${voice.lang})${isIndian ? ' *' : ''}`;
            select.appendChild(opt);
        });

        // Auto-select best Indian voice
        const best = sorted[0];
        if (best) {
            const idx = this.browserTTS.voices.indexOf(best);
            select.value = idx;
            this.browserTTS.selectVoice(best);
        }

        this._updateButtons();
    }

    // ── Engine Toggle ──

    _setEngine(engine) {
        this.engine = engine;
        this.els.btnEngineBrowser.classList.toggle('active', engine === 'browser');
        this.els.btnEnginePiper.classList.toggle('active', engine === 'piper');
        this.els.browserVoicePanel.classList.toggle('hidden', engine !== 'browser');
        this.els.piperVoicePanel.classList.toggle('hidden', engine !== 'piper');
        this._updateButtons();
    }

    async _downloadPiperVoice() {
        const voiceId = this.els.piperVoiceSelect.value;
        if (!voiceId) return;

        this.els.downloadVoiceBtn.disabled = true;
        this.els.modelProgress.classList.remove('hidden');
        this._setPiperStatus('loading', 'Initializing...');

        try {
            await this.piperTTS.init(voiceId, (pct, msg) => {
                this.els.modelProgressFill.style.width = pct + '%';
                this.els.modelProgressText.textContent = msg;
                this._setPiperStatus('loading', msg);
            });

            this._setPiperStatus('ready', 'Voice ready! You can now use Piper offline.');
            this._toast('Piper voice downloaded and cached!', 'success');
        } catch (err) {
            this._setPiperStatus('error', 'Failed: ' + err.message);
            this._toast('Piper download failed: ' + err.message, 'error');
        } finally {
            this.els.downloadVoiceBtn.disabled = false;
            setTimeout(() => this.els.modelProgress.classList.add('hidden'), 2000);
            this._updateButtons();
        }
    }

    _setPiperStatus(type, msg) {
        this.els.piperStatus.className = `piper-status ${type}`;
        this.els.piperStatus.textContent = msg;
        this.els.piperStatus.classList.remove('hidden');
    }

    // ── File Handling ──

    async _handleFile(file) {
        this.els.loadingOverlay.classList.remove('hidden');
        this.els.loadingText.textContent = 'Processing file...';
        this.els.uploadProgress.classList.remove('hidden');
        this.els.progressFill.style.width = '0%';

        try {
            this.els.progressFill.style.width = '20%';
            this.els.progressText.textContent = 'Extracting text...';

            const text = await extractText(file);

            this.els.progressFill.style.width = '80%';

            if (!text.trim()) throw new Error('No text found in file.');

            this.els.textInput.value = text.trim();
            this.els.progressFill.style.width = '100%';
            this.els.progressText.textContent = 'Done!';
            this._toast('File loaded — ' + file.name, 'success');
            this._updateButtons();
        } catch (err) {
            this._toast(err.message, 'error');
        } finally {
            this.els.loadingOverlay.classList.add('hidden');
            setTimeout(() => this.els.uploadProgress.classList.add('hidden'), 1500);
        }
    }

    // ── Playback ──

    _getWords() {
        const text = this.els.textInput.value.trim();
        if (!text) return [];
        return text.replace(/\s+/g, ' ').split(' ').filter(Boolean);
    }

    async play() {
        const words = this._getWords();
        if (words.length === 0) {
            this._toast('Enter or upload some text first', 'info');
            return;
        }

        // If resuming from pause
        if (this.isPaused && this.isPlaying) {
            this._resume();
            return;
        }

        // Fresh start
        speechSynthesis.cancel();
        this.words = words;
        this.wordIndex = 0;
        this.isPlaying = true;
        this.isPaused = false;
        this._abortController = new AbortController();
        this._updateButtons();
        this.els.readingStatus.classList.remove('hidden');

        await this._readLoop();
    }

    async _readLoop() {
        while (this.wordIndex < this.words.length && this.isPlaying) {
            // Check pause
            if (this.isPaused) {
                await this._waitForResume();
                if (!this.isPlaying) break;
            }

            // Update progress (no word highlighting per spec)
            this.els.readingProgress.textContent =
                `Word ${this.wordIndex + 1} of ${this.words.length}`;

            const word = this.words[this.wordIndex];

            // Speak via active engine
            try {
                if (this.engine === 'piper' && this.piperTTS.ready) {
                    await this.piperTTS.speak(word);
                } else {
                    await this.browserTTS.speak(word);
                }
            } catch (err) {
                console.warn('TTS error on word:', word, err);
            }

            if (!this.isPlaying) break;

            this.wordIndex++;

            // Pause between words
            if (this.wordIndex < this.words.length && this.isPlaying && !this.isPaused) {
                await this._sleep(this.pauseMs);
            }
        }

        // Completed
        if (this.isPlaying && this.wordIndex >= this.words.length) {
            this._toast('Finished reading!', 'success');
            this.stop();
        }
    }

    togglePauseResume() {
        if (this.isPaused) {
            this._resume();
        } else {
            this._pause();
        }
    }

    _pause() {
        if (!this.isPlaying) return;
        this.isPaused = true;
        speechSynthesis.cancel(); // cancel current word utterance
        this._updateButtons();
    }

    _resume() {
        if (!this.isPlaying) return;
        this.isPaused = false;
        this._updateButtons();
        // The _readLoop's _waitForResume will resolve and continue
    }

    stop() {
        this.isPlaying = false;
        this.isPaused = false;
        speechSynthesis.cancel();
        this.wordIndex = 0;
        this.els.readingStatus.classList.add('hidden');
        this._updateButtons();
    }

    _waitForResume() {
        return new Promise((resolve) => {
            const check = () => {
                if (!this.isPaused || !this.isPlaying) resolve();
                else setTimeout(check, 80);
            };
            check();
        });
    }

    _sleep(ms) {
        return new Promise((resolve) => {
            const id = setTimeout(resolve, ms);
            // Allow stop to break out of sleep
            const check = setInterval(() => {
                if (!this.isPlaying) {
                    clearTimeout(id);
                    clearInterval(check);
                    resolve();
                }
            }, 50);
            setTimeout(() => clearInterval(check), ms + 10);
        });
    }

    // ── UI Updates ──

    _updateButtons() {
        const hasText = this._getWords().length > 0 || this.els.textInput.value.trim().length > 0;
        const hasVoice = this.engine === 'browser'
            ? this.browserTTS.selectedVoice !== null
            : this.piperTTS.ready;

        if (this.isPlaying && !this.isPaused) {
            this.els.playBtn.disabled = true;
            this.els.pauseResumeBtn.disabled = false;
            this.els.pauseResumeBtn.textContent = '⏸ Pause';
            this.els.stopBtn.disabled = false;
        } else if (this.isPlaying && this.isPaused) {
            this.els.playBtn.disabled = false;
            this.els.playBtn.textContent = '▶ Resume';
            this.els.pauseResumeBtn.disabled = true;
            this.els.pauseResumeBtn.textContent = '⏸ Pause';
            this.els.stopBtn.disabled = false;
        } else {
            this.els.playBtn.disabled = !hasText || !hasVoice;
            this.els.playBtn.textContent = '▶ Play';
            this.els.pauseResumeBtn.disabled = true;
            this.els.stopBtn.disabled = true;
        }
    }

    _toast(message, type = 'info') {
        const icons = { success: '✅', error: '❌', info: 'ℹ️' };
        this.els.toastIcon.textContent = icons[type] || 'ℹ️';
        this.els.toastText.textContent = message;
        this.els.statusToast.classList.remove('hidden');
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => {
            this.els.statusToast.classList.add('hidden');
        }, 4000);
    }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    window.app = new ReadingApp();
});
