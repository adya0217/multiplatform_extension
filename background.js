// Background script to handle Ollama API calls
const OLLAMA_URL = 'http://127.0.0.1:11434';
const OLLAMA_MODEL = 'mistral:7b-instruct';
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second

async function checkOllamaConnection() {
    try {
        const response = await fetch(`${OLLAMA_URL}/api/tags`, {
            method: 'GET',
            headers: {
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            console.error('[SmartSticker] Ollama connection check failed:', response.status, response.statusText);
            return false;
        }

        const data = await response.json();
        console.log('[SmartSticker] Available models:', data.models);
        const hasModel = data.models.some(model => model.name === OLLAMA_MODEL);
        if (!hasModel) {
            console.error('[SmartSticker] Model not found:', OLLAMA_MODEL);
            return false;
        }
        return true;
    } catch (error) {
        console.error('[SmartSticker] Ollama connection check failed:', error);
        return false;
    }
}

async function analyzeTextWithOllama(text) {
    try {
        console.log('[SmartSticker] Starting text analysis with Ollama');

        // First check if Ollama is running and accessible
        const checkResponse = await fetch('http://127.0.0.1:11434/api/tags', {
            method: 'GET',
            headers: {
                'Accept': 'application/json'
            },
            timeout: 5000 // 5 second timeout for initial check
        });

        if (!checkResponse.ok) {
            throw new Error(`Ollama API not accessible: ${checkResponse.status}`);
        }

        console.log('[SmartSticker] Ollama API is accessible, proceeding with analysis');

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

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

        try {
            const response = await fetch('http://127.0.0.1:11434/api/generate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    model: 'mistral:7b-instruct',
                    prompt: prompt,
                    stream: false,
                    options: {
                        temperature: 0.3,
                        top_p: 0.9,
                        top_k: 40
                    }
                }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorText = await response.text();
                console.error('[SmartSticker] Ollama API error response:', errorText);
                throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            console.log('[SmartSticker] Received Ollama response:', data);

            if (!data.response) {
                throw new Error('Invalid response from Ollama API');
            }

            // Parse the keywords from the response
            const keywords = data.response
                .split(',')
                .map(k => k.trim())
                .filter(k => k.length > 0);

            // If no good keywords were found, use a fallback based on the input text
            if (keywords.length === 0) {
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

            return {
                success: true,
                data: {
                    sentiment: 'neutral',
                    emotions: keywords,
                    intensity: 'medium',
                    gif_query: keywords.join(' ')
                }
            };
        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error('Analysis timed out after 30 seconds');
            }
            throw error;
        }
    } catch (error) {
        console.error('[SmartSticker] Error analyzing text with Ollama:', error);
        // Return a fallback response with basic keyword extraction
        const fallbackKeywords = text
            .toLowerCase()
            .split(/\s+/)
            .filter(word => word.length > 3 && !['what', 'when', 'where', 'which', 'whose', 'whom', 'this', 'that', 'these', 'those'].includes(word));

        return {
            success: false,
            error: `Failed to analyze text: ${error.message}`,
            data: {
                sentiment: 'neutral',
                emotions: fallbackKeywords,
                intensity: 'medium',
                gif_query: fallbackKeywords.join(' ')
            }
        };
    }
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('[SmartSticker] Received message:', request);

    if (request.type === 'PING') {
        sendResponse({ success: true, message: 'PONG' });
        return false; // Synchronous response
    }

    if (request.type === 'ANALYZE_WITH_OLLAMA') {
        // Set a timeout for the analysis
        const timeout = setTimeout(() => {
            sendResponse({
                success: false,
                error: 'Analysis timed out',
                fallback: {
                    keywords: request.text.split(' ').filter(word => word.length > 3),
                    sentiment: 'neutral'
                }
            });
        }, 10000); // 10 second timeout

        analyzeTextWithOllama(request.text)
            .then(response => {
                clearTimeout(timeout);
                console.log('[SmartSticker] Sending response to content script:', response);
                sendResponse(response);
            })
            .catch(error => {
                clearTimeout(timeout);
                console.error('[SmartSticker] Error in background script:', error);
                sendResponse({
                    success: false,
                    error: error.message,
                    fallback: {
                        keywords: request.text.split(' ').filter(word => word.length > 3),
                        sentiment: 'neutral'
                    }
                });
            });
        return true; // Keep the message channel open for async response
    }
});

// Initialize the background script
console.log('[SmartSticker] Background script initialized'); 