const path = require('path');
const ora = require('ora');
const anitomy = require('anitomyscript');
const S3Service = require('./s3-service');
const PeerTubeService = require('./peertube-service');
const AniTorrentService = require('./anitorrent-service');
const TorrentService = require('./torrent-service');
const SubtitleService = require('./subtitle-service');
const Validators = require('../utils/validators');

class UploadService {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.r2Config = config.getR2Config();
    this.peertubeConfig = config.getPeerTubeConfig();
    this.defaults = config.getDefaults();
  }

  async processFileUpload(fileInfo, options = {}) {
    const {
      channelId,
      privacy,
      videoPassword,
      maxWaitMinutes,
      keepR2File,
      animeId,
      subtitleTrack,
      customName,
      timestamp,
      useTitle
    } = options;

    let uploadResult = null;
    let r2FileName = null;

    try {
      let uploadFileName = customName;
      if (timestamp) {
        const ext = path.extname(fileInfo.resolvedPath);
        const nameWithoutExt = path.basename(customName || fileInfo.resolvedPath, ext);
        const timestampValue = Date.now();
        uploadFileName = `${nameWithoutExt}_${timestampValue}${ext}`;
      } else if (!uploadFileName) {
        uploadFileName = fileInfo.fileName;
      }

      const fs = require('fs').promises;
      const stats = await fs.stat(fileInfo.resolvedPath);
      const fileSize = Validators.formatFileSize(stats.size);

      if (fileInfo.downloadedFromTorrent) {
        this.logger.info(`Source: Torrent download`);
      } else {
        this.logger.info(`File: ${fileInfo.originalPath}`);
        this.logger.info(`Resolved path: ${fileInfo.resolvedPath}`);
      }
      this.logger.info(`Size: ${fileSize}`);
      this.logger.info(`Upload name: ${uploadFileName}`);
      this.logger.separator();

      this.logger.step('📤', 'Uploading to Cloudflare R2');
      
      const s3Service = new S3Service(this.r2Config);
      const spinner = ora('Uploading to R2...').start();
      
      uploadResult = await s3Service.uploadFile(fileInfo.resolvedPath, `videos/${uploadFileName}`, true);
      r2FileName = uploadResult.Key;
      
      spinner.succeed('Upload completed');
      this.logger.info(`Public URL: ${uploadResult.publicUrl}`, 1);

      this.logger.step('📥', 'Importing to PeerTube');
      
      const peertubeService = new PeerTubeService(this.peertubeConfig);
      
      const urlParts = uploadResult.publicUrl.split('/');
      const encodedFileName = encodeURIComponent(urlParts.pop());
      const baseUrl = urlParts.join('/');
      const videoUrl = `${baseUrl}/${encodedFileName}`;
      
      let videoName = customName;
      if (!videoName) {
        try {
          const fileName = fileInfo.fileName;
          const anitomyResult = await anitomy(fileName);
          
          if (anitomyResult.anime_title && anitomyResult.episode_number) {
            const animeTitle = anitomyResult.anime_title.replace(/\s+/g, '+');
            const seasonNumber = parseInt(anitomyResult.anime_season) || 1;
            const episodeNumber = parseInt(anitomyResult.episode_number);
            
            const seasonStr = seasonNumber < 10 ? `0${seasonNumber}` : seasonNumber.toString();
            const episodeStr = episodeNumber < 10 ? `0${episodeNumber}` : episodeNumber.toString();
            
            videoName = `${animeTitle}_S${seasonStr}E${episodeStr}`;
          } else {
            videoName = path.parse(fileInfo.resolvedPath).name;
          }
        } catch (error) {
          videoName = path.parse(fileInfo.resolvedPath).name;
        }
      }
      
      const importOptions = {
        channelId,
        name: videoName,
        privacy,
        videoPasswords: [videoPassword],
        silent: true
      };

      const importSpinner = ora('Importing to PeerTube...').start();
      const importResult = await peertubeService.importVideo(videoUrl, importOptions);
      const videoId = importResult.video?.id;

      if (!videoId) {
        throw new Error('No video ID returned from import');
      }

      importSpinner.succeed('Import initiated');
      this.logger.info(`Import ID: ${importResult.id}`, 1);
      this.logger.info(`Video ID: ${videoId}`, 1);

      this.logger.step('⏳', 'Waiting for PeerTube to import from R2');
      
      const processingSpinner = ora('Monitoring import status...').start();
      const processingResult = await peertubeService.waitForProcessing(videoId, maxWaitMinutes);
      
      if (processingResult.success) {
        processingSpinner.succeed(`Import completed, final state: ${processingResult.finalState}`);
      } else {
        processingSpinner.warn(`Import timeout: ${processingResult.finalState}`);
      }

      if (animeId && processingResult.video) {
        await this.updateAnimeEpisode(fileInfo, processingResult.video, animeId, videoPassword, useTitle);
      }

      if (processingResult.video) {
        await this.extractAndUploadSubtitles(fileInfo, processingResult.video, subtitleTrack);
      }

      if (!keepR2File) {
        this.logger.step('🗑️', 'Cleaning up R2 file');
        
        const cleanupSpinner = ora('Deleting R2 file...').start();
        await s3Service.deleteFile(r2FileName, true);
        cleanupSpinner.succeed('R2 file deleted');
      }

      return {
        fileName: fileInfo.fileName,
        success: true,
        video: processingResult.video,
        finalState: processingResult.finalState,
        videoUrl: videoUrl,
        keepR2File: keepR2File
      };

    } catch (error) {
      if (r2FileName && !keepR2File) {
        this.logger.info('Attempting cleanup of R2 file...');
        try {
          const s3Service = new S3Service(this.r2Config);
          await s3Service.deleteFile(r2FileName, true);
          this.logger.success('R2 file cleaned up successfully');
        } catch (cleanupError) {
          this.logger.error(`Failed to cleanup R2 file: ${cleanupError.message}`);
          this.logger.error(`Manual cleanup required for: ${r2FileName}`);
        }
      }
      throw error;
    }
  }

  async updateAnimeEpisode(fileInfo, video, animeId, videoPassword, useTitle) {
    this.logger.step('📺', 'Updating anime episode');
    
    try {
      const episodeSpinner = ora('Parsing filename and updating episode...').start();
      
      const fileName = fileInfo.fileName;
      const anitomyResult = await anitomy(fileName);
      
      if (!anitomyResult.episode_number) {
        episodeSpinner.warn('Could not extract episode number from filename');
        this.logger.warning('Skipping episode update - no episode number found');
        return;
      }

      const episodeNumber = parseInt(anitomyResult.episode_number);
      const anitorrentService = new AniTorrentService();
      
      let animeTitle = anitomyResult.anime_title || video.name;
      
      try {
        const animeData = await anitorrentService.getAnimeById(animeId);
        animeTitle = animeData.title?.english || animeData.title?.romaji || animeTitle;
      } catch (error) {
        // Continue with parsed title
      }
      
      const thumbnailUrl = video.thumbnailPath 
        ? `https://peertube.anitorrent.com${video.thumbnailPath}`
        : null;
      
      if (!thumbnailUrl) {
        throw new Error('No thumbnail available for episode');
      }

      if (useTitle) {
        this.logger.info('Using episode title: ' + (anitomyResult.episode_title || 'null'));
      }
      
      const episodeData = {
        peertubeId: video.id.toString(),
        uuid: video.uuid,
        shortUUID: video.shortUUID,
        password: videoPassword || null,
        title: {
          es: useTitle ? anitomyResult.episode_title || null : null,
          en: null,
          ja: null
        },
        embedUrl: `${this.peertubeConfig.apiUrl.replace('/api/v1', '')}/videos/embed/${video.shortUUID}`,
        thumbnailUrl: thumbnailUrl,
        description: video.description || null,
        duration: video.duration || null
      };
      
      await anitorrentService.updateCustomEpisode(animeId, episodeNumber, episodeData);
      
      episodeSpinner.succeed(`Episode ${episodeNumber} updated successfully`);
      this.logger.info(`Episode: ${episodeNumber}`, 1);
      this.logger.info(`Anime: ${animeTitle}`, 1);
      
    } catch (error) {
      this.logger.error(`Failed to update episode: ${error.message}`);
      this.logger.warning('Video upload completed but episode update failed');
    }
  }

  async extractAndUploadSubtitles(fileInfo, video, subtitleTrack) {
    this.logger.step('🎬', 'Extracting Latino subtitles');
    
    try {
      const subtitleService = new SubtitleService();
      
      const extractSpinner = ora('Analyzing subtitle tracks...').start();
      
      const tracks = await subtitleService.listSubtitleTracks(fileInfo.resolvedPath);
      
      let targetTrack = subtitleTrack;
      if (targetTrack === null) {
        targetTrack = subtitleService.findDefaultSpanishTrack(tracks);
      }
      
      if (targetTrack === -1) {
        extractSpinner.succeed('No Latino subtitle track found');
        this.logger.info('Skipping subtitle extraction - no Latino track available', 1);
        return;
      } else if (targetTrack >= tracks.length) {
        extractSpinner.succeed(`Track ${targetTrack} not found`);
        this.logger.info(`Skipping subtitle extraction - track ${targetTrack} does not exist (available: 0-${tracks.length - 1})`, 1);
        return;
      }

      const track = tracks[targetTrack];
      if (subtitleTrack !== null) {
        extractSpinner.succeed(`Using specified subtitle track ${targetTrack}: ${track.language} ${track.languageDetail || ''}`);
      } else {
        extractSpinner.succeed(`Found Latino subtitle track ${targetTrack}: ${track.language} ${track.languageDetail || ''}`);
      }
      
      const extractionSpinner = ora('Extracting subtitles...').start();
      
      const outputFileName = `${video.shortUUID}.ass`;
      const tempDir = process.cwd();
      
      const extractResult = await subtitleService.extractSubtitles(
        fileInfo.resolvedPath, 
        outputFileName, 
        targetTrack, 
        tempDir
      );
      
      if (extractResult.success) {
        extractionSpinner.succeed('Subtitle extraction completed');
        this.logger.info(`Extracted: ${outputFileName}`, 1);
        
        const uploadSpinner = ora('Uploading subtitles to R2...').start();
        
        try {
          const s3Service = new S3Service(this.r2Config);
          const subtitleUploadResult = await s3Service.uploadFile(
            extractResult.outputPath, 
            `subtitles/${outputFileName}`, 
            true
          );
          
          uploadSpinner.succeed('Subtitle upload completed');
          this.logger.info(`Subtitle URL: ${subtitleUploadResult.publicUrl}`, 1);
          
          const fs = require('fs').promises;
          try {
            await fs.unlink(extractResult.outputPath);
            this.logger.info('Temporary subtitle file cleaned up', 1);
          } catch (cleanupError) {
            this.logger.warning(`Failed to cleanup temp subtitle file: ${cleanupError.message}`);
          }
          
          try {
            const subtitlesDir = path.join(tempDir, 'subtitles');
            const dirContents = await fs.readdir(subtitlesDir);
            if (dirContents.length === 0) {
              await fs.rmdir(subtitlesDir);
              this.logger.info('Empty subtitles directory cleaned up', 1);
            }
          } catch (dirCleanupError) {
            // Ignore directory cleanup errors
          }
          
        } catch (uploadError) {
          uploadSpinner.fail('Subtitle upload failed');
          this.logger.warning(`Failed to upload subtitles: ${uploadError.message}`);
        }
      } else {
        extractionSpinner.fail('Subtitle extraction failed');
        this.logger.warning(`Failed to extract subtitles: ${extractResult.error}`);
      }
      
    } catch (error) {
      this.logger.warning(`Subtitle extraction failed: ${error.message}`);
      this.logger.info('Continuing with video processing...', 1);
    }
  }

  async downloadFromTorrent(torrentUrl, logger, options = {}) {
    const torrentService = new TorrentService({ logger });
    await torrentService.ensureDownloadDirectory();

    logger.step('📥', 'Downloading from torrent');
    
    const downloadSpinner = ora('Connecting to torrent...').start();
    
    try {
      const downloadResult = await torrentService.downloadTorrent(torrentUrl, {
        selectLargestFile: true,
        timeout: 600000,
        keepSeeding: options.keepSeeding || false,
        onProgress: (progress, fileName) => {
          downloadSpinner.text = `Downloading ${fileName}: ${progress}%`;
        }
      });

      downloadSpinner.succeed(`Download completed: ${downloadResult.fileName}`);
      
      const fileInfo = {
        originalPath: torrentUrl,
        resolvedPath: downloadResult.filePath,
        fileName: downloadResult.fileName,
        downloadedFromTorrent: true,
        torrentHash: downloadResult.torrentHash,
        fileSize: downloadResult.fileSize
      };
      
      logger.info(`Downloaded file: ${downloadResult.fileName}`, 1);
      logger.info(`File size: ${torrentService.formatBytes(downloadResult.fileSize)}`, 1);
      logger.info(`Torrent hash: ${downloadResult.torrentHash}`, 1);
      
      if (options.keepSeeding) {
        logger.info('Keeping torrent active for seeding', 1);
      }
      
      return { fileInfo, torrentService };
      
    } catch (error) {
      downloadSpinner.fail(`Torrent download failed: ${error.message}`);
      throw error;
    }
  }

  async cleanupTorrentFile(fileInfo, torrentService, stopSeeding = true) {
    if (fileInfo.downloadedFromTorrent && torrentService) {
      if (stopSeeding) {
        this.logger.step('🗑️', 'Cleaning up torrent file');
        
        const torrentCleanupSpinner = ora('Deleting downloaded torrent file...').start();
        await torrentService.cleanupFile(fileInfo.resolvedPath);
        torrentService.destroy();
        torrentCleanupSpinner.succeed('Torrent file deleted and seeding stopped');
      } else {
        this.logger.step('🌱', 'Keeping file for seeding');
        
        const seedingSpinner = ora('Maintaining file for seeding...').start();
        seedingSpinner.succeed('File kept for seeding (torrent remains active)');
        this.logger.info(`Seeding: ${fileInfo.fileName}`, 1);
        this.logger.info(`Location: ${fileInfo.resolvedPath}`, 1);
      }
    }
  }
}

module.exports = UploadService; 