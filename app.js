// Audio Reading App for Kids - JavaScript
class AudioReadingApp {
    constructor() {
        this.currentText = '';
        this.words = [];
        this.currentWordIndex = 0;
        this.isPlaying = false;
        this.isPaused = false;
        this.pauseDuration = 1000; // milliseconds
        this.speechSynthesis = window.speechSynthesis;
        this.currentUtterance = null;
        this.availableVoices = [];
        this.selectedVoice = null;
        this.voicesLoaded = false;
        
        this.init();
    }

    init() {
        this.bindEvents();
        this.loadUserPreferences();
        this.setupDragAndDrop();
        this.initializeVoices();
    }

    bindEvents() {
        // File upload
        const fileInput = document.getElementById('fileInput');
        const uploadArea = document.getElementById('uploadArea');
        
        fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
        uploadArea.addEventListener('click', () => fileInput.click());

        // Pause slider
        const pauseSlider = document.getElementById('pauseSlider');
        pauseSlider.addEventListener('input', (e) => this.updatePauseDuration(e.target.value));

        // Voice selection
        const voiceSelect = document.getElementById('voiceSelect');
        voiceSelect.addEventListener('change', (e) => this.selectVoice(e.target.value));

        // Audio controls
        document.getElementById('playBtn').addEventListener('click', () => this.play());
        document.getElementById('pauseBtn').addEventListener('click', () => this.pause());
        document.getElementById('stopBtn').addEventListener('click', () => this.stop());
        document.getElementById('restartBtn').addEventListener('click', () => this.restart());

        // Download buttons
        document.getElementById('downloadHtml').addEventListener('click', () => this.downloadFile('html'));
        document.getElementById('downloadCss').addEventListener('click', () => this.downloadFile('css'));
        document.getElementById('downloadJs').addEventListener('click', () => this.downloadFile('js'));
        document.getElementById('downloadAll').addEventListener('click', () => this.downloadAllFiles());
    }

