const fs = require('fs').promises;
const path = require('path');
const os = require('os');

class ConfigManager {
    constructor(configFile = null) {
        this.globalConfigDir = this.getGlobalConfigDir();
        this.configFile = configFile || path.join(this.globalConfigDir, 'config.json');
        this.tokenFile = path.join(this.globalConfigDir, 'peertube-token.json');
        this.config = {};
        this.loadConfigSync();
    }

    getGlobalConfigDir() {
        const homeDir = os.homedir();
        let configDir;
        
        if (process.platform === 'win32') {
            configDir = path.join(homeDir, 'AppData', 'Roaming', 'anitorrent-cli');
        } else {
            configDir = path.join(homeDir, '.config', 'anitorrent-cli');
        }
        
        return configDir;
    }

    async ensureConfigDir() {
        try {
            await fs.mkdir(this.globalConfigDir, { recursive: true });
        } catch (error) {
            if (error.code !== 'EEXIST') {
                throw error;
            }
        }
    }

    loadConfigSync(customConfigFile = null) {
        const configPath = customConfigFile || this.configFile;
        try {
            const fsSync = require('fs');
            const configData = fsSync.readFileSync(configPath, 'utf8');
            this.config = JSON.parse(configData);
        } catch (error) {
            if (customConfigFile) {
                throw new Error(`Config file not found: ${configPath}`);
            }
            this.config = {};
        }
    }

    async loadConfig(customConfigFile = null) {
        const configPath = customConfigFile || this.configFile;
        try {
            const configData = await fs.readFile(configPath, 'utf8');
            this.config = JSON.parse(configData);
        } catch (error) {
            if (customConfigFile) {
                throw new Error(`Config file not found: ${configPath}`);
            }
            this.config = {};
        }
    }

    async saveConfig() {
        await this.ensureConfigDir();
        await fs.writeFile(this.configFile, JSON.stringify(this.config, null, 2));
    }

    get(key, defaultValue = null) {
        return this.config[key] || defaultValue;
    }

    set(key, value) {
        this.config[key] = value;
    }

    getRequired(key) {
        const value = this.config[key];
        if (!value) {
            throw new Error(`Required configuration variable ${key} is not set`);
        }
        return value;
    }

    async exists() {
        try {
            await fs.access(this.configFile);
            return true;
        } catch {
            return false;
        }
    }

    async createTemplate() {
        await this.ensureConfigDir();
        const template = {
            R2_ACCESS_KEY_ID: 'your_access_key_id',
            R2_SECRET_ACCESS_KEY: 'your_secret_access_key',
            R2_ENDPOINT: 'https://your-account-id.r2.cloudflarestorage.com',
            R2_BUCKET_NAME: 'your_bucket_name',
            R2_PUBLIC_DOMAIN: 'https://cdn.anitorrent.com',
            PEERTUBE_USERNAME: 'your_username',
            PEERTUBE_PASSWORD: 'your_password',
            PEERTUBE_API_URL: 'https://peertube.anitorrent.com/api/v1',
            DEFAULT_CHANNEL_ID: '',
            DEFAULT_PRIVACY_LEVEL: '5',
            DEFAULT_VIDEO_PASSWORD: 'AniTorrent108',
            CLAUDE_API_KEY: 'your_claude_api_key',
            ANITORRENT_API_KEY: 'your_anitorrent_api_key'
        };
        
        this.config = template;
        await this.saveConfig();
    }

    validateRequired() {
        const requiredVars = [
            'R2_ACCESS_KEY_ID',
            'R2_SECRET_ACCESS_KEY', 
            'R2_ENDPOINT',
            'R2_BUCKET_NAME',
            'PEERTUBE_USERNAME',
            'PEERTUBE_PASSWORD'
        ];

        const missing = requiredVars.filter(varName => !this.config[varName] || this.config[varName].startsWith('your_'));
        
        if (missing.length > 0) {
            throw new Error(`Missing required configuration variables: ${missing.join(', ')}`);
        }

        return true;
    }

    getR2Config() {
        return {
            accessKeyId: this.getRequired('R2_ACCESS_KEY_ID'),
            secretAccessKey: this.getRequired('R2_SECRET_ACCESS_KEY'),
            endpoint: this.getRequired('R2_ENDPOINT'),
            bucketName: this.getRequired('R2_BUCKET_NAME'),
            publicDomain: this.get('R2_PUBLIC_DOMAIN', 'https://cdn.anitorrent.com')
        };
    }

    getPeerTubeConfig() {
        return {
            apiUrl: this.get('PEERTUBE_API_URL', 'https://peertube.anitorrent.com/api/v1'),
            username: this.getRequired('PEERTUBE_USERNAME'),
            password: this.getRequired('PEERTUBE_PASSWORD'),
            tokenFile: this.tokenFile
        };
    }

    getDefaults() {
        return {
            channelId: this.get('DEFAULT_CHANNEL_ID') ? parseInt(this.get('DEFAULT_CHANNEL_ID')) : null,
            privacy: parseInt(this.get('DEFAULT_PRIVACY_LEVEL', '5')),
            videoPassword: this.get('DEFAULT_VIDEO_PASSWORD', '12345')
        };
    }

    async getDefaultChannelId() {
        const configuredChannelId = this.get('DEFAULT_CHANNEL_ID');
        if (configuredChannelId) {
            return parseInt(configuredChannelId);
        }

        const PeerTubeService = require('../services/peertube-service');
        const peertubeService = new PeerTubeService(this.getPeerTubeConfig());
        
        try {
            const userInfo = await peertubeService.getCurrentUser();
            if (userInfo.videoChannels && userInfo.videoChannels.length > 0) {
                return userInfo.videoChannels[0].id;
            }
        } catch (error) {
            throw new Error('Unable to determine default channel ID. Please configure DEFAULT_CHANNEL_ID');
        }
        
        throw new Error('No channels found for this user');
    }

    showConfig(hideSensitive = true) {
        const config = { ...this.config };
        
        if (hideSensitive) {
            const sensitiveKeys = [
                'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 
                'PEERTUBE_PASSWORD', 'DEFAULT_VIDEO_PASSWORD', 'CLAUDE_API_KEY', 'ANITORRENT_API_KEY'
            ];
            
            sensitiveKeys.forEach(key => {
                if (config[key]) {
                    config[key] = '***HIDDEN***';
                }
            });
        }

        return config;
    }

    getTranslationConfig() {
        return {
            apiKey: this.get('CLAUDE_API_KEY')
        };
    }

    getAniTorrentConfig() {
        return {
            apiKey: this.get('ANITORRENT_API_KEY'),
            apiUrl: 'https://api.anitorrent.com'
        };
    }

    getConfigPath() {
        return this.configFile;
    }
}

module.exports = ConfigManager; 