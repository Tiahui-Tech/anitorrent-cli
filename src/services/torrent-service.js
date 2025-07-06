const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const { Logger } = require('../utils/logger');

class TorrentService {
  constructor(options = {}) {
    this.client = null;
    this.logger = options.logger || new Logger({ verbose: false, quiet: false });
    this.downloadPath = options.downloadPath || path.join(os.tmpdir(), 'anitorrent-downloads');
    this.seedingTorrents = [];
    this.maxSeedingTorrents = options.maxSeedingTorrents || 10;
  }

  async initializeClient() {
    if (!this.client) {
      const { default: WebTorrent } = await import('webtorrent');
      this.client = new WebTorrent();
    }
  }

  async ensureDownloadDirectory() {
    try {
      await fs.access(this.downloadPath);
    } catch (error) {
      await fs.mkdir(this.downloadPath, { recursive: true });
    }
  }

  async downloadTorrent(torrentId, options = {}) {
    await this.initializeClient();
    
    return new Promise((resolve, reject) => {
      const {
        selectLargestFile = true,
        timeout = 300000,
        onProgress = null,
        keepSeeding = false
      } = options;

      const timeoutId = setTimeout(() => {
        this.client.remove(torrentId);
        reject(new Error(`Torrent download timeout after ${timeout / 1000} seconds`));
      }, timeout);

      this.client.add(torrentId, { path: this.downloadPath }, (torrent) => {
        this.logger.verbose(`Torrent added: ${torrent.infoHash}`);
        this.logger.verbose(`Files in torrent: ${torrent.files.length}`);

        let selectedFile;
        if (selectLargestFile) {
          selectedFile = torrent.files.reduce((largest, file) => 
            file.length > largest.length ? file : largest
          );
        } else {
          selectedFile = torrent.files[0];
        }

        if (!selectedFile) {
          clearTimeout(timeoutId);
          this.client.remove(torrentId);
          return reject(new Error('No files found in torrent'));
        }

        this.logger.verbose(`Selected file: ${selectedFile.name} (${this.formatBytes(selectedFile.length)})`);

        const filePath = path.join(this.downloadPath, selectedFile.path);

        let lastProgress = 0;
        const progressInterval = setInterval(() => {
          const progress = Math.round(torrent.progress * 100);
          if (progress !== lastProgress) {
            lastProgress = progress;
            if (onProgress) {
              onProgress(progress, selectedFile.name);
            }
          }
        }, 1000);

        torrent.on('done', async () => {
          clearTimeout(timeoutId);
          clearInterval(progressInterval);
          
          try {
            await fs.access(filePath);
            this.logger.verbose(`Download completed: ${filePath}`);
            
            if (keepSeeding) {
              this.addToSeedingQueue(torrent, selectedFile);
            }
            
            resolve({
              filePath,
              fileName: selectedFile.name,
              fileSize: selectedFile.length,
              torrentHash: torrent.infoHash,
              torrent: torrent
            });
          } catch (error) {
            reject(new Error(`Downloaded file not found: ${filePath}`));
          }
        });

        torrent.on('error', (error) => {
          clearTimeout(timeoutId);
          clearInterval(progressInterval);
          this.client.remove(torrentId);
          reject(new Error(`Torrent error: ${error.message}`));
        });
      });

      this.client.on('error', (error) => {
        clearTimeout(timeoutId);
        reject(new Error(`WebTorrent client error: ${error.message}`));
      });
    });
  }

