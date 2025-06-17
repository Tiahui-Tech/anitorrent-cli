# 🚀 AniTorrent CLI

A powerful command-line tool for video management with PeerTube and Cloudflare R2 integration. Streamline your video workflow with subtitle extraction, audio processing, video merging, cloud uploads, and automated PeerTube imports.

## ✨ Features

- 🎬 **Video Processing**: Merge intro videos with main content while preserving all audio tracks and metadata
- 🎵 **Audio Management**: Extract and list audio tracks from videos with advanced format options
- 📝 **Subtitle Extraction**: Extract subtitles from local videos or compare with PeerTube playlists
- ☁️ **Cloudflare R2 Upload**: Direct file uploads to Cloudflare R2 storage
- 🎭 **PeerTube Integration**: Complete PeerTube video management (import, status, info)
- 🔄 **Auto Upload**: One-command upload to R2 + PeerTube import with processing monitoring
- 📺 **AniList Integration**: Update episode progress with anime ID tracking
- ⚙️ **Interactive Setup**: Step-by-step configuration with credential validation
- 🌍 **Global Configuration**: Configuration persists across all directories and terminal sessions
- 📊 **Rich CLI Experience**: Beautiful output with spinners, progress indicators, and colored text

## 📦 Installation

### From Source
```bash
git clone <repository-url>
cd anitorrent-cli
npm install
npm link
```

### From NPM (when published)
```bash
npm install -g anitorrent-cli
```

### Verify Installation
```bash
anitorrent --version
anitorrent --help
```

## 🔧 Quick Setup

### 1. Interactive Configuration (Recommended)
```bash
anitorrent config setup
```

This will guide you through:
- Cloudflare R2 credentials and settings
- PeerTube API configuration and authentication
- Default channel and privacy settings
- Credential validation

**Configuration is saved globally** - you only need to do this once!

### 2. Manual Configuration
```bash
anitorrent config init
anitorrent config show
```

Then run `anitorrent config setup` to configure your settings interactively.

## 📋 Commands Overview

```
anitorrent <command> [subcommand] [options]

Commands:
├── config                      # 🔧 Configuration management
│   ├── setup                  # Interactive configuration
│   ├── init                   # Create configuration template
│   ├── check                  # Verify configuration
│   ├── show                   # Display current config
│   ├── test                   # Test service connections
│   └── reset                  # Reset configuration
│
├── video                      # 🎬 Video processing operations
│   └── merge <input>          # Merge intro with input video
│       ├── --output <path>    # Output file path
│       └── --intro <path>     # Custom intro file path
│
├── audio                      # 🎵 Audio track management
│   ├── list <file>           # List audio tracks from video
│   └── extract [file]        # Extract audio tracks
│       ├── --folder <path>    # Folder to search for videos
│       ├── --track <number>   # Specific audio track number
│       ├── --format <format>  # Output format (mp3, aac, flac, wav, ogg)
│       ├── --bitrate <rate>   # Audio bitrate (192k, 256k, 320k)
│       ├── --all-tracks       # Extract all audio tracks
│       ├── --advanced         # Use mkvmerge for better naming
│       └── --prefix <prefix>  # Custom prefix for output files
│
├── subtitle                   # 📝 Subtitle management
│   ├── list <file>           # List subtitle tracks from video
│   └── extract [playlist-id] # Extract subtitles
│       ├── --folder <path>    # Folder to search for videos
│       ├── --track <number>   # Subtitle track number
│       ├── --all              # Extract all subtitle tracks
│       └── --file <path>      # Extract from specific file
│
├── upload                     # 📤 File uploads
│   ├── r2 <file>             # Upload to Cloudflare R2
│   │   ├── --name <name>     # Custom filename
│   │   └── --timestamp       # Add timestamp to name
│   └── auto <file>           # Upload + PeerTube import
│       ├── --name <name>     # Video name
│       ├── --channel <id>    # Channel ID
│       ├── --privacy <1-5>   # Privacy level
│       ├── --password <pwd>  # Video password
│       ├── --wait <minutes>  # Processing timeout
│       ├── --keep-r2         # Keep R2 file after import
│       └── --anime-id <id>   # AniList anime ID for episode update
│
└── peertube                   # 🎭 PeerTube management
    ├── import <url>          # Import video from URL
    │   ├── --name <name>     # Video name
    │   ├── --channel <id>    # Channel ID
    │   ├── --privacy <1-5>   # Privacy level
    │   ├── --password <pwd>  # Video password
    │   └── --wait <minutes>  # Wait for processing
    ├── status <import-id>    # Check import status
    ├── get <video-id>        # Get video information
    └── list                  # List recent videos
        └── --limit <number>  # Number of videos to show
```

