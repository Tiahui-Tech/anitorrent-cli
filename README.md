# 🚀 AniTorrent CLI

A powerful command-line tool for video management with PeerTube and Cloudflare R2 integration. Streamline your video workflow with subtitle extraction, audio processing, video merging, cloud uploads, automated PeerTube imports, AI translation, and intelligent playlist creation.

## ✨ Features

- 🎬 **Video Processing**: Merge intro videos with main content while preserving all audio tracks and metadata
- 🎵 **Audio Management**: Extract and list audio tracks from videos with advanced format options
- 📝 **Subtitle Extraction**: Extract subtitles from local videos or compare with PeerTube playlists
- 🤖 **AI Translation**: Translate subtitle files using Claude AI with context-aware processing
- ☁️ **Cloudflare R2 Upload**: Direct file uploads to Cloudflare R2 storage
- 🎭 **PeerTube Integration**: Complete PeerTube video management (import, status, info, playlists)
- 📺 **Smart Playlists**: Auto-create playlists from videos grouped by anime/season using anitomy
- 🔄 **Auto Upload**: One-command upload to R2 + PeerTube import with processing monitoring
- 📺 **AniList Integration**: Update episode progress with anime ID tracking
- 📁 **Batch File Management**: Smart episode number adjustment and file parsing with anitomy
- ⚙️ **Interactive Setup**: Step-by-step configuration with credential validation
- 🌍 **Global Configuration**: Configuration persists across all directories and terminal sessions
- 📊 **Rich CLI Experience**: Beautiful output with spinners, progress indicators, and colored text

## 📦 Installation

### Prerequisites

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install nodejs npm ffmpeg mkvtoolnix
```

**Other Linux distributions:**
```bash
# Fedora
sudo dnf install nodejs npm ffmpeg mkvtoolnix

# CentOS/RHEL
sudo yum install epel-release
sudo yum install nodejs npm ffmpeg mkvtoolnix

# Arch Linux
sudo pacman -S nodejs npm ffmpeg mkvtoolnix-cli
```

**macOS:**
```bash
# Install Homebrew if not installed: https://brew.sh/
brew install node ffmpeg mkvtoolnix
```

**Windows:**
- Install Node.js from https://nodejs.org/
- Install FFmpeg from https://ffmpeg.org/download.html
- Install MKVToolNix from https://mkvtoolnix.download/
- Add both to your system PATH

### Install AniTorrent CLI

### From NPM (Recommended)
```bash
npm install -g @tiahui/anitorrent-cli@latest
```

### From Source
```bash
git clone https://github.com/Tiahui-Tech/anitorrent-cli.git
cd anitorrent-cli
npm install
npm link
```

### Verify Installation
```bash
anitorrent --version
anitorrent --help
```

### Ubuntu-Specific Notes

On Ubuntu, you may need to install additional packages for optimal performance:

```bash
# For better video codec support
sudo apt install ubuntu-restricted-extras

# For development tools (if installing from source)
sudo apt install build-essential

# Make sure the binary is executable
chmod +x /usr/local/bin/anitorrent
```

If you encounter permission issues, you can also install without sudo:
```bash
# Configure npm to use a different directory
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc

# Then install the CLI
npm install -g @tiahui/anitorrent-cli@latest
```

## 🔧 Quick Setup

### 1. Interactive Configuration (Recommended)
```bash
anitorrent config setup
```

This will guide you through:
- Cloudflare R2 credentials and settings
- PeerTube API configuration and authentication
- Claude AI API key for subtitle translation
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
│   ├── system-check           # Check system dependencies
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
│   ├── extract [playlist-id] # Extract subtitles
│   │   ├── --folder <path>    # Folder to search for videos
│   │   ├── --track <number>   # Subtitle track number
│   │   ├── --all              # Extract all subtitle tracks
│   │   └── --file <path>      # Extract from specific file
│   ├── translate [file]      # 🤖 AI translate subtitle files
│   │   ├── --output <path>    # Output file path
│   │   ├── --prompt <path>    # Custom system prompt file
│   │   └── --max-dialogs <n>  # Maximum dialogs to translate
│   └── rename [pattern]      # 📝 Rename subtitle files
│       ├── --include-translated # Include _translated files
│       ├── --anitomy          # Use anitomy parsing for names
│       ├── --prefix <text>    # Add prefix to filenames
│       ├── --suffix <text>    # Add suffix to filenames
│       ├── --replace <from,to> # Replace text in filenames
│       ├── --playlist         # Use PeerTube playlist for renaming
│       ├── --folder <path>    # Folder path for playlist mode
│       └── --dry-run          # Preview changes only
│
├── upload                     # 📤 File uploads
│   ├── r2 <file>             # Upload to Cloudflare R2
│   │   ├── --name <name>     # Custom filename
│   │   └── --timestamp       # Add timestamp to name
│   └── auto <file>           # Upload + PeerTube import
│       ├── --name <name>     # Video name
│   │   ├── --channel <id>    # Channel ID
│   │   ├── --privacy <1-5>   # Privacy level
│   │   ├── --password <pwd>  # Video password
│       ├── --wait <minutes>  # Processing timeout
│       ├── --keep-r2         # Keep R2 file after import
│       └── --anime-id <id>   # AniList anime ID for episode update
│
├── peertube                   # 🎭 PeerTube management
│   ├── import <url>          # Import video from URL
│   │   ├── --name <name>     # Video name
│   │   ├── --channel <id>    # Channel ID
│   │   ├── --privacy <1-5>   # Privacy level
│   │   ├── --password <pwd>  # Video password
│   │   └── --wait <minutes>  # Wait for processing
│   ├── status <import-id>    # Check import status
│   ├── get <video-id>        # Get video information
│   ├── list                  # List recent videos
│   │   └── --limit <number>  # Number of videos to show
│   └── playlist              # 🎯 Create smart playlists
│       └── --count <number>  # Number of videos to fetch (default: 200)
│
└── files                     # 📁 File and folder management
│       ├── rename             # Batch rename files and folders
│       │   ├── --path <directory> # Target directory path
│       │   ├── --start <number>   # Starting episode number
│       │   └── --dry-run          # Preview changes without executing
│       └── parse [file]         # 🔍 Parse anime file names with anitomy
│           ├── --path <directory> # Target directory path
│           ├── --recursive        # Search subdirectories
│           └── --json             # Output in JSON format
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

# Check system dependencies (Ubuntu/Linux)
anitorrent config system-check

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

# AI translate subtitle file
anitorrent subtitle translate subtitles.ass

# Translate all .ass files in current directory
anitorrent subtitle translate

# Translate with custom output and prompt
anitorrent subtitle translate subtitles.ass --output translated.ass --prompt custom-prompt.xml

# Translate with dialog limit
anitorrent subtitle translate subtitles.ass --max-dialogs 50

# Rename subtitle files using anitomy parsing
anitorrent subtitle rename --anitomy

# Rename using PeerTube playlist order
anitorrent subtitle rename 123 --playlist --folder /path/to/subtitles

# Add prefix and suffix to subtitle files
anitorrent subtitle rename --prefix "MyAnime_" --suffix "_ESP"

# Replace text in subtitle filenames
anitorrent subtitle rename --replace "old,new"

# Preview subtitle renaming
anitorrent subtitle rename --dry-run
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

# Create smart playlist from recent videos
anitorrent peertube playlist --count 300
```

### File Management
```bash
# Batch rename files and folders (preview mode)
anitorrent files rename --dry-run

# Rename files and folders in current directory
anitorrent files rename

# Rename files in specific directory starting from episode 5
anitorrent files rename --path /path/to/episodes --start 5

# Preview changes for specific directory
anitorrent files rename --path /path/to/episodes --dry-run

# Parse anime file names with anitomy
anitorrent files parse

# Parse specific file
anitorrent files parse "My.Anime.S01E01.1080p.mkv"

# Parse files in directory with subdirectories
anitorrent files parse --path /anime/folder --recursive

# Get JSON output for parsing
anitorrent files parse --json
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

**AI Translation (Optional):**
- Claude API Key

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

## 🤖 AI Subtitle Translation

The AI translation feature uses Claude AI to translate subtitle files with context-aware processing:

### Features:
- **Smart Context**: Groups dialog lines for better translation accuracy
- **Batch Processing**: Translate all .ass files in a directory
- **Custom Prompts**: Use custom system prompts for specific translation styles
- **Progress Tracking**: Real-time progress with detailed feedback
- **Error Handling**: Robust error handling with retry mechanisms

### Translation Workflow:
1. **Parse**: Extracts dialog lines from .ass subtitle files
2. **Group**: Organizes lines into logical groups for context
3. **Translate**: Uses Claude AI to translate each group
4. **Reconstruct**: Rebuilds the subtitle file with translations
5. **Save**: Outputs translated file with `_translated` suffix

### Custom Prompts:
Create custom translation prompts by placing them in XML files:
```xml
<system>
You are a professional subtitle translator specializing in anime.
Translate the following Japanese subtitles to Spanish.
Maintain the original timing and formatting.
Use natural, conversational Spanish appropriate for the target audience.
</system>
```

## 🎯 Smart Playlist Creation

The playlist feature automatically creates organized playlists from your PeerTube videos:

### How it works:
1. **Fetch Videos**: Downloads recent videos from PeerTube (configurable count)
2. **Parse Names**: Uses anitomy to extract anime metadata from video names
3. **Group by Series**: Organizes videos by anime title and season
4. **Interactive Selection**: Presents a list of found anime series
5. **Create Playlist**: Automatically creates and populates the playlist
6. **Episode Ordering**: Adds videos in correct episode order

### Example Workflow:
```bash
anitorrent peertube playlist --count 500
```

This will:
- Fetch the last 500 videos from PeerTube
- Parse them to find anime series (e.g., "Jujutsu Kaisen Season 2")
- Show you a list like:
  - Jujutsu Kaisen - Season 2 (24 episodes)
  - One Piece - Season 1 (15 episodes)
  - Attack on Titan - Season 4 (12 episodes)
- Let you select which series to convert into a playlist
- Create the playlist with proper episode ordering

## 📁 Batch File Rename

The `files rename` command is designed to intelligently rename episode files and their containing folders, adjusting episode numbers sequentially starting from 1 (or a custom starting number).

### How it works:

1. **Scans** the target directory for subdirectories containing video files
2. **Analyzes** each video file using anitomy to extract episode information
3. **Generates** new filenames with sequential episode numbers (E01, E02, E03, etc.)
4. **Renames** both the video files and their containing folders
5. **Preserves** all metadata like anime title, season, resolution, release group, etc.

### Example Structure:

**Before:**
```
/Episodes/
├── E25/
│   └── Jujutsu Kaisen S02E25 [1080p] [SubsPlease].mkv
├── E26/
│   └── Jujutsu Kaisen S02E26 [1080p] [SubsPlease].mkv
└── E27/
    └── Jujutsu Kaisen S02E27 [1080p] [SubsPlease].mkv