    setupDragAndDrop() {
        const uploadArea = document.getElementById('uploadArea');
        
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });

        uploadArea.addEventListener('dragleave', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
        });

        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                this.processFile(files[0]);
            }
        });
    }

    initializeVoices() {
        // Multiple approaches to ensure voices are loaded
        this.loadVoices();
        
        // Listen for voiceschanged event
        if (this.speechSynthesis.addEventListener) {
            this.speechSynthesis.addEventListener('voiceschanged', () => {
                if (!this.voicesLoaded) {
                    this.loadVoices();
                }
            });
        }

        // Fallback polling for browsers that don't fire voiceschanged
        let attempts = 0;
        const pollVoices = () => {
            attempts++;
            if (!this.voicesLoaded && attempts < 50) {
                this.loadVoices();
                setTimeout(pollVoices, 100);
            }
        };
        setTimeout(pollVoices, 100);
    }

    loadVoices() {
        const voices = this.speechSynthesis.getVoices();
        
        if (voices.length === 0) {
            return; // Voices not ready yet
        }

        this.availableVoices = voices;
        this.voicesLoaded = true;
        
        const voiceSelect = document.getElementById('voiceSelect');
        
        // Clear existing options
        voiceSelect.innerHTML = '';

        if (voices.length === 0) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = 'No voices available';
            voiceSelect.appendChild(option);
            return;
        }

        // Sort voices to prioritize Indian voices
        const sortedVoices = [...voices].sort((a, b) => {
            const aScore = this.getVoiceScore(a);
            const bScore = this.getVoiceScore(b);
            return bScore - aScore;
        });

        sortedVoices.forEach((voice, index) => {
            const option = document.createElement('option');
            const originalIndex = voices.indexOf(voice);
            option.value = originalIndex;
            option.textContent = `${voice.name} (${voice.lang})`;
            if (voice.lang.includes('en-IN') || voice.lang.includes('hi-IN')) {
                option.textContent += ' ⭐';
            }
            voiceSelect.appendChild(option);
        });

        // Select the best Indian voice by default
        const bestVoice = sortedVoices.find(voice => 
            voice.lang.includes('en-IN') || voice.lang.includes('hi-IN')
        ) || sortedVoices[0];
        
        if (bestVoice) {
            const bestIndex = voices.indexOf(bestVoice);
            voiceSelect.value = bestIndex;
            this.selectedVoice = bestVoice;
            this.showStatus(`Voice loaded: ${bestVoice.name}`, 'success');
        }
    }

    getVoiceScore(voice) {
        let score = 0;
        const lang = voice.lang.toLowerCase();
        const name = voice.name.toLowerCase();
        
        // Prioritize Indian voices
        if (lang.includes('en-in')) score += 100;
        if (lang.includes('hi-in')) score += 90;
        if (name.includes('indian')) score += 80;
        if (name.includes('hindi')) score += 70;
        if (lang.includes('en-us')) score += 50;
        if (lang.includes('en-gb')) score += 40;
        if (lang.startsWith('en')) score += 30;
        
        return score;
    }

    selectVoice(voiceIndex) {
        const index = parseInt(voiceIndex);
        if (!isNaN(index) && this.availableVoices[index]) {
            this.selectedVoice = this.availableVoices[index];
            this.saveUserPreferences();
            this.showStatus(`Voice selected: ${this.selectedVoice.name}`, 'info');
        }
    }

    handleFileSelect(event) {
        const file = event.target.files[0];
        if (file) {
            this.processFile(file);
        }
    }

    async processFile(file) {
        this.showLoading(true);
        this.showProgress(0);
        
        try {
            // Validate file size (10MB limit)
            if (file.size > 10 * 1024 * 1024) {
                throw new Error('File size too large. Please select a file smaller than 10MB.');
            }

            const fileType = file.type;
            const fileName = file.name.toLowerCase();
            let extractedText = '';

            this.showProgress(25);

            if (fileType.startsWith('text/') || fileName.endsWith('.txt')) {
                extractedText = await this.extractTextFromTxt(file);
            } else if (fileName.endsWith('.docx')) {
                extractedText = await this.extractTextFromDocx(file);
            } else if (fileType === 'application/pdf' || fileName.endsWith('.pdf')) {
                extractedText = await this.extractTextFromPdf(file);
            } else if (fileType.startsWith('image/')) {
                extractedText = await this.extractTextFromImage(file);
            } else {
                throw new Error('Unsupported file format. Please use .txt, .docx, .pdf, or image files.');
            }

            this.showProgress(75);

            if (!extractedText.trim()) {
                throw new Error('No text content found in the file.');
            }

            this.currentText = extractedText;
            this.prepareText();
            this.displayText();
            this.enableControls();
            
            this.showProgress(100);
            this.showStatus('File processed successfully! Ready to start reading.', 'success');
            
        } catch (error) {
            console.error('Error processing file:', error);
            this.showStatus(error.message, 'error');
        } finally {
            this.showLoading(false);
            setTimeout(() => this.hideProgress(), 1000);
        }
    }

    async extractTextFromTxt(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = () => reject(new Error('Failed to read text file'));
            reader.readAsText(file);
        });
    }

    async extractTextFromDocx(file) {
        // For demo purposes, provide clear instructions
        this.showStatus('DOCX files: Please save as .txt format first, or copy-paste the text content into a .txt file.', 'info');
        throw new Error('Please convert DOCX to .txt format for processing');
    }

    async extractTextFromPdf(file) {
        // For demo purposes, provide clear instructions
        this.showStatus('PDF files: Please copy the text content and save as .txt format first.', 'info');
        throw new Error('Please convert PDF content to .txt format for processing');
    }

    async extractTextFromImage(file) {
        // For demo purposes, provide clear instructions
        this.showStatus('Image files: Please use OCR software to extract text first, then save as .txt format.', 'info');
        throw new Error('Please extract text from image using OCR tools first');
    }

    prepareText() {
        // Clean and split text into words
        this.words = this.currentText
            .replace(/\s+/g, ' ')
            .trim()
            .split(' ')
            .filter(word => word.length > 0);
        
        this.currentWordIndex = 0;
        this.updateProgress();
    }

    displayText() {
        const textDisplay = document.getElementById('textDisplay');
        const wordsHtml = this.words.map((word, index) => 
            `<span class="word" data-index="${index}">${this.escapeHtml(word)}</span>`
        ).join(' ');
        
        textDisplay.innerHTML = wordsHtml;

        // Add click handlers for word navigation
        const wordElements = textDisplay.querySelectorAll('.word');
        wordElements.forEach((element, index) => {
            element.addEventListener('click', () => this.jumpToWord(index));
        });
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    jumpToWord(index) {
        if (index >= 0 && index < this.words.length) {
            this.currentWordIndex = index;
            this.updateProgress();
            this.highlightCurrentWord();
        }
    }

    updatePauseDuration(value) {
        this.pauseDuration = parseFloat(value) * 1000; // Convert to milliseconds
        document.getElementById('pauseValue').textContent = value;
        this.saveUserPreferences();
    }

    async play() {
        if (this.words.length === 0) {
            this.showStatus('Please upload a text file first', 'info');
            return;
        }

        if (!this.selectedVoice) {
            this.showStatus('Please wait for voices to load or select a voice', 'info');
            return;
        }

        this.isPlaying = true;
        this.isPaused = false;
        this.updateControlButtons();
        
        await this.speakWords();
    }

    async speakWords() {
        while (this.isPlaying && this.currentWordIndex < this.words.length) {
            if (this.isPaused) {
                await this.waitForResume();
            }

            if (!this.isPlaying) break;

            this.highlightCurrentWord();
            await this.speakCurrentWord();
            
            if (this.isPlaying) {
                this.currentWordIndex++;
                this.updateProgress();
                
                // Add pause between words (except for the last word)
                if (this.currentWordIndex < this.words.length && this.isPlaying) {
                    await this.sleep(this.pauseDuration);
                }
            }
        }

        if (this.currentWordIndex >= this.words.length) {
            this.showStatus('Reading completed! 🎉', 'success');
            this.stop();
        }
    }

    async speakCurrentWord() {
        return new Promise((resolve) => {
            if (!this.selectedVoice || !this.isPlaying) {
                resolve();
                return;
            }

            const word = this.words[this.currentWordIndex];
            const utterance = new SpeechSynthesisUtterance(word);
            
            utterance.voice = this.selectedVoice;
            utterance.rate = 0.8;
            utterance.pitch = 1.0;
            utterance.volume = 1.0;

            utterance.onend = () => {
                this.currentUtterance = null;
                resolve();
            };

            utterance.onerror = (event) => {
                console.error('Speech synthesis error:', event);
                this.currentUtterance = null;
                resolve();
            };

            this.currentUtterance = utterance;
            this.speechSynthesis.speak(utterance);
        });
    }

    async waitForResume() {
        return new Promise((resolve) => {
            const checkResume = () => {
                if (!this.isPaused || !this.isPlaying) {
                    resolve();
                } else {
                    setTimeout(checkResume, 100);
                }
            };
            checkResume();
        });
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    pause() {
        if (!this.isPlaying) return;
        
        this.isPaused = true;
        if (this.currentUtterance) {
            this.speechSynthesis.pause();
        }
        this.updateControlButtons();
        this.showStatus('Reading paused', 'info');
    }

    stop() {
        this.isPlaying = false;
        this.isPaused = false;
        this.speechSynthesis.cancel();
        this.currentUtterance = null;
        this.updateControlButtons();
        this.clearWordHighlights();
        this.showStatus('Reading stopped', 'info');
    }

    restart() {
        this.stop();
        this.currentWordIndex = 0;
        this.updateProgress();
        setTimeout(() => {
            this.highlightCurrentWord();
            this.play();
        }, 200);
    }

    highlightCurrentWord() {
        // Clear previous highlights
        this.clearWordHighlights();

        // Highlight current word
        const wordElements = document.querySelectorAll('.word');
        if (wordElements[this.currentWordIndex]) {
            wordElements[this.currentWordIndex].classList.add('current');
            
            // Mark previous words as spoken
            for (let i = 0; i < this.currentWordIndex; i++) {
                wordElements[i].classList.add('spoken');
            }

            // Scroll to current word
            wordElements[this.currentWordIndex].scrollIntoView({
                behavior: 'smooth',
                block: 'center'
            });
        }
    }

    clearWordHighlights() {
        const wordElements = document.querySelectorAll('.word');
        wordElements.forEach(element => {
            element.classList.remove('current', 'spoken');
        });
    }

    updateProgress() {
        const progressElement = document.getElementById('wordProgress');
        if (this.words.length > 0) {
            progressElement.textContent = `${this.currentWordIndex + 1} / ${this.words.length} words`;
        } else {
            progressElement.textContent = '0 / 0 words';
        }
    }

    updateControlButtons() {
        const playBtn = document.getElementById('playBtn');
        const pauseBtn = document.getElementById('pauseBtn');
        const stopBtn = document.getElementById('stopBtn');
        const restartBtn = document.getElementById('restartBtn');

        const hasText = this.words.length > 0;
        const hasVoice = this.selectedVoice !== null;

        if (this.isPlaying && !this.isPaused) {
            playBtn.disabled = true;
            pauseBtn.disabled = false;
            stopBtn.disabled = false;
            restartBtn.disabled = false;
        } else if (this.isPaused) {
            playBtn.disabled = false;
            pauseBtn.disabled = true;
            stopBtn.disabled = false;
            restartBtn.disabled = false;
        } else {
            playBtn.disabled = !hasText || !hasVoice;
            pauseBtn.disabled = true;
            stopBtn.disabled = true;
            restartBtn.disabled = !hasText || !hasVoice;
        }
    }

    enableControls() {
        this.updateControlButtons();
    }

    showLoading(show) {
        const overlay = document.getElementById('loadingOverlay');
        if (show) {
            overlay.classList.remove('hidden');
        } else {
            overlay.classList.add('hidden');
        }
    }

    showProgress(percentage) {
        const progressSection = document.getElementById('uploadProgress');
        const progressFill = document.getElementById('progressFill');
        
        progressSection.classList.remove('hidden');
        progressFill.style.width = `${percentage}%`;
    }

    hideProgress() {
        const progressSection = document.getElementById('uploadProgress');
        progressSection.classList.add('hidden');
    }

    showStatus(message, type) {
        const statusElement = document.getElementById('statusMessage');
        const statusIcon = statusElement.querySelector('.status-icon');
        const statusText = statusElement.querySelector('.status-text');

        const icons = {
            success: '✅',
            error: '❌',
            info: 'ℹ️'
        };

        statusIcon.textContent = icons[type] || 'ℹ️';
        statusText.textContent = message;
        statusElement.className = `status-message ${type}`;
        statusElement.classList.remove('hidden');

        // Auto-hide after 5 seconds
        setTimeout(() => {
            statusElement.classList.add('hidden');
        }, 5000);
    }

    // File download functionality
    downloadFile(type) {
        let content, filename, mimeType;

        switch (type) {
            case 'html':
                content = this.getHtmlContent();
                filename = 'audio-reading-app.html';
                mimeType = 'text/html';
                break;
            case 'css':
                content = this.getCssContent();
                filename = 'style.css';
                mimeType = 'text/css';
                break;
            case 'js':
                content = this.getJsContent();
                filename = 'app.js';
                mimeType = 'text/javascript';
                break;
        }

        this.downloadBlob(content, filename, mimeType);
        this.showStatus(`${filename} downloaded successfully!`, 'success');
    }

    downloadAllFiles() {
        // Download all files sequentially with small delays
        this.downloadFile('html');
        setTimeout(() => this.downloadFile('css'), 200);
        setTimeout(() => this.downloadFile('js'), 400);
        
        this.showStatus('All files downloaded! 📦', 'success');
    }

    downloadBlob(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    getHtmlContent() {
        return document.documentElement.outerHTML;
    }

    getCssContent() {
        // Return the current stylesheet content
        let css = '/* Audio Reading App - Complete CSS */\n\n';
        
        // Add basic CSS rules
        try {
            for (const stylesheet of document.styleSheets) {
                if (stylesheet.href && stylesheet.href.includes('style.css')) {
                    for (const rule of stylesheet.cssRules) {
                        css += rule.cssText + '\n';
                    }
                }
            }
        } catch (e) {
            css += '/* Could not extract all CSS rules due to CORS restrictions */\n';
            css += '/* Please ensure all CSS is included in the style.css file */\n';
        }
        
        return css;
    }

    getJsContent() {
        // Return the current JavaScript code as a string
        return `// Audio Reading App for Kids - Complete JavaScript
${this.constructor.toString()}

// Initialize the app when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new AudioReadingApp();
});`;
    }

    // User preferences (simplified for sandbox environment)
    saveUserPreferences() {
        // Note: localStorage is not available in sandbox environment
        // In a real deployment, this would save user preferences
        console.log('Preferences saved:', {
            pauseDuration: this.pauseDuration,
            selectedVoice: this.selectedVoice ? this.selectedVoice.name : null
        });
    }

    loadUserPreferences() {
        // Note: localStorage is not available in sandbox environment
        // Using default values
        this.pauseDuration = 1000; // 1 second default
        document.getElementById('pauseSlider').value = 1.0;
        document.getElementById('pauseValue').textContent = '1.0';
    }
}

// Initialize the app when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new AudioReadingApp();
});