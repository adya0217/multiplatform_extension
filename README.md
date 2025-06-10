# Multiplatform GIF Picker

A Chrome extension that adds a GIF picker to various social media and messaging platforms.

## Supported Platforms

- Discord
- Twitter/X
- Reddit
- Instagram
- Facebook
- WhatsApp Web
- Telegram Web
- Slack
- Microsoft Teams

## Features

- Easy GIF search using Tenor API
- Trending GIFs
- Dark/Light theme support
- Platform-specific input handling
- Responsive UI

## Installation

1. Clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the extension directory
5. Get a Tenor API key from [Tenor's Developer Portal](https://tenor.com/developer/dashboard)
6. Replace `YOUR_TENOR_API_KEY` in `src/api/tenorApi.js` with your actual API key

## Usage

1. Navigate to any supported platform
2. Look for the 🎬 button in the input area
3. Click the button to open the GIF picker
4. Search for GIFs or browse trending ones
5. Click a GIF to insert it into your message

## Development

The extension is built using vanilla JavaScript and is organized into modules:

- `src/platforms/platformDetector.js`: Platform-specific configurations
- `src/api/tenorApi.js`: Tenor API integration
- `src/ui/gifPicker.js`: GIF picker UI component
- `src/content.js`: Content script that injects the GIF picker

## License

MIT 