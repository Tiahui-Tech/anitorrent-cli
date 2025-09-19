const path = require('path');
const ora = require('ora');
const anitomy = require('anitomyscript');
const S3Service = require('./s3-service');
const PeerTubeService = require('./peertube-service');
const AniTorrentService = require('./anitorrent-service');
const TorrentService = require('./torrent-service');
const SubtitleService = require('./subtitle-service');
const AniZipService = require('./anizip-service');
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
      subtitleSuffix,
      extractAudio,
      audioTrack,
      audioSuffix,
      audioLatinoTrack,
      ignoredSubtitleTracks = [],
      ignoredAudioTracks = [],
      customName,
      timestamp,
      useTitle,
    } = options;

    let uploadResult = null;
    let r2FileName = null;

    try {
      let uploadFileName = customName;
      if (timestamp) {
        const ext = path.extname(fileInfo.resolvedPath);
        const nameWithoutExt = path.basename(
          customName || fileInfo.resolvedPath,
          ext
        );
        const timestampValue = Date.now();
        uploadFileName = `${nameWithoutExt}_${timestampValue}${ext}`;
      } else if (!uploadFileName) {
        uploadFileName = fileInfo.fileName;
      }

      let fileSize = 'Unknown';
      let videoUrl = fileInfo.resolvedPath;

      if (fileInfo.isUrl) {
        this.logger.info(`Source: Direct URL`);
        this.logger.info(`URL: ${fileInfo.originalPath}`);
        if (fileInfo.localFile) {
          this.logger.info(`Local file for extraction: ${fileInfo.localFile}`);
        }
        this.logger.info(`Upload name: ${uploadFileName}`);
        this.logger.separator();

        this.logger.step('🔗', 'Using direct URL (skipping S3 upload)');
        this.logger.info(`Video URL: ${videoUrl}`, 1);
        
        uploadResult = { 
          publicUrl: videoUrl,
          Key: null
        };
        r2FileName = null;
      } else {
        const fs = require('fs').promises;
        const stats = await fs.stat(fileInfo.resolvedPath);
        fileSize = Validators.formatFileSize(stats.size);

        if (fileInfo.downloadedFromTorrent) {
          this.logger.info(`Source: Torrent download`);
        } else {
          this.logger.info(`File: ${fileInfo.originalPath}`);
          this.logger.info(`Resolved path: ${fileInfo.resolvedPath}`);
        }
        this.logger.info(`Size: ${fileSize}`);
        this.logger.info(`Upload name: ${uploadFileName}`);
        this.logger.separator();

        this.logger.step('📤', 'Uploading to S3');

        const s3Service = new S3Service(this.r2Config);
        const spinner = ora('Uploading to S3...').start();

        uploadResult = await s3Service.uploadFile(
          fileInfo.resolvedPath,
          `videos/${uploadFileName}`,
          true
        );
        r2FileName = uploadResult.Key;

        spinner.succeed('Upload completed');
        this.logger.info(`Public URL: ${uploadResult.publicUrl}`, 1);

        const urlParts = uploadResult.publicUrl.split('/');
        const encodedFileName = encodeURIComponent(urlParts.pop());
        const baseUrl = urlParts.join('/');
        videoUrl = `${baseUrl}/${encodedFileName}`;
      }

      this.logger.step('📥', 'Importing to PeerTube');

      const peertubeService = new PeerTubeService(this.peertubeConfig);

      let videoName = customName;
      if (!videoName) {
        try {
          const fileName = fileInfo.fileName;
          const anitomyResult = await anitomy(fileName);

          if (anitomyResult.anime_title && anitomyResult.episode_number) {
            const animeTitle = anitomyResult.anime_title.replace(/\s+/g, '+');
            const seasonNumber = parseInt(anitomyResult.anime_season) || 1;
            const episodeNumber = parseInt(anitomyResult.episode_number);

            const seasonStr =
              seasonNumber < 10 ? `0${seasonNumber}` : seasonNumber.toString();
            const episodeStr =
              episodeNumber < 10
                ? `0${episodeNumber}`
                : episodeNumber.toString();

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
        silent: true,
      };

      const importSpinner = ora('Importing to PeerTube...').start();
      const importResult = await peertubeService.importVideo(
        videoUrl,
        importOptions
      );
      const videoId = importResult.video?.id;

      if (!videoId) {
        throw new Error('No video ID returned from import');
      }

      importSpinner.succeed('Import initiated');
      this.logger.info(`Import ID: ${importResult.id}`, 1);
      this.logger.info(`Video ID: ${videoId}`, 1);

      this.logger.step('⏳', 'Waiting for PeerTube to import from S3');

      const processingSpinner = ora('Monitoring import status...').start();
      const processingResult = await peertubeService.waitForProcessing(
        videoId,
        maxWaitMinutes
      );

      if (processingResult.success) {
        processingSpinner.succeed(
          `Import completed, final state: ${processingResult.finalState}`
        );
      } else {
        processingSpinner.warn(
          `Import timeout: ${processingResult.finalState}`
        );
      }

      if (animeId && processingResult.video) {
        await this.updateAnimeEpisode(
          fileInfo,
          processingResult.video,
          animeId,
          videoPassword,
          useTitle
        );
      }

      if (processingResult.video) {
        await this.extractAndUploadSubtitles(
          fileInfo,
          processingResult.video,
          subtitleTrack,
          subtitleSuffix,
          ignoredSubtitleTracks
        );

        if (extractAudio) {
          await this.extractAndUploadAudio(fileInfo, processingResult.video, audioTrack, audioSuffix, audioLatinoTrack, ignoredAudioTracks);
        }
      }

      if (!keepR2File && r2FileName) {
        this.logger.step('🗑️', 'Cleaning up S3 file');

        const s3Service = new S3Service(this.r2Config);
        const cleanupSpinner = ora('Deleting S3 file...').start();
        await s3Service.deleteFile(r2FileName, true);
        cleanupSpinner.succeed('S3 file deleted');
      } else if (fileInfo.isUrl) {
        this.logger.step('🔗', 'No S3 cleanup needed (direct URL was used)');
      }

      return {
        fileName: fileInfo.fileName,
        success: true,
        video: processingResult.video,
        finalState: processingResult.finalState,
        videoUrl: videoUrl,
        keepR2File: keepR2File,
      };
    } catch (error) {
      if (r2FileName && !keepR2File) {
        this.logger.info('Attempting cleanup of S3 file...');
        try {
          const s3Service = new S3Service(this.r2Config);
          await s3Service.deleteFile(r2FileName, true);
          this.logger.success('S3 file cleaned up successfully');
        } catch (cleanupError) {
          this.logger.error(
            `Failed to cleanup S3 file: ${cleanupError.message}`
          );
          this.logger.error(`Manual cleanup required for: ${r2FileName}`);
        }
      }
      throw error;
    }
  }

  async updateAnimeEpisode(fileInfo, video, animeId, videoPassword, useTitle) {
    this.logger.step('📺', 'Updating anime episode');

    try {
      const episodeSpinner = ora(
        'Parsing filename and updating episode...'
      ).start();

      const fileName = fileInfo.fileName;
      const anitomyResult = await anitomy(fileName);

      let finalEpisodeNumber = anitomyResult.episode_number || 1;

      const episodeNumber = parseInt(finalEpisodeNumber);
      const anitorrentService = new AniTorrentService();
      const aniZipService = new AniZipService();

      let animeTitle = anitomyResult.anime_title || video.name;

      try {
        const animeData = await anitorrentService.getAnimeById(animeId);
        animeTitle =
          animeData.title?.english || animeData.title?.romaji || animeTitle;
      } catch (error) {
        // Continue with parsed title
      }

      let thumbnailUrl = null;
      
      try {
        const aniZipMappings = await aniZipService.getAnimeMappings(animeId);
        if (aniZipMappings) {
          const aniZipImageUrl = aniZipService.getEpisodeImageUrl(aniZipMappings, episodeNumber);
          if (aniZipImageUrl) {
            thumbnailUrl = aniZipImageUrl;
            this.logger.info(`Using ani.zip episode image: ${thumbnailUrl}`, 1);
          }
        }
      } catch (error) {
        this.logger.verbose(`Failed to get ani.zip image: ${error.message}`);
      }

      if (!thumbnailUrl) {
        thumbnailUrl = video.previewPath
          ? `https://peertube.anitorrent.com${video.previewPath}`
          : null;
        
        if (thumbnailUrl) {
          this.logger.info('Using PeerTube preview image as fallback', 1);
        }
      }

      if (!thumbnailUrl) {
        throw new Error('No thumbnail available for episode');
      }

      if (useTitle) {
        this.logger.info(
          'Using episode title: ' + (anitomyResult.episode_title || 'null')
        );
      }

      const episodeData = {
        peertubeId: video.id.toString(),
        uuid: video.uuid,
        shortUUID: video.shortUUID,
        password: videoPassword || null,
        title: {
          es: useTitle ? anitomyResult.episode_title || null : null,
          en: null,
          ja: null,
        },
        embedUrl: `${this.peertubeConfig.apiUrl.replace(
          '/api/v1',
          ''
        )}/videos/embed/${video.shortUUID}`,
        thumbnailUrl: thumbnailUrl,
        description: video.description || null,
        duration: video.duration || null,
      };

      await anitorrentService.updateCustomEpisode(
        animeId,
        episodeNumber,
        episodeData
      );

      episodeSpinner.succeed(`Episode ${episodeNumber} updated successfully`);
      this.logger.info(`Episode: ${episodeNumber}`, 1);
      this.logger.info(`Anime: ${animeTitle}`, 1);
    } catch (error) {
      this.logger.error(`Failed to update episode: ${error.message}`);
      this.logger.warning('Video upload completed but episode update failed');
    }
  }

  async extractAndUploadSubtitles(fileInfo, video, subtitleTrack, customSuffix = null, ignoredTracks = []) {
    if (customSuffix && subtitleTrack !== null) {
      this.logger.step('🎬', `Extracting subtitle track ${subtitleTrack} with custom suffix`);
    } else {
      this.logger.step('🎬', 'Extracting all subtitles');
    }

    if (ignoredTracks.length > 0) {
      this.logger.info(`Ignoring subtitle tracks: ${ignoredTracks.join(', ')}`, 1);
    }

    try {
      const subtitleService = new SubtitleService();

      const extractSpinner = ora('Analyzing subtitle tracks...').start();

      const sourceFile = fileInfo.isUrl && fileInfo.localFile ? fileInfo.localFile : fileInfo.resolvedPath;
      
      if (fileInfo.isUrl && !fileInfo.localFile) {
        extractSpinner.succeed('Skipping subtitle extraction - no local file specified for URL');
        this.logger.info(
          'To extract subtitles from URLs, specify --local-file option',
          1
        );
        return;
      }

      const allTracks = await subtitleService.listSubtitleTracks(sourceFile);
      const tracks = allTracks.filter(track => !ignoredTracks.includes(track.trackNumber));

      if (allTracks.length === 0) {
        extractSpinner.succeed('No subtitle tracks found');
        this.logger.info(
          'Skipping subtitle extraction - no tracks available',
          1
        );
        return;
      }

      if (tracks.length === 0) {
        extractSpinner.succeed('All subtitle tracks are ignored');
        this.logger.info(
          'Skipping subtitle extraction - all tracks are ignored',
          1
        );
        return;
      }

      const ignoredCount = allTracks.length - tracks.length;
      if (ignoredCount > 0) {
        extractSpinner.succeed(`Found ${allTracks.length} subtitle tracks (${tracks.length} available, ${ignoredCount} ignored)`);
      } else {
        extractSpinner.succeed(`Found ${tracks.length} subtitle tracks`);
      }

      const tempDir = process.cwd();
      const s3Service = new S3Service(this.r2Config);
      const fs = require('fs').promises;
      let successfulUploads = 0;
      let failedExtractions = 0;
      let extractionSpinner;

      if (customSuffix && subtitleTrack !== null) {
        extractionSpinner = ora(
          `Extracting track ${subtitleTrack} with custom suffix...`
        ).start();

        if (ignoredTracks.includes(subtitleTrack)) {
          extractionSpinner.fail(`Track ${subtitleTrack} is ignored`);
          this.logger.warning(`Subtitle track ${subtitleTrack} is in the ignored tracks list`);
          return;
        }

        const targetTrack = allTracks.find(track => track.trackNumber === subtitleTrack);
        
        if (!targetTrack) {
          extractionSpinner.fail(`Track ${subtitleTrack} not found`);
          this.logger.warning(`Subtitle track ${subtitleTrack} not found in video`);
          return;
        }

        try {
          const outputFileName = (customSuffix === 'null' || customSuffix === 'default') 
            ? `${video.shortUUID}.ass`
            : `${video.shortUUID}_${customSuffix}.ass`;

          extractionSpinner.text = `Extracting track ${subtitleTrack} (${targetTrack.language})...`;

          const extractResult = await subtitleService.extractSubtitles(
            sourceFile,
            outputFileName,
            subtitleTrack,
            tempDir
          );

          if (extractResult.success) {
            try {
              extractionSpinner.text = `Uploading ${outputFileName}...`;

              const subtitleUploadResult = await s3Service.uploadFile(
                extractResult.outputPath,
                `subtitles/${outputFileName}`,
                true
              );

              successfulUploads++;
              extractionSpinner.succeed(`Subtitle track ${subtitleTrack} extracted and uploaded successfully`);

              try {
                await fs.unlink(extractResult.outputPath);
              } catch (cleanupError) {
                // Ignore cleanup errors
              }
            } catch (uploadError) {
              extractionSpinner.fail(`Failed to upload ${outputFileName}: ${uploadError.message}`);
              failedExtractions++;
            }
          } else {
            extractionSpinner.fail(`Failed to extract track ${subtitleTrack}: ${extractResult.error}`);
            failedExtractions++;
          }
        } catch (trackError) {
          extractionSpinner.fail(`Error processing track ${subtitleTrack}: ${trackError.message}`);
          failedExtractions++;
        }
      } else {
        extractionSpinner = ora(
          'Extracting all subtitle tracks...'
        ).start();

        for (let i = 0; i < tracks.length; i++) {
          const track = tracks[i];

          try {
            const suffix = subtitleService.getLanguageSuffix(track, tracks);
            const outputFileName = suffix
              ? `${video.shortUUID}_${suffix}.ass`
              : `${video.shortUUID}.ass`;

            extractionSpinner.text = `Extracting track ${i} (${track.language})...`;

            const extractResult = await subtitleService.extractSubtitles(
              sourceFile,
              outputFileName,
              track.trackNumber,
              tempDir
            );

            if (extractResult.success) {
              try {
                extractionSpinner.text = `Uploading ${outputFileName}...`;

                const subtitleUploadResult = await s3Service.uploadFile(
                  extractResult.outputPath,
                  `subtitles/${outputFileName}`,
                  true
                );

                successfulUploads++;

                try {
                  await fs.unlink(extractResult.outputPath);
                } catch (cleanupError) {
                  // Ignore cleanup errors
                }
              } catch (uploadError) {
                this.logger.warning(
                  `Failed to upload ${outputFileName}: ${uploadError.message}`
                );
                failedExtractions++;
              }
            } else {
              this.logger.warning(
                `Failed to extract track ${i} (${track.language}): ${extractResult.error}`
              );
              failedExtractions++;
            }
          } catch (trackError) {
            this.logger.warning(
              `Error processing track ${i}: ${trackError.message}`
            );
            failedExtractions++;
          }
        }
      }

      if (successfulUploads > 0) {
        extractionSpinner.succeed(
          `Subtitle processing completed: ${successfulUploads} uploaded, ${failedExtractions} failed`
        );
        this.logger.info(
          `Successfully uploaded ${successfulUploads} subtitle files`,
          1
        );
        if (failedExtractions > 0) {
          this.logger.info(`${failedExtractions} extractions failed`, 1);
        }
      } else {
        extractionSpinner.fail('All subtitle extractions failed');
      }

      // Cleanup empty subtitles directory
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
    } catch (error) {
      this.logger.warning(`Subtitle extraction failed: ${error.message}`);
      this.logger.info('Continuing with video processing...', 1);
    }
  }

  async extractAndUploadAudio(fileInfo, video, audioTrack = null, customSuffix = null, audioLatinoTrack = null, ignoredTracks = []) {
    if (customSuffix && audioTrack !== null) {
      this.logger.step('🎵', `Extracting audio track ${audioTrack} with custom suffix`);
    } else {
      this.logger.step('🎵', 'Extracting all audio tracks');
    }

    if (ignoredTracks.length > 0) {
      this.logger.info(`Ignoring audio tracks: ${ignoredTracks.join(', ')}`, 1);
    }

    try {
      const AudioService = require('./audio-service');
      const audioService = new AudioService();

      const extractSpinner = ora('Analyzing audio tracks...').start();

      const sourceFile = fileInfo.isUrl && fileInfo.localFile ? fileInfo.localFile : fileInfo.resolvedPath;
      
      if (fileInfo.isUrl && !fileInfo.localFile) {
        extractSpinner.succeed('Skipping audio extraction - no local file specified for URL');
        this.logger.info(
          'To extract audio from URLs, specify --local-file option',
          1
        );
        return;
      }

      const allTracks = await audioService.listAudioTracks(sourceFile);
      const tracks = allTracks.filter(track => !ignoredTracks.includes(track.trackNumber));

      if (allTracks.length === 0) {
        extractSpinner.succeed('No audio tracks found');
        this.logger.info('Skipping audio extraction - no tracks available', 1);
        return;
      }

      if (tracks.length === 0) {
        extractSpinner.succeed('All audio tracks are ignored');
        this.logger.info('Skipping audio extraction - all tracks are ignored', 1);
        return;
      }

      const ignoredCount = allTracks.length - tracks.length;
      if (ignoredCount > 0) {
        extractSpinner.succeed(`Found ${allTracks.length} audio tracks (${tracks.length} available, ${ignoredCount} ignored)`);
      } else {
        extractSpinner.succeed(`Found ${tracks.length} audio tracks`);
      }

      const tempDir = process.cwd();
      const s3Service = new S3Service(this.r2Config);
      const fs = require('fs').promises;

      let successfulUploads = 0;
      let failedExtractions = 0;
      let extractionSpinner;

      if (customSuffix && audioTrack !== null) {
        extractionSpinner = ora(
          `Extracting track ${audioTrack} with custom suffix...`
        ).start();

        if (ignoredTracks.includes(audioTrack)) {
          extractionSpinner.fail(`Track ${audioTrack} is ignored`);
          this.logger.warning(`Audio track ${audioTrack} is in the ignored tracks list`);
          return;
        }

        const targetTrack = allTracks.find(track => track.trackNumber === audioTrack);
        
        if (!targetTrack) {
          extractionSpinner.fail(`Track ${audioTrack} not found`);
          this.logger.warning(`Audio track ${audioTrack} not found in video`);
          return;
        }

        try {
          const outputFileName = (customSuffix === 'null' || customSuffix === 'default') 
            ? `${video.shortUUID}.mp3`
            : `${video.shortUUID}_${customSuffix}.mp3`;

          extractionSpinner.text = `Extracting track ${audioTrack} (${targetTrack.language})...`;

          const extractResult = await audioService.extractAudio(
            sourceFile,
            outputFileName,
            audioTrack,
            tempDir,
            'mp3',
            '192k'
          );

          if (extractResult.success) {
            try {
              extractionSpinner.text = `Uploading ${outputFileName}...`;

              const audioUploadResult = await s3Service.uploadFile(
                extractResult.outputPath,
                `audios/${outputFileName}`,
                true
              );

              successfulUploads++;
              extractionSpinner.succeed(`Audio track ${audioTrack} extracted and uploaded successfully`);

              try {
                await fs.unlink(extractResult.outputPath);
              } catch (cleanupError) {
                // Ignore cleanup errors
              }
            } catch (uploadError) {
              extractionSpinner.fail(`Failed to upload ${outputFileName}: ${uploadError.message}`);
              failedExtractions++;
            }
          } else {
            extractionSpinner.fail(`Failed to extract track ${audioTrack}: ${extractResult.error}`);
            failedExtractions++;
          }
        } catch (trackError) {
          extractionSpinner.fail(`Error processing track ${audioTrack}: ${trackError.message}`);
          failedExtractions++;
        }
      } else {
        extractionSpinner = ora('Extracting all audio tracks...').start();

        for (let i = 0; i < tracks.length; i++) {
          const track = tracks[i];

          try {
            // Generate filename with language suffix using the AudioService logic
            const suffix = audioService.getLanguageSuffix(track, allTracks, audioLatinoTrack);
            const outputFileName = suffix
              ? `${video.shortUUID}_${suffix}.mp3`
              : `${video.shortUUID}.mp3`;

            extractionSpinner.text = `Extracting track ${i} (${track.language})...`;

            const extractResult = await audioService.extractAudio(
              sourceFile,
              outputFileName,
              track.trackNumber,
              tempDir,
              'mp3',
              '192k'
            );

            if (extractResult.success) {
              try {
                extractionSpinner.text = `Uploading ${outputFileName}...`;

                const audioUploadResult = await s3Service.uploadFile(
                  extractResult.outputPath,
                  `audios/${outputFileName}`,
                  true
                );

                successfulUploads++;

                // Cleanup temp file
                try {
                  await fs.unlink(extractResult.outputPath);
                } catch (cleanupError) {
                  // Ignore cleanup errors
                }
              } catch (uploadError) {
                this.logger.warning(
                  `Failed to upload ${outputFileName}: ${uploadError.message}`
                );
                failedExtractions++;
              }
            } else {
              this.logger.warning(
                `Failed to extract track ${i} (${track.language}): ${extractResult.error}`
              );
              failedExtractions++;
            }
          } catch (trackError) {
            this.logger.warning(
              `Error processing track ${i}: ${trackError.message}`
            );
            failedExtractions++;
          }
        }
      }

      if (successfulUploads > 0) {
        extractionSpinner.succeed(
          `Audio processing completed: ${successfulUploads} uploaded, ${failedExtractions} failed`
        );
        this.logger.info(
          `Successfully uploaded ${successfulUploads} audio files`,
          1
        );
        if (failedExtractions > 0) {
          this.logger.info(`${failedExtractions} extractions failed`, 1);
        }
      } else {
        extractionSpinner.fail('All audio extractions failed');
      }

      // Cleanup empty audio directory
      try {
        const audioDir = path.join(tempDir, 'audio');
        const dirContents = await fs.readdir(audioDir);
        if (dirContents.length === 0) {
          await fs.rmdir(audioDir);
          this.logger.info('Empty audio directory cleaned up', 1);
        }
      } catch (dirCleanupError) {
        // Ignore directory cleanup errors
      }
    } catch (error) {
      this.logger.warning(`Audio extraction failed: ${error.message}`);
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
        },
      });

      downloadSpinner.succeed(`Download completed: ${downloadResult.fileName}`);

      const fileInfo = {
        originalPath: torrentUrl,
        resolvedPath: downloadResult.filePath,
        fileName: downloadResult.fileName,
        downloadedFromTorrent: true,
        torrentHash: downloadResult.torrentHash,
        fileSize: downloadResult.fileSize,
      };

      logger.info(`Downloaded file: ${downloadResult.fileName}`, 1);
      logger.info(
        `File size: ${torrentService.formatBytes(downloadResult.fileSize)}`,
        1
      );
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

        const torrentCleanupSpinner = ora(
          'Deleting downloaded torrent file...'
        ).start();
        await torrentService.cleanupFile(fileInfo.resolvedPath);
        torrentService.destroy();
        torrentCleanupSpinner.succeed(
          'Torrent file deleted and seeding stopped'
        );
      } else {
        this.logger.step('🌱', 'Keeping file for seeding');

        const seedingSpinner = ora('Maintaining file for seeding...').start();
        seedingSpinner.succeed(
          'File kept for seeding (torrent remains active)'
        );
        this.logger.info(`Seeding: ${fileInfo.fileName}`, 1);
        this.logger.info(`Location: ${fileInfo.resolvedPath}`, 1);
      }
    }
  }
}

module.exports = UploadService;