## 🎯 Usage Examples

### Configuration
```bash
# Interactive setup with validation (one-time setup)
anitorrent config setup

# Check current configuration
anitorrent config check

# Test service connections
anitorrent config test

# Show configuration (hides sensitive values)
anitorrent config show

# Show configuration file location
anitorrent config show
```

### Video Processing
```bash
# Merge intro with video (preserves all audio tracks and metadata)
anitorrent video merge episode.mkv

# Merge with custom intro and output path
anitorrent video merge episode.mkv --intro custom-intro.mp4 --output final-episode.mkv
```

### Audio Management
```bash
# List all audio tracks in a video
anitorrent audio list video.mkv

# Extract Spanish Latino audio (auto-detected)
anitorrent audio extract video.mkv

# Extract specific audio track
anitorrent audio extract video.mkv --track 1

# Extract all audio tracks with advanced naming
anitorrent audio extract video.mkv --all-tracks --advanced

# Extract from all videos in folder with custom format
anitorrent audio extract --folder /path/to/videos --format flac --bitrate 320k

# Extract with custom prefix
anitorrent audio extract video.mkv --prefix "MyAnime_EP01" --format aac
```

### Subtitle Management
```bash
# List all subtitle tracks in a video
anitorrent subtitle list video.mkv

# Extract Spanish Latino subtitles (auto-detected)
anitorrent subtitle extract

# Extract from specific folder
anitorrent subtitle extract --folder /path/to/videos

# Extract specific subtitle track
anitorrent subtitle extract --track 0

# Extract all subtitle tracks from specific file
anitorrent subtitle extract --file video.mkv --all

# Compare with PeerTube playlist
anitorrent subtitle extract 123 --track 0
```

### File Upload
```bash
# Simple R2 upload
anitorrent upload r2 video.mp4

# Upload with custom name and timestamp
anitorrent upload r2 video.mp4 --name "my-video" --timestamp

# Auto upload (R2 + PeerTube)
anitorrent upload auto video.mp4

# Auto upload with AniList integration
anitorrent upload auto video.mp4 \
  --name "My Anime Episode 01" \
  --channel 5 \
  --privacy 3 \
  --wait 60 \
  --keep-r2 \
  --anime-id 12345
```

### PeerTube Management
```bash
# Import video from URL
anitorrent peertube import "https://example.com/video.mp4"

# Import with custom settings
anitorrent peertube import "https://example.com/video.mp4" \
  --name "My Video" \
  --channel 3 \
  --privacy 5 \
  --wait 120

# Check import status
anitorrent peertube status 123

# Get video information
anitorrent peertube get 456

# List recent videos
anitorrent peertube list --limit 20
```

## ⚙️ Configuration

### Global Configuration System

AniTorrent CLI uses a global configuration system that stores settings in:

**Windows:** `%APPDATA%\anitorrent-cli\config.json`
**macOS/Linux:** `~/.config/anitorrent-cli/config.json`

This means you only need to configure once, and it works from any directory!

### Required Configuration

**Cloudflare R2:**
- R2 Access Key ID
- R2 Secret Access Key  
- R2 Endpoint URL
- R2 Bucket Name

**PeerTube:**
- Username
- Password

