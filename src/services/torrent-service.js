const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const { Logger } = require('../utils/logger');

class TorrentService {
  constructor(options = {}) {
    this.client = null;
    this.logger = options.logger || new Logger({ verbose: false, quiet: false });
    this.downloadPath = options.downloadPath || path.join(os.homedir(), '.anitorrent', 'downloads');
    this.seedingTorrents = [];
    this.maxSeedingTorrents = options.maxSeedingTorrents || 10;
    this.torrentPort = options.torrentPort || null;
  }

  async findFreePort(startPort = 6881) {
    const net = require('net');
    
    return new Promise((resolve) => {
      const server = net.createServer();
      
      server.listen(startPort, () => {
        const port = server.address().port;
        server.close(() => {
          resolve(port);
        });
      });
      
      server.on('error', () => {
        resolve(this.findFreePort(startPort + 1));
      });
    });
  }

  async initializeClient() {
    if (!this.client) {
      const { default: WebTorrent } = await import('webtorrent');
      
      // More aggressive limits for Windows ENOBUFS issue
      let clientOptions = {
        dht: false, // Disable DHT to reduce connections
        tracker: true,
        lsd: false, // Disable LSD to reduce connections
        natUpnp: false,
        natPmp: false,
        // Very conservative connection limits for Windows
        maxConns: 20,
        // Disable UTP which causes ENOBUFS on Windows
        utp: false,
        // Only use TCP connections
        tcp: true,
        // Reduce DHT connections
        dhtPort: 0,
        // Shorter connection timeout
        timeout: 15000,
        // Limit peer connections per torrent
        maxConnections: 10
      };
      
      if (this.torrentPort) {
        clientOptions.torrentPort = this.torrentPort;
      } else {
        const freePort = await this.findFreePort();
        clientOptions.torrentPort = freePort;
        this.logger.verbose(`Using torrent port: ${freePort}`);
      }
      
      this.client = new WebTorrent(clientOptions);
      
      this.client.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
          this.logger.verbose(`Port ${error.port || 'default'} is in use, WebTorrent will try another port`);
        } else if (error.code === 'ENOBUFS') {
          this.logger.warning('Network buffer space exhausted - destroying client and recreating...');
          this.forceClientRecreation();
        } else {
          this.logger.verbose(`WebTorrent client error: ${error.message}`);
        }
      });
      
      // Set up periodic cleanup
      this.setupPeriodicCleanup();
    }
  }

  async ensureDownloadDirectory() {
    try {
      await fs.access(this.downloadPath);
    } catch (error) {
      await fs.mkdir(this.downloadPath, { recursive: true });
    }
  }

  async cleanupExistingFiles() {
    try {
      const files = await fs.readdir(this.downloadPath);
      let cleanedCount = 0;
      
      for (const file of files) {
        const filePath = path.join(this.downloadPath, file);
        const stats = await fs.stat(filePath);
        
        if (stats.isFile()) {
          await fs.unlink(filePath);
          cleanedCount++;
        }
      }
      
      if (cleanedCount > 0) {
        this.logger.info(`Cleaned up ${cleanedCount} existing files from download directory`);
      }
      
      this.seedingTorrents = [];
      
      return cleanedCount;
    } catch (error) {
      this.logger.verbose(`Failed to cleanup existing files: ${error.message}`);
      return 0;
    }
  }

  async checkDiskSpace(requiredSizeBytes = 0) {
    const { default: checkDiskSpace } = await import('check-disk-space');
    
    try {
      const diskSpace = await checkDiskSpace(this.downloadPath);
      const freeSpaceGB = diskSpace.free / (1024 * 1024 * 1024);
      const requiredSpaceGB = requiredSizeBytes / (1024 * 1024 * 1024);
      
      this.logger.verbose(`Free disk space: ${freeSpaceGB.toFixed(2)} GB`);
      
      if (requiredSizeBytes > 0) {
        this.logger.verbose(`Required space: ${requiredSpaceGB.toFixed(2)} GB`);
        
        if (diskSpace.free < requiredSizeBytes * 1.1) {
          throw new Error(`Insufficient disk space. Required: ${requiredSpaceGB.toFixed(2)} GB, Available: ${freeSpaceGB.toFixed(2)} GB`);
        }
      }
      
      if (freeSpaceGB < 2) {
        throw new Error(`Low disk space warning. Only ${freeSpaceGB.toFixed(2)} GB available`);
      }
      
      return diskSpace;
    } catch (error) {
      if (error.message.includes('Insufficient disk space') || error.message.includes('Low disk space')) {
        throw error;
      }
      this.logger.verbose(`Could not check disk space: ${error.message}`);
      return null;
    }
  }

  async downloadTorrent(torrentId, options = {}) {
    try {
      await this.initializeClient();
    } catch (error) {
      if (error.code === 'EADDRINUSE') {
        this.logger.verbose('Port conflict detected, retrying with different port...');
        this.client = null;
        this.torrentPort = null;
        await this.initializeClient();
      } else {
        throw new Error(`Failed to initialize torrent client: ${error.message}`);
      }
    }
    
    try {
      await this.checkDiskSpace();
    } catch (error) {
      if (error.message.includes('Low disk space')) {
        this.logger.verbose('Low disk space detected, cleaning up old files...');
        await this.cleanupOldFiles(12);
        
        try {
          await this.checkDiskSpace();
          this.logger.verbose('Disk space check passed after cleanup');
        } catch (secondError) {
          throw new Error(`Disk space check failed even after cleanup: ${secondError.message}`);
        }
      } else {
        throw new Error(`Disk space check failed: ${error.message}`);
      }
    }
    
    return new Promise((resolve, reject) => {
      const {
        selectLargestFile = true,
        timeout = 300000,
        onProgress = null,
        keepSeeding = false
      } = options;

      let torrentInstance = null;
      let isResolved = false;

      const timeoutId = setTimeout(() => {
        if (!isResolved && torrentInstance) {
          this.safeRemoveTorrent(torrentInstance.infoHash);
        }
        if (!isResolved) {
          isResolved = true;
          reject(new Error(`Torrent download timeout after ${timeout / 1000} seconds`));
        }
      }, timeout);

      this.client.add(torrentId, { path: this.downloadPath }, (torrent) => {
        if (isResolved) return;
        
        torrentInstance = torrent;
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
          this.safeRemoveTorrent(torrent.infoHash);
          if (!isResolved) {
            isResolved = true;
            return reject(new Error('No files found in torrent'));
          }
          return;
        }

        this.logger.verbose(`Selected file: ${selectedFile.name} (${this.formatBytes(selectedFile.length)})`);

        const filePath = path.join(this.downloadPath, selectedFile.path);

        let lastProgress = 0;
        const progressInterval = setInterval(() => {
          if (isResolved) {
            clearInterval(progressInterval);
            return;
          }
          const progress = Math.round(torrent.progress * 100);
          if (progress !== lastProgress) {
            lastProgress = progress;
            if (onProgress) {
              onProgress(progress, selectedFile.name);
            }
          }
        }, 1000);

        torrent.on('done', async () => {
          if (isResolved) return;
          
          clearTimeout(timeoutId);
          clearInterval(progressInterval);
          
          try {
            await fs.access(filePath);
            this.logger.verbose(`Download completed: ${filePath}`);
            
            if (keepSeeding) {
              this.addToSeedingQueue(torrent, selectedFile);
            }
            
            if (!isResolved) {
              isResolved = true;
              resolve({
                filePath,
                fileName: selectedFile.name,
                fileSize: selectedFile.length,
                torrentHash: torrent.infoHash,
                torrent: torrent
              });
            }
          } catch (error) {
            if (!isResolved) {
              isResolved = true;
              reject(new Error(`Downloaded file not found: ${filePath}`));
            }
          }
        });

        torrent.on('error', (error) => {
          if (isResolved) return;
          
          clearTimeout(timeoutId);
          clearInterval(progressInterval);
          this.safeRemoveTorrent(torrent.infoHash);
          
          if (!isResolved) {
            isResolved = true;
            reject(new Error(`Torrent error: ${error.message}`));
          }
        });
      });

      this.client.on('error', (error) => {
        if (isResolved) return;
        
        clearTimeout(timeoutId);
        if (!isResolved) {
          isResolved = true;
          reject(new Error(`WebTorrent client error: ${error.message}`));
        }
      });
    });
  }

  safeRemoveTorrent(torrentHash) {
    try {
      if (this.client && torrentHash) {
        const torrent = this.client.get(torrentHash);
        if (torrent) {
          this.client.remove(torrentHash);
          this.logger.verbose(`Safely removed torrent: ${torrentHash}`);
        }
      }
    } catch (error) {
      this.logger.verbose(`Error removing torrent ${torrentHash}: ${error.message}`);
    }
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
      
      this.safeRemoveTorrent(oldestSeeding.hash);
      
      this.cleanupFile(oldestSeeding.filePath).catch(error => {
        this.logger.verbose(`Failed to cleanup old seeding file: ${error.message}`);
      });
    }
  }

  async stopSeeding(torrentHash, deleteFile = true) {
    const index = this.seedingTorrents.findIndex(s => s.hash === torrentHash);
    if (index !== -1) {
      const seedingInfo = this.seedingTorrents.splice(index, 1)[0];
      this.safeRemoveTorrent(torrentHash);
      
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

  async cleanupOldFiles(maxAgeHours = 24) {
    try {
      const files = await fs.readdir(this.downloadPath);
      const now = Date.now();
      const maxAge = maxAgeHours * 60 * 60 * 1000;
      
      for (const file of files) {
        const filePath = path.join(this.downloadPath, file);
        const stats = await fs.stat(filePath);
        
        if (stats.isFile() && (now - stats.mtime.getTime()) > maxAge) {
          await fs.unlink(filePath);
          this.logger.verbose(`Cleaned up old file: ${file}`);
        }
      }
    } catch (error) {
      this.logger.verbose(`Failed to cleanup old files: ${error.message}`);
    }
  }

  async forceClientRecreation() {
    this.logger.warning('🔄 Force recreating WebTorrent client due to ENOBUFS...');
    
    // Clear existing client
    if (this.client) {
      try {
        this.client.destroy();
      } catch (error) {
        this.logger.verbose(`Error destroying client: ${error.message}`);
      }
      this.client = null;
    }
    
    // Clear cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    // Wait a bit before recreating
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Recreate client with even more conservative settings
    try {
      await this.initializeClient();
      this.logger.info('✅ WebTorrent client recreated successfully');
    } catch (error) {
      this.logger.error(`Failed to recreate client: ${error.message}`);
    }
  }

  setupPeriodicCleanup() {
    // More frequent cleanup (every 2 minutes) to prevent buildup
    this.cleanupInterval = setInterval(() => {
      if (this.client) {
        try {
          // Force garbage collection on client if available
          if (global.gc) {
            global.gc();
          }
          
          // Clean up completed torrents to free resources
          const completedTorrents = this.client.torrents.filter(torrent => {
            return torrent.progress === 1 && !this.seedingTorrents.some(s => s.hash === torrent.infoHash);
          });
          
          completedTorrents.forEach(torrent => {
            this.logger.verbose(`Removing completed non-seeding torrent: ${torrent.infoHash}`);
            this.safeRemoveTorrent(torrent.infoHash);
          });
          
          // Clean up old/stale torrents that might be consuming resources
          const staleTorrents = this.client.torrents.filter(torrent => {
            const isStale = torrent.progress === 0 && torrent.numPeers === 0 && 
                           (Date.now() - torrent.created) > 180000; // 3 minutes (reduced from 5)
            return isStale;
          });
          
          staleTorrents.forEach(torrent => {
            this.logger.verbose(`Removing stale torrent: ${torrent.infoHash}`);
            this.safeRemoveTorrent(torrent.infoHash);
          });
          
          // Log current connection status
          if (this.client.torrents.length > 0) {
            this.logger.verbose(`Active torrents: ${this.client.torrents.length}`);
          }
          
        } catch (error) {
          this.logger.verbose(`Periodic cleanup error: ${error.message}`);
        }
      }
    }, 120000); // 2 minutes
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  async destroy(cleanupFiles = false) {
    // Clear periodic cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    if (cleanupFiles) {
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
      try {
        this.client.destroy();
        this.logger.verbose('WebTorrent client destroyed successfully');
      } catch (error) {
        this.logger.verbose(`Error destroying WebTorrent client: ${error.message}`);
      } finally {
        this.client = null;
      }
    }
    
    this.seedingTorrents = [];
  }

  static async killExistingProcesses() {
    try {
      const { exec } = require('child_process');
      const util = require('util');
      const execPromise = util.promisify(exec);
      
      const { stdout } = await execPromise('ps aux | grep "anitlan\\|webtorrent" | grep -v grep');
      
      if (stdout.trim()) {
        console.log('Found existing torrent processes, attempting to clean up...');
        
        const processes = stdout.trim().split('\n');
        for (const process of processes) {
          const pid = process.split(/\s+/)[1];
          if (pid && pid !== process.pid) {
            try {
              await execPromise(`kill -9 ${pid}`);
              console.log(`Killed process ${pid}`);
            } catch (error) {
              console.log(`Could not kill process ${pid}: ${error.message}`);
            }
          }
        }
      }
    } catch (error) {
      // Ignore errors in process cleanup
    }
  }
}

module.exports = TorrentService; 