```

**After:**
```
/Episodes/
├── E01/
│   └── Jujutsu Kaisen S02E01 [1080p] [SubsPlease].mkv
├── E02/
│   └── Jujutsu Kaisen S02E02 [1080p] [SubsPlease].mkv
└── E03/
    └── Jujutsu Kaisen S02E03 [1080p] [SubsPlease].mkv
```

### Safety Features:

- **Preview Mode**: Use `--dry-run` to see changes before applying them
- **Interactive Confirmation**: Always asks for confirmation before making changes
- **Error Handling**: Reports any issues during the rename process
- **Detailed Logging**: Shows exactly what will be changed and why

## 🔍 File Parsing

The `files parse` command uses anitomy to extract detailed metadata from anime file names:

### Extracted Information:
- **Anime Title**: The main series name
- **Season**: Season number (if available)
- **Episode**: Episode number
- **Year**: Release year
- **Resolution**: Video quality (720p, 1080p, etc.)
- **Source**: Source type (BluRay, WEB, etc.)
- **Audio Language**: Audio track language
- **Subtitle Language**: Subtitle language
- **Release Group**: Fansub or release group
- **File Extension**: File format

### Output Formats:
- **Standard**: Human-readable colored output
- **JSON**: Machine-readable JSON format for scripting

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
│   │   ├── subtitle.js        # Subtitle extraction & AI translation
│   │   ├── upload.js          # File upload operations
│   │   ├── peertube.js        # PeerTube management & playlists
│   │   └── files.js           # File management & parsing
│   ├── services/              # Core services
│   │   ├── s3-service.js      # Cloudflare R2/S3 operations
│   │   ├── peertube-service.js # PeerTube API integration
│   │   ├── video-service.js   # Video processing service
│   │   ├── audio-service.js   # Audio processing service
│   │   ├── subtitle-service.js # Subtitle processing
│   │   ├── translation-service.js # AI translation service
│   │   ├── file-service.js    # File management service
│   │   └── anitorrent-service.js # AniList integration
│   └── utils/                 # Utilities
│       ├── logger.js          # Logging system
│       ├── config.js          # Configuration management
│       └── validators.js      # Input validation
├── data/
│   ├── intro.mp4              # Default intro video
│   └── translate-prompt.xml   # Default translation prompt
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

**System dependencies missing (Ubuntu/Linux):**
```bash
anitorrent config system-check
```

**AI Translation not working:**
- Ensure Claude API key is configured
- Check API key validity in configuration
- Verify .ass file format is correct

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

**Other Linux distributions:**
```bash
# Fedora
sudo dnf install ffmpeg mkvtoolnix

# CentOS/RHEL
sudo yum install epel-release
sudo yum install ffmpeg mkvtoolnix

# Arch Linux
sudo pacman -S ffmpeg mkvtoolnix-cli
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
- AI Translation with [Claude AI](https://www.anthropic.com/claude)
- Integrates with [PeerTube](https://joinpeertube.org/), [Cloudflare R2](https://developers.cloudflare.com/r2/), and [AniList](https://anilist.co/) 