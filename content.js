class SmartStickerExtension {
    constructor() {
        console.log('[SmartSticker] SmartStickerExtension constructor called.');
        this.platforms = [
            {
                name: 'Discord',
                selectors: {
                    input: '[class*="channelTextArea"] textarea, [class*="channelTextArea"] [contenteditable="true"]',
                    container: '[class*="channelTextArea"]',
                    sendButton: 'button[type="submit"], [class*="sendButton"]',
                    fileInput: 'input[type="file"]'
                },
                theme: () => document.documentElement.getAttribute('data-theme') || 'dark'
            },
            {
                name: 'Instagram',
                selectors: {
                    input: 'textarea[placeholder*="comment"], [contenteditable="true"][role="textbox"]',
                    container: 'form[role="search"], [role="dialog"]',
                    sendButton: 'button[type="submit"], [role="button"]',
                    fileInput: 'input[type="file"]'
                },
                theme: () => 'light'
            }
        ];

        this.ollamaEnabled = true;
        this.ollamaUrl = 'http://localhost:11434';
        this.ollamaModel = 'mistral:7b-instruct';
        this.giphyKey = 'StFVwDYtCey7YDR1xOJot9tyGYILEDUR';
        this.isActive = false;
        this.lastSearch = '';
        this.lastAnalyzedText = '';
        this.currentPlatform = null;
        this.currentInput = null;
        this.suggestionBar = null;
        this.apiCallCount = 0;
        this.lastApiCall = Date.now();
        this.apiCallInterval = 3600000; // 1 hour
        this.maxApiCalls = 50;
        this.isProcessing = false;
        this.typingTimer = null;
        this.typingDelay = 500; // 0.5 seconds
        this.minChars = 3;
        this.debounceDelay = 300; // 0.3 seconds
        this.attachedInputs = new WeakSet(); // Track attached inputs
        this.isAnalyzing = false;
        this.initialize();
    }

    async initialize() {
        try {
            // Check if we're in a Chrome extension context
            if (typeof chrome === 'undefined' || !chrome.runtime) {
                console.error('[SmartSticker] Not running in Chrome extension context');
                return;
            }

            // Test connection to background script
            try {
                await this.sendMessageToBackground({ type: 'PING' });
                console.log('[SmartSticker] Successfully connected to background script');
            } catch (error) {
                console.error('[SmartSticker] Failed to connect to background script:', error);
                return;
            }

            this.currentPlatform = this.detectPlatform();
            this.categories = [
                { key: 'trending', label: 'Trending', icon: '🔥' },
                { key: 'reactions', label: 'Reactions', icon: '😆' },
                { key: 'animals', label: 'Animals', icon: '🐶' },
                { key: 'memes', label: 'Memes', icon: '😂' },
                { key: 'love', label: 'Love', icon: '❤️' },
                { key: 'party', label: 'Party', icon: '🎉' },
                { key: 'sad', label: 'Sad', icon: '😢' },
                { key: 'happy', label: 'Happy', icon: '😊' },
                { key: 'sports', label: 'Sports', icon: '🏀' },
                { key: 'gaming', label: 'Gaming', icon: '🎮' }
            ];
            this.activeCategory = 'trending';
            this.lastSearch = '';
            this.suggestedStickers = [];

            await this.setupExtension();
        } catch (error) {
            console.error('[SmartSticker] Error initializing extension:', error);
        }
    }

    async sendMessageToBackground(message) {
        const maxRetries = 3;
        const retryDelay = 1000; // 1 second

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
                    throw new Error('Chrome runtime not available');
                }

                return await new Promise((resolve, reject) => {
                    try {
                        chrome.runtime.sendMessage(message, response => {
                            if (chrome.runtime.lastError) {
                                reject(new Error(chrome.runtime.lastError.message));
                                return;
                            }
                            resolve(response);
                        });
                    } catch (error) {
                        reject(error);
                    }
                });
            } catch (error) {
                console.error(`[SmartSticker] Attempt ${attempt} failed:`, error);

                if (attempt === maxRetries) {
                    // On final attempt, return a fallback response instead of throwing
                    return {
                        success: true,
                        data: {
                            sentiment: 'neutral',
                            emotions: message.text.split(' ').filter(word => word.length > 3),
                            intensity: 'medium',
                            gif_query: message.text
                        }
                    };
                }

                // Wait before retrying
                await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
            }
        }
    }

    detectPlatform() {
        const hostname = window.location.hostname;
        const pathname = window.location.pathname;

        console.log('[SmartSticker] Detecting platform for:', hostname, pathname);

        // Discord detection
        if (hostname.includes('discord.com')) {
            console.log('[SmartSticker] Detected Discord platform');
            return {
                name: 'Discord',
                inputSelector: '[class*="channelTextArea"] [class*="slateTextArea"]',
                containerSelector: '[class*="channelTextArea"]',
                sendButton: 'button[type="submit"], [class*="sendButton"]',
                fileInput: 'input[type="file"]',
                theme: () => document.documentElement.getAttribute('data-theme') || 'dark',
                insertMethod: this.handleDiscordGif.bind(this)
            };
        }

        // Instagram detection
        if (hostname.includes('instagram.com')) {
            console.log('[SmartSticker] Detected Instagram platform');
            return {
                name: 'Instagram',
                inputSelector: 'div[contenteditable="true"][role="textbox"][aria-label="Message"], textarea[placeholder*="Message"]',
                containerSelector: 'form[role="search"], [role="dialog"]',
                sendButton: 'button[type="submit"], [role="button"][aria-label="Send"]',
                fileInput: 'input[type="file"]',
                theme: () => 'light',
                insertMethod: this.handleInstagramGif.bind(this)
            };
        }

        // Twitter/X detection with DM support
        if (hostname.includes('twitter.com') || hostname.includes('x.com')) {
            const isDM = pathname.includes('/messages');
            return {
                name: 'Twitter',
                inputSelector: isDM ?
                    '[data-testid="dmComposerTextInput"]' :
                    '[data-testid="tweetTextarea_0"]',
                containerSelector: isDM ?
                    '[data-testid="dmComposerTextInput"]' :
                    '[data-testid="tweetTextarea_0"]',
                theme: () => document.querySelector('[data-theme="dark"]') ? 'dark' : 'light',
                insertMethod: this.handleTwitterGif.bind(this)
            };
        }

        const platforms = {
            'reddit.com': {
                name: 'Reddit',
                inputSelector: '[contenteditable="true"], textarea[placeholder*="comment"]',
                containerSelector: '[class*="CommentForm"], [class*="SubmitPage"]',
                theme: () => document.querySelector('[data-theme="dark"]') ? 'dark' : 'light',
                insertMethod: this.insertRedditContent.bind(this)
            },
            'web.whatsapp.com': {
                name: 'WhatsApp',
                inputSelector: '[contenteditable="true"][data-tab="10"]',
                containerSelector: '[class*="input-container"]',
                theme: () => document.querySelector('[data-theme="dark"]') ? 'dark' : 'light',
                insertMethod: this.insertWhatsAppContent.bind(this)
            }
        };

        return platforms[hostname] || {
            name: 'Generic',
            inputSelector: '[contenteditable="true"], textarea, input[type="text"]',
            containerSelector: 'body',
            theme: () => 'light',
            insertMethod: this.insertGenericContent.bind(this)
        };
    }

    async setupExtension() {
        console.log('[SmartSticker] setupExtension() called.');
        this.injectStyles();
        this.setupUIEvents();
        this.observeInputs();

        // Setup mutation observer for dynamic content
        this.setupMutationObserver();
    }

    setupMutationObserver() {
        const observer = new MutationObserver((mutations) => {
            let shouldReobserve = false;

            for (const mutation of mutations) {
                if (mutation.type === 'childList') {
                    // Check if new inputs were added
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            const newInputs = node.querySelectorAll?.(this.currentPlatform.inputSelector);
                            if (newInputs?.length > 0) {
                                shouldReobserve = true;
                            }
                        }
                    });
                }
            }

            if (shouldReobserve) {
                // Debounce re-observation
                clearTimeout(this.reobserveTimer);
                this.reobserveTimer = setTimeout(() => {
                    this.observeInputs();
                }, 500);
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    observeInputs() {
        console.log('[SmartSticker] observeInputs() called.');
        const inputs = document.querySelectorAll(this.currentPlatform.inputSelector);
        console.log('[SmartSticker] Found', inputs.length, 'inputs matching selector.');

        inputs.forEach(input => {
            if (!this.attachedInputs.has(input)) {
                console.log('[SmartSticker] Attaching to new input:', input);
                this.attachToInput(input);
                this.attachedInputs.add(input);
            }
        });
    }

    attachToInput(input) {
        if (!input) return;

        this.currentInput = input;
        let lastValue = input.value || input.textContent || '';
        let inputInterval = null;

        const processInput = () => {
            if (this.isProcessing) return;

            const currentValue = input.value || input.textContent || '';
            if (currentValue !== lastValue) {
                lastValue = currentValue;
                this.handleTextChange(currentValue.trim());
            }
        };

        // Use a longer interval for checking input changes
        inputInterval = setInterval(processInput, 500);

        // Clean up when input is removed
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === 'childList' && !document.contains(input)) {
                    clearInterval(inputInterval);
                    observer.disconnect();
                    break;
                }
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Add click handler for the input
        input.addEventListener('click', () => {
            this.currentInput = input;
        });

        // Add keyboard event listener for Enter key
        if (window.location.hostname.includes('twitter.com') || window.location.hostname.includes('x.com')) {
            input.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    event.stopPropagation();

                    // Find and click the send button
                    const sendButton = document.querySelector('[data-testid="dmComposerSendButton"]');
                    if (sendButton) {
                        sendButton.click();
                    }
                }
            });
        }
    }

    getInputValue(input) {
        if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
            return input.value || '';
        } else if (input.contentEditable === 'true') {
            return input.textContent || input.innerText || '';
        }
        return '';
    }

    async handleTextChange(text) {
        if (!text || text.length < this.minChars) {
            this.hideSuggestionBar();
            return;
        }

        if (this.typingTimer) {
            clearTimeout(this.typingTimer);
        }

        this.typingTimer = setTimeout(async () => {
            if (this.isProcessing) return;
            this.isProcessing = true;

            try {
                // Clean the text by removing URLs and extra whitespace
                const cleanText = text.replace(/https?:\/\/[^\s]+/g, '').trim();

                // Try to get smart suggestions from Ollama if enabled
                let searchQuery = cleanText;
                if (this.ollamaEnabled) {
                    try {
                        const analysis = await this.analyzeWithOllama(cleanText);
                        if (analysis?.success && analysis?.data?.gif_query) {
                            searchQuery = analysis.data.gif_query;
                        }
                    } catch (error) {
                        console.error('[SmartSticker] Ollama analysis failed:', error);
                        // Continue with original text
                    }
                }

                // Fetch GIFs using the query
                const items = await this.searchStickers(searchQuery);
                this.renderItems(items);
            } catch (error) {
                console.error('[SmartSticker] Error in text analysis or GIF search:', error);
                // Fallback to direct search with cleaned text
                try {
                    const cleanText = text.replace(/https?:\/\/[^\s]+/g, '').trim();
                    const items = await this.searchStickers(cleanText);
                    this.renderItems(items);
                } catch (searchError) {
                    console.error('[SmartSticker] Fallback search failed:', searchError);
                    this.hideSuggestionBar();
                }
            } finally {
                this.isProcessing = false;
            }
        }, this.typingDelay);
    }

    async analyzeWithOllama(text) {
        try {
            if (!text || typeof text !== 'string') {
                throw new Error('Invalid input text');
            }

            console.log('[SmartSticker] Analyzing text with Ollama:', text);

            // Create a more specific and context-aware prompt for GIF search terms
            const prompt = `Given the text: "${text}"
            Think about what kind of animated GIF would be most appropriate and engaging as a response in a conversation.
            Focus on specific actions, emotions, or reactions that would make sense in this context.
            
            Examples of good responses:
            - "how are you" -> "waving hello, friendly greeting, happy wave"
            - "i love ice cream" -> "eating ice cream, excited food, dessert happy"
            - "that's so funny" -> "laughing hard, rolling on floor, funny reaction"
            - "good morning" -> "sunrise greeting, morning coffee, waking up happy"
            - "congratulations" -> "celebration dance, happy jump, success party"
            
            Extract 2-3 specific words or short phrases that would be good for searching animated GIFs.
            Focus on actions and emotions that would make a good animated response.
            Just list the words/phrases separated by commas, nothing else.`;

            const response = await this.sendMessageToBackground({
                type: 'ANALYZE_WITH_OLLAMA',
                text: text,
                prompt: prompt
            });

            // Always return a valid response, even if analysis failed
            if (!response || !response.success) {
                const fallbackKeywords = text
                    .toLowerCase()
                    .split(/\s+/)
                    .filter(word => word.length > 3 && !['what', 'when', 'where', 'which', 'whose', 'whom', 'this', 'that', 'these', 'those'].includes(word));

                return {
                    success: true,
                    data: {
                        sentiment: 'neutral',
                        emotions: fallbackKeywords,
                        intensity: 'medium',
                        gif_query: fallbackKeywords.join(' ')
                    }
                };
            }

            return response;
        } catch (error) {
            console.error('[SmartSticker] Error in text analysis:', error);
            // Return a fallback response with basic keyword extraction
            const fallbackKeywords = text
                .toLowerCase()
                .split(/\s+/)
                .filter(word => word.length > 3 && !['what', 'when', 'where', 'which', 'whose', 'whom', 'this', 'that', 'these', 'those'].includes(word));

            return {
                success: true,
                data: {
                    sentiment: 'neutral',
                    emotions: fallbackKeywords,
                    intensity: 'medium',
                    gif_query: fallbackKeywords.join(' ')
                }
            };
        }
    }

    async searchStickers(query) {
        try {
            // Clean the query - remove URLs and limit length
            const cleanQuery = query.replace(/https?:\/\/[^\s]+/g, '').trim().slice(0, 50);

            // Check rate limiting
            const now = Date.now();
            if (now - this.lastApiCall > this.apiCallInterval) {
                this.apiCallCount = 0;
                this.lastApiCall = now;
            }

            if (this.apiCallCount >= this.maxApiCalls) {
                throw new Error('Rate limit exceeded. Please try again later.');
            }

            console.log(`[SmartSticker] Searching stickers for: ${cleanQuery}`);
            const response = await fetch(
                `https://api.giphy.com/v1/gifs/search?api_key=${this.giphyKey}&q=${encodeURIComponent(cleanQuery)}&limit=2&rating=g`
            );

            if (!response.ok) {
                throw new Error(`Giphy API error: ${response.status}`);
            }

            this.apiCallCount++;
            const data = await response.json();
            return data.data.map(item => ({
                url: item.images.original.url,
                title: item.title,
                preview: item.images.preview_gif.url
            }));
        } catch (error) {
            console.error('[SmartSticker] Error searching stickers:', error);
            throw error;
        }
    }

    async loadSearch(query) {
        if (!query || query === this.lastSearch) return;

        try {
            console.log(`[SmartSticker] Loading search for: "${query}"`);

            // Create suggestion bar if it doesn't exist
            if (!this.suggestionBar) {
                this.createSuggestionBar();
            }

            // Show loading state
            this.showLoadingState();

            const items = await this.searchStickers(query);
            console.log(`[SmartSticker] Found ${items.length} items for search: ${query}`);

            if (items.length > 0) {
                this.renderItems(items);
                this.lastSearch = query;
                this.showSuggestionBar();
            } else {
                this.hideSuggestionBar();
            }
        } catch (error) {
            console.error('[SmartSticker] Error in loadSearch:', error);
            this.showErrorState('Failed to load suggestions');
        }
    }

    createSuggestionBar() {
        if (this.suggestionBar) return;

        this.suggestionBar = document.createElement('div');
        this.suggestionBar.className = 'smart-sticker-bar';
        this.suggestionBar.setAttribute('data-theme', this.currentPlatform.theme());

        const grid = document.createElement('div');
        grid.className = 'smart-sticker-grid';
        grid.style.cssText = `
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 8px;
            padding: 8px;
            max-height: 200px;
            overflow-y: auto;
        `;

        this.suggestionBar.appendChild(grid);
        document.body.appendChild(this.suggestionBar);

        // Position the suggestion bar
        if (this.currentInput) {
            this.positionSuggestionBar();
        }
    }

    showSuggestionBar() {
        if (!this.suggestionBar || !this.currentInput) return;

        console.log('[SmartSticker] Showing suggestion bar...');

        // Position the bar
        this.positionSuggestionBar();

        // Show with animation
        this.suggestionBar.style.display = 'block';
        this.suggestionBar.style.visibility = 'visible';
        this.suggestionBar.offsetHeight; // Force reflow
        this.suggestionBar.classList.add('show');

        console.log('[SmartSticker] Suggestion bar shown');
    }

    hideSuggestionBar() {
        if (this.suggestionBar && this.suggestionBar.parentNode) {
            try {
                this.suggestionBar.parentNode.removeChild(this.suggestionBar);
            } catch (error) {
                console.error('[SmartSticker] Error removing suggestion bar:', error);
            }
        }
        this.suggestionBar = null;
    }

    positionSuggestionBar() {
        if (!this.suggestionBar || !this.currentInput) return;

        const inputRect = this.currentInput.getBoundingClientRect();
        const barHeight = 120; // Approximate height

        // Position above the input if there's space, otherwise below
        const spaceAbove = inputRect.top;
        const spaceBelow = window.innerHeight - inputRect.bottom;

        if (spaceAbove > barHeight + 10) {
            // Position above
            this.suggestionBar.style.position = 'fixed';
            this.suggestionBar.style.bottom = `${window.innerHeight - inputRect.top + 10}px`;
            this.suggestionBar.style.top = 'auto';
        } else {
            // Position below
            this.suggestionBar.style.position = 'fixed';
            this.suggestionBar.style.top = `${inputRect.bottom + 10}px`;
            this.suggestionBar.style.bottom = 'auto';
        }

        this.suggestionBar.style.left = `${inputRect.left}px`;
        this.suggestionBar.style.width = `${Math.min(400, inputRect.width)}px`;
        this.suggestionBar.style.zIndex = '999999';
    }

    showLoadingState() {
        if (!this.suggestionBar) return;

        const grid = this.suggestionBar.querySelector('.smart-sticker-grid');
        if (grid) {
            grid.innerHTML = '<div class="smart-sticker-loader">🔍 Searching for stickers...</div>';
        }
    }

    showErrorState(message) {
        if (!this.suggestionBar) return;

        const grid = this.suggestionBar.querySelector('.smart-sticker-grid');
        if (grid) {
            grid.innerHTML = `<div class="smart-sticker-error">❌ ${message}</div>`;
        }

        // Hide after 3 seconds
        setTimeout(() => {
            this.hideSuggestionBar();
        }, 3000);
    }

    renderItems(items) {
        if (!this.suggestionBar) {
            this.createSuggestionBar();
        }

        const stickersContainer = this.suggestionBar.querySelector('.smart-sticker-grid');
        if (!stickersContainer) {
            console.error('[SmartSticker] Stickers container not found.');
            return;
        }

        stickersContainer.innerHTML = ''; // Clear previous items

        items.forEach(item => {
            const img = document.createElement('img');
            img.src = item.preview; // Use preview for faster loading
            img.alt = item.title;
            img.classList.add('smart-sticker-item');
            img.dataset.gifUrl = item.url; // Store original URL for sending
            img.style.cssText = `
                width: 100%;
                height: 150px;
                object-fit: cover;
                border-radius: 4px;
                cursor: pointer;
            `;

            img.addEventListener('click', () => {
                this.insertStickerIntoInput(img.dataset.gifUrl);
                this.hideSuggestionBar();
            });

            stickersContainer.appendChild(img);
        });

        if (items.length > 0) {
            this.showSuggestionBar();
        } else {
            this.hideSuggestionBar();
        }
    }

    async handleDiscordGif(gifUrl) {
        try {
            console.log('[SmartSticker] Starting Discord GIF handling');

            // Find the message input container
            const inputContainer = document.querySelector('[class*="channelTextArea"]');
            if (!inputContainer) {
                throw new Error('Message input container not found');
            }

            // Find the file input
            const fileInput = inputContainer.querySelector('input[type="file"]');
            if (!fileInput) {
                throw new Error('File input not found');
            }

            // Fetch the GIF and create a File object
            const response = await fetch(gifUrl);
            if (!response.ok) throw new Error(`Failed to fetch GIF: ${response.status}`);

            const blob = await response.blob();
            const file = new File([blob], 'gif.gif', { type: 'image/gif' });

            // Create DataTransfer and add the file
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);
            fileInput.files = dataTransfer.files;

            // Trigger the change event
            fileInput.dispatchEvent(new Event('change', { bubbles: true }));

            // Wait for upload to complete
            await new Promise(resolve => setTimeout(resolve, 1500));

            // Find the input element with the correct selector
            const input = inputContainer.querySelector('[contenteditable="true"]');
            if (!input) {
                throw new Error('Input element not found');
            }

            // Simulate Enter key press
            const enterEvent = new KeyboardEvent('keydown', {
                key: 'Enter',
                code: 'Enter',
                keyCode: 13,
                which: 13,
                bubbles: true
            });
            input.dispatchEvent(enterEvent);

            console.log('[SmartSticker] Successfully sent GIF to Discord');
            return true;
        } catch (error) {
            console.error('[SmartSticker] Error handling Discord GIF:', error);
            throw error;
        }
    }

    async handleInstagramGif(gifUrl) {
        try {
            console.log('[SmartSticker] handleInstagramGif start with URL:', gifUrl);

            // 1. Find message input with multiple possible selectors
            const messageInput = document.querySelector('div[contenteditable="true"][role="textbox"][aria-label="Message"]') ||
                document.querySelector('textarea[placeholder*="Message"]') ||
                document.querySelector('[contenteditable="true"][role="textbox"]');
            console.log('[SmartSticker] Found message input:', messageInput);

            // 2. Find file input with multiple possible selectors
            const fileInput = document.querySelector('input[type="file"]') ||
                document.querySelector('input[type="file"].x1s85apg') ||
                document.querySelector('input[accept*="image"]');
            console.log('[SmartSticker] Found file input:', fileInput);

            if (!messageInput) {
                console.error('[SmartSticker] Message input not found. Available inputs:',
                    document.querySelectorAll('[contenteditable="true"], textarea, input[type="text"]'));
                throw new Error('Message input not found');
            }
            if (!fileInput) {
                console.error('[SmartSticker] File input not found. Available file inputs:',
                    document.querySelectorAll('input[type="file"]'));
                throw new Error('File input not found');
            }

            // 3. Fetch and process GIF
            console.log('[SmartSticker] Fetching GIF from URL:', gifUrl);
            const response = await fetch(gifUrl);
            console.log('[SmartSticker] Fetch response status:', response.status);

            if (!response.ok) {
                console.error('[SmartSticker] Failed to fetch GIF:', response.status);
                throw new Error(`Failed to fetch GIF: ${response.status}`);
            }

            const blob = await response.blob();
            console.log('[SmartSticker] GIF blob size:', blob.size, 'type:', blob.type);

            // 4. Create File object with proper metadata
            const file = new File([blob], 'animation.gif', {
                type: 'image/gif',
                lastModified: Date.now()
            });
            console.log('[SmartSticker] Created File object:', file.name, file.type, file.size);

            // 5. Set up file input
            try {
                const dataTransfer = new DataTransfer();
                dataTransfer.items.add(file);
                fileInput.files = dataTransfer.files;
                console.log('[SmartSticker] Files set on input:', fileInput.files.length);
            } catch (error) {
                console.error('[SmartSticker] Error setting files:', error);
                throw new Error('Failed to set files on input: ' + error.message);
            }

            // 6. Trigger upload
            console.log('[SmartSticker] Dispatching change event');
            const changeEvent = new Event('change', { bubbles: true });
            fileInput.dispatchEvent(changeEvent);

            // 7. Wait for upload with progress check
            console.log('[SmartSticker] Waiting for upload to complete...');
            await new Promise(resolve => setTimeout(resolve, 2000));

            // 8. Try multiple methods to send
            const sendButton = document.querySelector('button[type="submit"]') ||
                document.querySelector('[role="button"][aria-label="Send"]') ||
                document.querySelector('[data-testid="send-button"]') ||
                document.querySelector('button[aria-label="Send message"]');

            if (sendButton) {
                console.log('[SmartSticker] Found send button, clicking...');
                sendButton.click();
            } else {
                console.log('[SmartSticker] No send button found, trying Enter key...');
                const enterEvent = new KeyboardEvent('keydown', {
                    key: 'Enter',
                    code: 'Enter',
                    keyCode: 13,
                    which: 13,
                    bubbles: true
                });
                messageInput.dispatchEvent(enterEvent);
            }

            console.log('[SmartSticker] Successfully sent GIF to Instagram');
            return true;
        } catch (error) {
            console.error('[SmartSticker] Error handling Instagram GIF:', error);
            // Log the current DOM state for debugging
            console.log('[SmartSticker] Current DOM state:', {
                messageInputs: document.querySelectorAll('[contenteditable="true"], textarea, input[type="text"]'),
                fileInputs: document.querySelectorAll('input[type="file"]'),
                sendButtons: document.querySelectorAll('button[type="submit"], [role="button"][aria-label="Send"]')
            });
            throw error;
        }
    }

    async handleTwitterGif(gifUrl) {
        try {
            console.log('[SmartSticker] Starting Twitter GIF handling');

            // Determine if we're in chat/DM or tweet composer
            const isDM = window.location.pathname.includes('/messages');
            console.log('[SmartSticker] Context:', isDM ? 'DM' : 'Tweet');

            // 1. Find the appropriate input and container
            let composerContainer, textInput, mediaButton;

            if (isDM) {
                // DM interface - try multiple selectors
                composerContainer = document.querySelector('[data-testid="dmComposerTextInput"]')?.closest('[role="group"]') ||
                    document.querySelector('[data-testid="dmComposerTextInput"]')?.closest('div[role="group"]') ||
                    document.querySelector('[data-testid="dmComposerTextInput"]')?.closest('div[class*="composer"]') ||
                    document.querySelector('[data-testid="dmComposerTextInput"]')?.parentElement;

                textInput = document.querySelector('[data-testid="dmComposerTextInput"]') ||
                    document.querySelector('[contenteditable="true"][role="textbox"][aria-label="Message"]') ||
                    document.querySelector('[contenteditable="true"][role="textbox"]');

                mediaButton = document.querySelector('[data-testid="dmComposerUploadButton"]') ||
                    document.querySelector('[aria-label="Add photos or video"]') ||
                    document.querySelector('input[type="file"]') ||
                    document.querySelector('[role="button"][aria-label="Add photos or video"]');
            } else {
                // Tweet composer
                composerContainer = document.querySelector('[data-testid="tweetTextarea_0"]')?.closest('[role="group"]') ||
                    document.querySelector('[data-testid="tweetTextarea_0"]')?.closest('div[role="group"]');

                textInput = document.querySelector('[data-testid="tweetTextarea_0"]') ||
                    document.querySelector('[contenteditable="true"][role="textbox"]');

                mediaButton = composerContainer?.querySelector('[data-testid="fileInput"]') ||
                    composerContainer?.querySelector('input[type="file"]') ||
                    composerContainer?.querySelector('[aria-label="Add photos or video"]');
            }

            // Log the found elements for debugging
            console.log('[SmartSticker] Found elements:', {
                composerContainer: composerContainer ? 'Found' : 'Not found',
                textInput: textInput ? 'Found' : 'Not found',
                mediaButton: mediaButton ? 'Found' : 'Not found'
            });

            if (!textInput) {
                throw new Error('Text input not found');
            }

            // If we don't have a container but have an input, use the input's parent
            if (!composerContainer && textInput) {
                composerContainer = textInput.parentElement;
                console.log('[SmartSticker] Using input parent as container');
            }

            if (!composerContainer) {
                throw new Error('Composer container not found');
            }

            // 2. Fetch the GIF
            console.log('[SmartSticker] Fetching GIF from URL:', gifUrl);
            const response = await fetch(gifUrl);
            if (!response.ok) throw new Error(`Failed to fetch GIF: ${response.status}`);

            const blob = await response.blob();
            const file = new File([blob], 'animation.gif', {
                type: 'image/gif',
                lastModified: Date.now()
            });

            // 3. Create DataTransfer and set files
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);

            // 4. Set the file on the input
            if (mediaButton) {
                if (mediaButton.tagName === 'INPUT') {
                    mediaButton.files = dataTransfer.files;
                    // Trigger change event
                    mediaButton.dispatchEvent(new Event('change', { bubbles: true }));
                } else {
                    // If it's a button, we need to find the hidden file input
                    const fileInput = document.querySelector('input[type="file"][accept*="image"]') ||
                        document.querySelector('input[type="file"]');
                    if (fileInput) {
                        fileInput.files = dataTransfer.files;
                        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
                    } else {
                        // If no file input found, try clicking the media button
                        mediaButton.click();
                        // Wait a bit for the file dialog to appear
                        await new Promise(resolve => setTimeout(resolve, 500));
                        // Try to find the file input again
                        const fileInput = document.querySelector('input[type="file"][accept*="image"]') ||
                            document.querySelector('input[type="file"]');
                        if (fileInput) {
                            fileInput.files = dataTransfer.files;
                            fileInput.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    }
                }
            } else {
                // If no media button found, try to find any file input
                const fileInput = document.querySelector('input[type="file"][accept*="image"]') ||
                    document.querySelector('input[type="file"]');
                if (fileInput) {
                    fileInput.files = dataTransfer.files;
                    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
                } else {
                    throw new Error('No file input found');
                }
            }

            // 5. Wait for upload to complete
            console.log('[SmartSticker] Waiting for upload to complete...');
            await new Promise(resolve => setTimeout(resolve, 2000));

            // 6. Find and click the appropriate send button
            let sendButton;
            if (isDM) {
                sendButton = document.querySelector('[data-testid="dmComposerSendButton"]') ||
                    document.querySelector('[role="button"][aria-label="Send"]') ||
                    document.querySelector('button[type="submit"]');
            } else {
                sendButton = document.querySelector('[data-testid="tweetButton"]') ||
                    document.querySelector('[data-testid="tweetButtonInline"]');
            }

            if (!sendButton) {
                throw new Error('Send button not found');
            }

            // 7. Click the send button
            sendButton.click();
            console.log('[SmartSticker] Successfully sent GIF to', isDM ? 'DM' : 'Tweet');
            return true;

        } catch (error) {
            console.error('[SmartSticker] Error handling Twitter GIF:', error);
            throw error;
        }
    }

    async handleWhatsAppGif(gifUrl) {
        try {
            console.log('[SmartSticker] Starting WhatsApp GIF handling');

            // Find the file input in WhatsApp's composer
            const fileInput = document.querySelector('input[type="file"]');
            if (!fileInput) {
                throw new Error('File input not found');
            }

            // Fetch the GIF and create a File object
            const response = await fetch(gifUrl);
            if (!response.ok) throw new Error(`Failed to fetch GIF: ${response.status}`);

            const blob = await response.blob();
            // Ensure we're creating a GIF file with the correct MIME type
            const file = new File([blob], 'animation.gif', {
                type: 'image/gif',
                lastModified: Date.now()
            });

            // Create DataTransfer and add the file
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);
            fileInput.files = dataTransfer.files;

            // Trigger the change event
            const changeEvent = new Event('change', { bubbles: true });
            fileInput.dispatchEvent(changeEvent);

            // Wait for upload to complete
            await new Promise(resolve => setTimeout(resolve, 1500));

            // Find and click the send button
            const sendButton = document.querySelector('[data-testid="send"]') ||
                document.querySelector('[data-icon="send"]') ||
                document.querySelector('[aria-label="Send"]');

            if (sendButton) {
                sendButton.click();
                console.log('[SmartSticker] Successfully sent GIF to WhatsApp');
                return true;
            } else {
                throw new Error('Send button not found');
            }
        } catch (error) {
            console.error('[SmartSticker] Error handling WhatsApp GIF:', error);
            throw error;
        }
    }

    async handleTelegramGif(gifUrl) {
        try {
            console.log('[SmartSticker] Starting Telegram GIF handling');

            // Find the file input in Telegram's composer
            const fileInput = document.querySelector('input[type="file"]');
            if (!fileInput) {
                throw new Error('File input not found');
            }

            // Fetch the GIF and create a File object
            const response = await fetch(gifUrl);
            if (!response.ok) throw new Error(`Failed to fetch GIF: ${response.status}`);

            const blob = await response.blob();
            const file = new File([blob], 'gif.gif', { type: 'image/gif' });

            // Create DataTransfer and add the file
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);
            fileInput.files = dataTransfer.files;

            // Trigger the change event
            fileInput.dispatchEvent(new Event('change', { bubbles: true }));

            // Wait for upload to complete
            await new Promise(resolve => setTimeout(resolve, 1500));

            // Find and click the send button
            const sendButton = document.querySelector('.btn-send') ||
                document.querySelector('[data-testid="send"]') ||
                document.querySelector('[aria-label="Send"]');

            if (sendButton) {
                sendButton.click();
                console.log('[SmartSticker] Successfully sent GIF to Telegram');
                return true;
            } else {
                throw new Error('Send button not found');
            }
        } catch (error) {
            console.error('[SmartSticker] Error handling Telegram GIF:', error);
            throw error;
        }
    }

    async handleSlackGif(gifUrl) {
        try {
            console.log('[SmartSticker] Starting Slack GIF handling');

            // Find the file input in Slack's composer
            const fileInput = document.querySelector('input[type="file"]');
            if (!fileInput) {
                throw new Error('File input not found');
            }

            // Fetch the GIF and create a File object
            const response = await fetch(gifUrl);
            if (!response.ok) throw new Error(`Failed to fetch GIF: ${response.status}`);

            const blob = await response.blob();
            const file = new File([blob], 'gif.gif', { type: 'image/gif' });

            // Create DataTransfer and add the file
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);
            fileInput.files = dataTransfer.files;

            // Trigger the change event
            fileInput.dispatchEvent(new Event('change', { bubbles: true }));

            // Wait for upload to complete
            await new Promise(resolve => setTimeout(resolve, 1500));

            // Find and click the send button
            const sendButton = document.querySelector('[data-qa="texty_send_button"]') ||
                document.querySelector('[aria-label="Send message"]');

            if (sendButton) {
                sendButton.click();
                console.log('[SmartSticker] Successfully sent GIF to Slack');
                return true;
            } else {
                throw new Error('Send button not found');
            }
        } catch (error) {
            console.error('[SmartSticker] Error handling Slack GIF:', error);
            throw error;
        }
    }

    async handleTeamsGif(gifUrl) {
        try {
            console.log('[SmartSticker] Starting Teams GIF handling');

            // Find the file input in Teams' composer
            const fileInput = document.querySelector('input[type="file"]');
            if (!fileInput) {
                throw new Error('File input not found');
            }

            // Fetch the GIF and create a File object
            const response = await fetch(gifUrl);
            if (!response.ok) throw new Error(`Failed to fetch GIF: ${response.status}`);

            const blob = await response.blob();
            const file = new File([blob], 'gif.gif', { type: 'image/gif' });

            // Create DataTransfer and add the file
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);
            fileInput.files = dataTransfer.files;

            // Trigger the change event
            fileInput.dispatchEvent(new Event('change', { bubbles: true }));

            // Wait for upload to complete
            await new Promise(resolve => setTimeout(resolve, 1500));

            // Find and click the send button
            const sendButton = document.querySelector('[data-tid="send-button"]') ||
                document.querySelector('[aria-label="Send"]');

            if (sendButton) {
                sendButton.click();
                console.log('[SmartSticker] Successfully sent GIF to Teams');
                return true;
            } else {
                throw new Error('Send button not found');
            }
        } catch (error) {
            console.error('[SmartSticker] Error handling Teams GIF:', error);
            throw error;
        }
    }

    insertStickerIntoInput(gifUrl) {
        if (!this.currentInput) return;

        const platform = this.currentPlatform;
        console.log('[SmartSticker] Inserting GIF for platform:', platform.name);

        try {
            switch (platform.name) {
                case 'Discord':
                    this.handleDiscordGif(gifUrl);
                    break;
                case 'Instagram':
                    this.handleInstagramGif(gifUrl);
                    break;
                case 'Twitter':
                    this.handleTwitterGif(gifUrl);
                    break;
                case 'WhatsApp':
                    this.handleWhatsAppGif(gifUrl);
                    break;
                case 'Telegram':
                    this.handleTelegramGif(gifUrl);
                    break;
                case 'Slack':
                    this.handleSlackGif(gifUrl);
                    break;
                case 'Teams':
                    this.handleTeamsGif(gifUrl);
                    break;
                default:
                    if (this.currentInput.value !== undefined) {
                        this.currentInput.value += ` ${gifUrl}`;
                        this.currentInput.dispatchEvent(new Event('input', { bubbles: true }));
                    } else if (this.currentInput.textContent !== undefined) {
                        this.currentInput.textContent += ` ${gifUrl}`;
                        this.currentInput.dispatchEvent(new Event('input', { bubbles: true }));
                    }
            }

            this.hideSuggestionBar();
        } catch (error) {
            console.error('[SmartSticker] Error inserting sticker:', error);
        }
    }

    // Platform-specific insertion methods
    insertDiscordContent(sticker) {
        const input = this.currentInput;
        if (input.contentEditable === 'true') {
            document.execCommand('insertText', false, sticker.url);
        } else {
            input.value += sticker.url;
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }

    insertTwitterContent(sticker) {
        const input = this.currentInput;
        if (input.contentEditable === 'true') {
            document.execCommand('insertText', false, sticker.url);
        } else {
            input.value += sticker.url;
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }

    insertRedditContent(sticker) {
        const input = this.currentInput;
        const markdownImage = `![GIF](${sticker.url})`;

        if (input.tagName === 'TEXTAREA') {
            input.value += markdownImage;
            input.dispatchEvent(new Event('input', { bubbles: true }));
        } else if (input.contentEditable === 'true') {
            document.execCommand('insertText', false, markdownImage);
        }
    }

    insertWhatsAppContent(sticker) {
        const input = this.currentInput;
        if (input.contentEditable === 'true') {
            document.execCommand('insertText', false, sticker.url);
        }
    }

    insertGenericContent(sticker) {
        const input = this.currentInput;
        const content = sticker.url;

        if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
            input.value += content;
            input.dispatchEvent(new Event('input', { bubbles: true }));
        } else if (input.contentEditable === 'true') {
            document.execCommand('insertText', false, content);
        }
    }

    setupUIEvents() {
        console.log('[SmartSticker] Setting up UI events...');

        // Close suggestion bar when clicking outside
        document.addEventListener('click', (event) => {
            if (this.suggestionBar &&
                !this.suggestionBar.contains(event.target) &&
                !this.currentInput?.contains(event.target)) {
                this.hideSuggestionBar();
            }
        });

        // Handle escape key
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && this.suggestionBar) {
                this.hideSuggestionBar();
            }
        });

        // Reposition on scroll/resize
        const repositionHandler = () => {
            if (this.suggestionBar && this.currentInput &&
                this.suggestionBar.classList.contains('show')) {
                this.positionSuggestionBar();
            }
        };

        window.addEventListener('resize', repositionHandler);
        window.addEventListener('scroll', repositionHandler, true);
    }

    injectStyles() {
        if (document.getElementById('smart-sticker-styles')) return;

        const style = document.createElement('style');
        style.id = 'smart-sticker-styles';
        style.textContent = `
            .smart-sticker-bar {
                position: fixed;
                background: var(--smart-sticker-bg, #ffffff);
                border: 1px solid var(--smart-sticker-border, #e1e5e9);
                border-radius: 12px;
                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
                padding: 12px;
                max-height: 200px;
                overflow-y: auto;
                z-index: 999999;
                opacity: 0;
                transform: translateY(10px);
                transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                display: none;
                visibility: hidden;
                width: 400px;
            }

            .smart-sticker-bar.show {
                opacity: 1;
                transform: translateY(0);
                display: block;
                visibility: visible;
            }
      
            .smart-sticker-bar[data-theme="dark"] {
                --smart-sticker-bg: #36393f;
                --smart-sticker-border: #40444b;
                --smart-sticker-text: #dcddde;
            }

            .smart-sticker-grid {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 8px;
                max-height: 160px;
                overflow-y: auto;
            }
      
            .smart-sticker-item {
                position: relative;
                aspect-ratio: 1;
                border-radius: 8px;
                overflow: hidden;
                cursor: pointer;
                transition: transform 0.15s ease;
                border: 2px solid transparent;
            }
      
            .smart-sticker-item:hover {
                transform: scale(1.05);
                border-color: #5865f2;
            }
      
            .smart-sticker-item img {
                width: 100%;
                height: 100%;
                object-fit: cover;
                border-radius: 6px;
            }
      
            .smart-sticker-loader,
            .smart-sticker-error {
                grid-column: 1 / -1;
                text-align: center;
                padding: 20px;
                color: var(--smart-sticker-text, #666666);
                font-size: 14px;
            }

            .smart-sticker-error {
                color: #ed4245;
            }

            /* Scrollbar styling */
            .smart-sticker-bar::-webkit-scrollbar,
            .smart-sticker-grid::-webkit-scrollbar {
                width: 6px;
            }

            .smart-sticker-bar::-webkit-scrollbar-track,
            .smart-sticker-grid::-webkit-scrollbar-track {
                background: transparent;
            }

            .smart-sticker-bar::-webkit-scrollbar-thumb,
            .smart-sticker-grid::-webkit-scrollbar-thumb {
                background: #c1c1c1;
                border-radius: 3px;
            }

            .smart-sticker-bar[data-theme="dark"]::-webkit-scrollbar-thumb,
            .smart-sticker-bar[data-theme="dark"] .smart-sticker-grid::-webkit-scrollbar-thumb {
                background: #4f545c;
            }
        `;

        document.head.appendChild(style);
    }

    // Cleanup method
    destroy() {
        console.log('[SmartSticker] Destroying extension...');

        // Clear timers
        clearTimeout(this.debounceTimer);
        clearTimeout(this.typingTimer);
        clearTimeout(this.reobserveTimer);

        // Remove suggestion bar
        if (this.suggestionBar) {
            this.suggestionBar.remove();
            this.suggestionBar = null;
        }

        // Clean up attached inputs
        document.querySelectorAll(this.currentPlatform.inputSelector).forEach(input => {
            if (input._smartStickerCleanup) {
                input._smartStickerCleanup();
                delete input._smartStickerCleanup;
            }
        });

        // Remove styles
        const styles = document.getElementById('smart-sticker-styles');
        if (styles) {
            styles.remove();
        }
    }

    showRateLimitMessage() {
        if (!this.suggestionBar) {
            this.createSuggestionBar();
        }

        const stickersContainer = this.suggestionBar.querySelector('.smart-sticker-grid');
        if (stickersContainer) {
            stickersContainer.innerHTML = `
                <div style="padding: 20px; text-align: center; color: #fff;">
                    <p>Rate limit reached. Please wait a moment before trying again.</p>
                    <p>API calls remaining: ${this.maxApiCalls - this.apiCallCount}</p>
                </div>
            `;
            this.showSuggestionBar();
        }
    }
}

// Initialize the extension only if we're in a Chrome extension context
if (typeof chrome !== 'undefined' && chrome.runtime) {
    try {
        const extension = new SmartStickerExtension();
        console.log('[SmartSticker] Extension initialized');
    } catch (error) {
        console.error('[SmartSticker] Failed to initialize extension:', error);
    }
} else {
    console.error('[SmartSticker] Not running in Chrome extension context');
}