const https = require('https');
const { URL } = require('url');
const { logger } = require('../utils/logger');

class AniZipService {
    constructor() {
        this.apiUrl = 'https://api.ani.zip';
    }

    async makeRequest(url) {
        return new Promise((resolve, reject) => {
            const urlObj = new URL(url);
            const requestOptions = {
                hostname: urlObj.hostname,
                port: urlObj.port || 443,
                path: urlObj.pathname + urlObj.search,
                method: 'GET',
                headers: {
                    'User-Agent': 'anitorrent-cli/1.1.11'
                }
            };

            const req = https.request(requestOptions, (res) => {
                let data = '';
                
                res.on('data', (chunk) => {
                    data += chunk;
                });
                
                res.on('end', () => {
                    try {
                        if (res.statusCode === 200) {
                            const result = data ? JSON.parse(data) : null;
                            resolve(result);
                        } else if (res.statusCode === 404) {
                            resolve(null);
                        } else {
                            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                        }
                    } catch (error) {
                        reject(new Error(`Failed to parse JSON response: ${error.message}`));
                    }
                });
            });

            req.on('error', (error) => {
                reject(new Error(`Request failed: ${error.message}`));
            });

            req.setTimeout(10000, () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });

            req.end();
        });
    }

    async getAnimeMappings(anilistId) {
        try {
            const url = `${this.apiUrl}/mappings?anilist_id=${anilistId}`;
            const data = await this.makeRequest(url);
            return data;
        } catch (error) {
            logger.debug(`Failed to fetch ani.zip mappings for AniList ID ${anilistId}: ${error.message}`);
            return null;
        }
    }

    async getAnimeMappingsByAniDbId(anidbId) {
        try {
            const url = `${this.apiUrl}/mappings?anidb_id=${anidbId}`;
            const data = await this.makeRequest(url);
            return data;
        } catch (error) {
            logger.debug(`Failed to fetch ani.zip mappings for AniDB ID ${anidbId}: ${error.message}`);
            return null;
        }
    }

    getEpisodeImageUrl(mappings, episodeNumber) {
        if (!mappings || !mappings.episodes) {
            return null;
        }

        const episode = mappings.episodes[episodeNumber.toString()];
        return episode?.image || null;
    }
}

module.exports = AniZipService;
