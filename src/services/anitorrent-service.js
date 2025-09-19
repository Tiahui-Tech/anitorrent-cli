const https = require('https');
const { URL } = require('url');
const ConfigManager = require('../utils/config');

class AniTorrentService {
    constructor(config = null) {
        this.apiUrl = 'https://api.anitorrent.com';
        this.config = config || new ConfigManager();
        this.apiKey = this.config.get('ANITORRENT_API_KEY');
        
        if (!this.apiKey || this.apiKey === 'your_anitorrent_api_key') {
            throw new Error('AniTorrent API key is required. Please configure ANITORRENT_API_KEY in your settings.');
        }
    }

    getAuthHeaders(additionalHeaders = {}) {
        return {
            'x-api-key': this.apiKey,
            ...additionalHeaders
        };
    }

    async makeRequest(url, options = {}) {
        return new Promise((resolve, reject) => {
            const urlObj = new URL(url);
            const requestOptions = {
                hostname: urlObj.hostname,
                port: urlObj.port || 443,
                path: urlObj.pathname + urlObj.search,
                method: options.method || 'GET',
                headers: options.headers || {}
            };

            const req = https.request(requestOptions, (res) => {
                let data = '';
                
                res.on('data', (chunk) => {
                    data += chunk;
                });
                
                res.on('end', () => {
                    try {
                        const result = {
                            status: res.statusCode,
                            data: data ? JSON.parse(data) : null
                        };
                        resolve(result);
                    } catch (error) {
                        resolve({
                            status: res.statusCode,
                            data: data
                        });
                    }
                });
            });

            req.on('error', (error) => {
                reject(error);
            });

            if (options.body) {
                req.write(options.body);
            }

            req.end();
        });
    }

    async getAnimeById(anilistId) {
        try {
            const response = await this.makeRequest(`${this.apiUrl}/anime/${anilistId}`, {
                headers: this.getAuthHeaders()
            });
            
            if (response.status < 200 || response.status >= 300) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            return response.data;
        } catch (error) {
            throw new Error(`Error fetching anime data: ${error.message}`);
        }
    }

    async updateCustomEpisode(anilistId, episodeNumber, episodeData) {
        const {
            peertubeId,
            uuid,
            shortUUID,
            password,
            title,
            embedUrl,
            thumbnailUrl,
            description,
            duration
        } = episodeData;

        const body = {
            idAnilist: parseInt(anilistId),
            episodeNumber: parseInt(episodeNumber),
            peertubeId,
            uuid,
            shortUUID,
            password: password || null,
            title: title || null,
            embedUrl,
            thumbnailUrl,
            description: description || null,
            duration: duration || null,
            isReady: false
        };

        try {
            const response = await this.makeRequest(
                `${this.apiUrl}/content/episodes`,
                {
                    method: 'POST',
                    headers: this.getAuthHeaders({
                        'Content-Type': 'application/json'
                    }),
                    body: JSON.stringify(body)
                }
            );

            if (response.status < 200 || response.status >= 300) {
                throw new Error(`HTTP error! status: ${response.status}, body: ${response.data}`);
            }

            return response.data;
        } catch (error) {
            throw new Error(`Error updating custom episode: ${error.message}`);
        }
    }

    async getAnimeEpisodes(anilistId) {
        try {
            const response = await this.makeRequest(`${this.apiUrl}/content/episodes/${anilistId}`, {
                headers: this.getAuthHeaders()
            });
            
            if (response.status < 200 || response.status >= 300) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            return response.data || [];
        } catch (error) {
            throw new Error(`Error fetching anime episodes: ${error.message}`);
        }
    }

    async getEpisodeByNumber(anilistId, episodeNumber) {
        try {
            const response = await this.makeRequest(`${this.apiUrl}/content/episodes/${anilistId}/${episodeNumber}`, {
                headers: this.getAuthHeaders()
            });
            
            if (response.status < 200 || response.status >= 300) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            return response.data || null;
        } catch (error) {
            throw new Error(`Error fetching episode: ${error.message}`);
        }
    }

    async getSubtitles(shortUUID) {
        try {
            const response = await this.makeRequest(`${this.apiUrl}/subtitles/${shortUUID}/all`, {
                headers: this.getAuthHeaders()
            });
            
            if (response.status < 200 || response.status >= 300) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            return response.data || [];
        } catch (error) {
            throw new Error(`Error fetching subtitles: ${error.message}`);
        }
    }

    async testConnection() {
        try {
            const response = await this.makeRequest(`${this.apiUrl}/health`, {
                headers: this.getAuthHeaders()
            });
            
            return {
                success: response.status >= 200 && response.status < 300,
                status: response.status,
                message: response.status >= 200 && response.status < 300 ? 'Connection successful' : `HTTP ${response.status}`
            };
        } catch (error) {
            return {
                success: false,
                status: null,
                message: error.message
            };
        }
    }
}

module.exports = AniTorrentService; 