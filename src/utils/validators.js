const validator = require('validator');
const fs = require('fs').promises;

class Validators {
    static isValidUrl(url) {
        return validator.isURL(url, {
            protocols: ['http', 'https'],
            require_protocol: true
        });
    }

    static isValidEmail(email) {
        return validator.isEmail(email);
    }

    static async fileExists(filePath) {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    static resolvePath(inputPath) {
        const path = require('path');
        
        if (path.isAbsolute(inputPath)) {
            return inputPath;
        }
        
        if (inputPath.startsWith('./') || inputPath.startsWith('.\\')) {
            return path.resolve(process.cwd(), inputPath.substring(2));
        }
        
        if (inputPath.startsWith('../') || inputPath.startsWith('..\\')) {
            return path.resolve(process.cwd(), inputPath);
        }
        
        return path.resolve(process.cwd(), inputPath);
    }

    static async validateFilePath(inputPath) {
        const resolvedPath = this.resolvePath(inputPath);
        const exists = await this.fileExists(resolvedPath);
        
        return {
            originalPath: inputPath,
            resolvedPath,
            exists,
            isAbsolute: require('path').isAbsolute(inputPath)
        };
    }

    static isValidVideoFile(filename) {
        const videoExtensions = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm'];
        const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));
        return videoExtensions.includes(ext);
    }

    static isValidSubtitleFile(filename) {
        const subtitleExtensions = ['.ass', '.srt', '.vtt', '.sub'];
        const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));
        return subtitleExtensions.includes(ext);
    }

    static isValidChannelId(channelId) {
        const id = parseInt(channelId);
        return !isNaN(id) && id > 0;
    }

    static isValidPrivacyLevel(privacy) {
        const level = parseInt(privacy);
        return !isNaN(level) && level >= 1 && level <= 5;
    }

    static isValidSubtitleTrack(track) {
        const trackNum = parseInt(track);
        return !isNaN(trackNum) && trackNum >= 0;
    }

    static validateR2Config(config) {
        const required = ['accessKeyId', 'secretAccessKey', 'endpoint', 'bucketName'];
        const missing = required.filter(key => !config[key]);
        
        if (missing.length > 0) {
            throw new Error(`Missing R2 configuration: ${missing.join(', ')}`);
        }

        if (!this.isValidUrl(config.endpoint)) {
            throw new Error('Invalid R2 endpoint URL');
        }

        if (config.publicDomain && !this.isValidUrl(config.publicDomain)) {
            throw new Error('Invalid R2 public domain URL');
        }

        return true;
    }

    static validatePeerTubeConfig(config) {
        const required = ['username', 'password'];
        const missing = required.filter(key => !config[key]);
        
        if (missing.length > 0) {
            throw new Error(`Missing PeerTube configuration: ${missing.join(', ')}`);
        }

        if (config.apiUrl && !this.isValidUrl(config.apiUrl)) {
            throw new Error('Invalid PeerTube API URL');
        }

        return true;
    }

    static sanitizeFilename(filename) {
        return filename.replace(/[<>:"/\\|?*]/g, '_').trim();
    }

    static formatFileSize(bytes) {
        const sizes = ['B', 'KB', 'MB', 'GB'];
        if (bytes === 0) return '0 B';
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
    }

    static formatDuration(seconds) {
        if (!seconds) return 'Unknown';
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
}

module.exports = Validators; 