### Optional Configuration
- R2 Public Domain (default: https://cdn.anitorrent.com)
- PeerTube API URL (default: https://peertube.anitorrent.com/api/v1)
- Default Channel ID
- Default Privacy Level (default: 5)
- Default Video Password (default: 12345)

### Privacy Levels
- `1` - Public
- `2` - Unlisted  
- `3` - Private
- `4` - Internal
- `5` - Password Protected

### Audio Formats
- `mp3` - MP3 (default)
- `aac` - Advanced Audio Coding
- `flac` - Free Lossless Audio Codec
- `wav` - Waveform Audio File Format
- `ogg` - Ogg Vorbis

### Audio Bitrates
- `128k` - 128 kbps
- `192k` - 192 kbps (default)
- `256k` - 256 kbps
- `320k` - 320 kbps

## 🌟 Global Options

| Option | Description | Example |
|--------|-------------|---------|
| `--verbose, -v` | Detailed output | `anitorrent upload r2 video.mp4 -v` |
| `--quiet, -q` | Minimal output | `anitorrent upload r2 video.mp4 -q` |
| `--config <file>` | Custom config file | `anitorrent --config custom-config.json config check` |
| `--help, -h` | Show help | `anitorrent --help` |

## 🏗️ Architecture

```
anitorrent-cli/
├── bin/
│   └── anitorrent.js           # CLI entry point
├── src/
│   ├── commands/               # Command implementations
│   │   ├── config.js          # Configuration management
│   │   ├── video.js           # Video processing operations
│   │   ├── audio.js           # Audio track management
│   │   ├── subtitle.js        # Subtitle extraction
│   │   ├── upload.js          # File upload operations
│   │   └── peertube.js        # PeerTube management
│   ├── services/              # Core services
│   │   ├── s3-service.js      # Cloudflare R2/S3 operations
│   │   ├── peertube-service.js # PeerTube API integration
│   │   ├── video-service.js   # Video processing service
│   │   ├── audio-service.js   # Audio processing service
│   │   ├── subtitle-service.js # Subtitle processing
│   │   └── anitorrent-service.js # AniList integration
│   └── utils/                 # Utilities
│       ├── logger.js          # Logging system
│       ├── config.js          # Configuration management
│       └── validators.js      # Input validation
├── data/
│   └── intro.mp4              # Default intro video
├── package.json
└── README.md
```

## 🔍 Troubleshooting

### Common Issues

**Configuration not found:**
```bash
anitorrent config setup
```

**Invalid credentials:**
```bash
anitorrent config test
```

**File not found:**
- Use absolute paths or ensure files exist
- Check file permissions

**PeerTube connection issues:**
- Verify API URL format
- Check username/password
- Ensure PeerTube instance is accessible

**FFmpeg/MKVToolNix not found:**
- Install FFmpeg: https://ffmpeg.org/download.html
- Install MKVToolNix: https://mkvtoolnix.download/
- Ensure they're available in your system PATH

**Audio/Video processing issues:**
- Verify input file format is supported
- Check available disk space
- Ensure proper file permissions

**Configuration location:**
```bash
anitorrent config show
```

### Debug Mode
```bash
anitorrent --verbose <command>
```

### Dependencies

**Required for video/audio processing:**
- FFmpeg (ffmpeg, ffprobe)
- MKVToolNix (mkvmerge, mkvextract)

**Installation:**

**Windows:**
- Download from official websites
- Add to system PATH

**macOS:**
```bash
brew install ffmpeg mkvtoolnix
```

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install ffmpeg mkvtoolnix
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details.

## 🙏 Acknowledgments

- Built with [Commander.js](https://github.com/tj/commander.js/)
- UI powered by [Inquirer.js](https://github.com/SBoudrias/Inquirer.js/) and [Ora](https://github.com/sindresorhus/ora)
- Video processing with [FFmpeg](https://ffmpeg.org/) and [MKVToolNix](https://mkvtoolnix.download/)
- Anime parsing with [Anitomyscript](https://github.com/Xtansia/anitomyscript)
- Integrates with [PeerTube](https://joinpeertube.org/), [Cloudflare R2](https://developers.cloudflare.com/r2/), and [AniList](https://anilist.co/) 