  addToSeedingQueue(torrent, selectedFile) {
    const filePath = path.join(this.downloadPath, selectedFile.path);
    
    const seedingInfo = {
      torrent: torrent,
      fileName: selectedFile.name,
      filePath: filePath,
      hash: torrent.infoHash,
      addedAt: new Date()
    };

    this.seedingTorrents.push(seedingInfo);
    this.logger.verbose(`Added to seeding queue: ${selectedFile.name}`);

    if (this.seedingTorrents.length > this.maxSeedingTorrents) {
      const oldestSeeding = this.seedingTorrents.shift();
      this.logger.verbose(`Removing oldest seeding torrent: ${oldestSeeding.fileName}`);
      
      // Remove from WebTorrent client
      this.client.remove(oldestSeeding.hash);
      
      // Delete the physical file
      this.cleanupFile(oldestSeeding.filePath).catch(error => {
        this.logger.verbose(`Failed to cleanup old seeding file: ${error.message}`);
      });
    }
  }

  async stopSeeding(torrentHash, deleteFile = true) {
    const index = this.seedingTorrents.findIndex(s => s.hash === torrentHash);
    if (index !== -1) {
      const seedingInfo = this.seedingTorrents.splice(index, 1)[0];
      this.client.remove(torrentHash);
      
      if (deleteFile && seedingInfo.filePath) {
        try {
          await this.cleanupFile(seedingInfo.filePath);
          this.logger.verbose(`Stopped seeding and deleted file: ${seedingInfo.fileName}`);
        } catch (error) {
          this.logger.verbose(`Stopped seeding but failed to delete file: ${error.message}`);
        }
      } else {
        this.logger.verbose(`Stopped seeding: ${seedingInfo.fileName}`);
      }
      
      return true;
    }
    return false;
  }

  getSeedingStatus() {
    return this.seedingTorrents.map(s => ({
      fileName: s.fileName,
      filePath: s.filePath,
      hash: s.hash,
      addedAt: s.addedAt,
      uploaded: s.torrent.uploaded,
      downloaded: s.torrent.downloaded,
      ratio: s.torrent.downloaded > 0 ? (s.torrent.uploaded / s.torrent.downloaded) : 0,
      fileSize: s.torrent.length
    }));
  }

  getSeedingStats() {
    const totalFiles = this.seedingTorrents.length;
    const totalSize = this.seedingTorrents.reduce((sum, s) => sum + (s.torrent.length || 0), 0);
    const totalUploaded = this.seedingTorrents.reduce((sum, s) => sum + (s.torrent.uploaded || 0), 0);
    const totalDownloaded = this.seedingTorrents.reduce((sum, s) => sum + (s.torrent.downloaded || 0), 0);
    const avgRatio = totalDownloaded > 0 ? (totalUploaded / totalDownloaded) : 0;
    
    return {
      totalFiles,
      totalSize,
      totalUploaded,
      totalDownloaded,
      avgRatio,
      maxFiles: this.maxSeedingTorrents
    };
  }

  async cleanupFile(filePath) {
    try {
      await fs.unlink(filePath);
      this.logger.verbose(`Cleaned up file: ${filePath}`);
    } catch (error) {
      this.logger.verbose(`Failed to cleanup file: ${error.message}`);
    }
  }

  async cleanupDownloadDirectory() {
    try {
      const files = await fs.readdir(this.downloadPath);
      for (const file of files) {
        const filePath = path.join(this.downloadPath, file);
        const stats = await fs.stat(filePath);
        if (stats.isFile()) {
          await fs.unlink(filePath);
        }
      }
      this.logger.verbose(`Cleaned up download directory: ${this.downloadPath}`);
    } catch (error) {
      this.logger.verbose(`Failed to cleanup download directory: ${error.message}`);
    }
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  async destroy(cleanupFiles = false) {
    if (cleanupFiles) {
      // Clean up all seeding files
      for (const seedingInfo of this.seedingTorrents) {
        if (seedingInfo.filePath) {
          try {
            await this.cleanupFile(seedingInfo.filePath);
            this.logger.verbose(`Cleaned up seeding file: ${seedingInfo.fileName}`);
          } catch (error) {
            this.logger.verbose(`Failed to cleanup seeding file: ${error.message}`);
          }
        }
      }
    }
    
    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
    this.seedingTorrents = [];
  }
}

module.exports = TorrentService; 