const fs = require('fs').promises;
const path = require('path');

class PeerTubeService {
    constructor(config) {
        this.apiUrl = config.apiUrl || 'https://peertube.anitorrent.com/api/v1';
        this.username = config.username;
        this.password = config.password;
        this.tokenFile = config.tokenFile || '.peertube-token.json';
        this.tokens = null;
    }

    async ensureTokenDir() {
        try {
            const tokenDir = path.dirname(this.tokenFile);
            await fs.mkdir(tokenDir, { recursive: true });
        } catch (error) {
            if (error.code !== 'EEXIST') {
                console.error('Error creating token directory:', error.message);
            }
        }
    }

    async getOAuthClients() {
        const maxRetries = 3;
        const retryDelay = 2000;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const response = await fetch(`${this.apiUrl}/oauth-clients/local`);
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                const data = await response.json();
                return {
                    clientId: data.client_id,
                    clientSecret: data.client_secret
                };
            } catch (error) {
                if (attempt === maxRetries) {
                    throw new Error(`Error fetching OAuth clients after ${maxRetries} attempts: ${error.message}`);
                }
                
                await new Promise(resolve => setTimeout(resolve, retryDelay));
            }
        }
    }

    async loadTokensFromFile() {
        try {
            const data = await fs.readFile(this.tokenFile, 'utf8');
            this.tokens = JSON.parse(data);
            return this.tokens;
        } catch (error) {
            return null;
        }
    }

    async saveTokensToFile(tokens) {
        try {
            await this.ensureTokenDir();
            await fs.writeFile(this.tokenFile, JSON.stringify(tokens, null, 2));
            this.tokens = tokens;
        } catch (error) {
            console.error('Error saving tokens to file:', error.message);
        }
    }

    isTokenExpired(tokens) {
        if (!tokens || !tokens.expires_at) return true;
        return Date.now() >= tokens.expires_at;
    }

    async requestAccessToken(clientId, clientSecret, grantType = 'password', refreshToken = null) {
        const body = new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: grantType
        });

        if (grantType === 'password') {
            body.append('username', this.username);
            body.append('password', this.password);
        } else if (grantType === 'refresh_token' && refreshToken) {
            body.append('refresh_token', refreshToken);
        }

        try {
            const response = await fetch(`${this.apiUrl}/users/token`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: body
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            
            const tokens = {
                token_type: data.token_type,
                access_token: data.access_token,
                refresh_token: data.refresh_token,
                expires_in: data.expires_in,
                refresh_token_expires_in: data.refresh_token_expires_in,
                expires_at: Date.now() + (data.expires_in * 1000),
                refresh_expires_at: Date.now() + (data.refresh_token_expires_in * 1000)
            };

            await this.saveTokensToFile(tokens);
            return tokens;

        } catch (error) {
            throw new Error(`Error requesting access token: ${error.message}`);
        }
    }

    async getValidAccessToken() {
        let tokens = await this.loadTokensFromFile();
        const { clientId, clientSecret } = await this.getOAuthClients();

        if (!tokens || this.isTokenExpired(tokens)) {
            if (tokens && tokens.refresh_token && Date.now() < tokens.refresh_expires_at) {
                try {
                    tokens = await this.requestAccessToken(clientId, clientSecret, 'refresh_token', tokens.refresh_token);
                } catch (error) {
                    tokens = await this.requestAccessToken(clientId, clientSecret, 'password');
                }
            } else {
                tokens = await this.requestAccessToken(clientId, clientSecret, 'password');
            }
        }

        return tokens.access_token;
    }

    async importVideo(videoUrl, options = {}) {
        const {
            channelId = 3,
            name = null,
            privacy = 5,
            videoPasswords = ['AniTorrent108'],
            silent = false
        } = options;

        const accessToken = await this.getValidAccessToken();
        
        const videoName = name || this.extractVideoNameFromUrl(videoUrl);
        
        const body = {
            channelId,
            targetUrl: videoUrl,
            name: videoName,
            privacy,
            videoPasswords
        };

        try {
            const response = await fetch(`${this.apiUrl}/videos/imports`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${accessToken}`
                },
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
            }

            const result = await response.json();
            return result;

        } catch (error) {
            throw new Error(`Error importing video: ${error.message}`);
        }
    }

    extractVideoNameFromUrl(url) {
        try {
            const decodedUrl = decodeURIComponent(url);
            const urlPath = new URL(decodedUrl).pathname;
            const fileName = path.basename(urlPath);
            const nameWithoutExt = path.parse(fileName).name;
            return nameWithoutExt;
        } catch (error) {
            return 'Imported Video';
        }
    }

    async getImportStatus(importId) {
        const accessToken = await this.getValidAccessToken();
        
        try {
            const response = await fetch(`${this.apiUrl}/videos/imports/${importId}`, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            throw new Error(`Error getting import status: ${error.message}`);
        }
    }

    async listVideos(limit = 10) {
        const accessToken = await this.getValidAccessToken();
        
        try {
            const response = await fetch(`${this.apiUrl}/videos?count=${limit}`, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            return data;
        } catch (error) {
            throw new Error(`Error listing videos: ${error.message}`);
        }
    }

    async getVideoById(videoId) {
        const accessToken = await this.getValidAccessToken();
        
        try {
            const response = await fetch(`${this.apiUrl}/videos/${videoId}`, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            throw new Error(`Error getting video by ID: ${error.message}`);
        }
    }

    sleep(seconds) {
        return new Promise(resolve => setTimeout(resolve, seconds * 1000));
    }

    async waitForProcessing(videoId, maxWaitMinutes = 120) {
        const maxAttempts = (maxWaitMinutes * 60) / 10;
        let attempts = 0;
        let lastStatus = '';
        
        while (attempts < maxAttempts) {
            try {
                const video = await this.getVideoById(videoId);
                const state = video.state?.label || 'Unknown';
                
                if (state !== lastStatus) {
                    lastStatus = state;
                }
                
                const pendingStates = ['Pending', 'To import'];
                if (!pendingStates.includes(state)) {
                    return { success: true, finalState: state, video };
                }
                
                if (attempts < maxAttempts - 1) {
                    await this.sleep(10);
                }
                
            } catch (error) {
                if (attempts < maxAttempts - 1) {
                    await this.sleep(10);
                }
            }
            
            attempts++;
        }
        
        return { success: false, finalState: 'Timeout', video: null };
    }

    async getCurrentUser() {
        const accessToken = await this.getValidAccessToken();
        
        try {
            const response = await fetch(`${this.apiUrl}/users/me`, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            throw new Error(`Error getting current user: ${error.message}`);
        }
    }

    async validateCredentials() {
        try {
            await this.getValidAccessToken();
            return true;
        } catch (error) {
            return false;
        }
    }
}

module.exports = PeerTubeService; 