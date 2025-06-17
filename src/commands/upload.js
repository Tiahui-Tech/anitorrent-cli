const { Command } = require('commander');
const ora = require('ora');
const path = require('path');
const ConfigManager = require('../utils/config');
const { Logger } = require('../utils/logger');
const Validators = require('../utils/validators');
const S3Service = require('../services/s3-service');
const PeerTubeService = require('../services/peertube-service');
const AniTorrentService = require('../services/anitorrent-service');
const TorrentService = require('../services/torrent-service');
const anitomy = require('anitomyscript');

const uploadCommand = new Command('upload');
uploadCommand.description('File upload operations');

uploadCommand
  .command('r2')
  .description('Upload file to Cloudflare R2')
  .argument('<file>', 'file to upload (supports absolute and relative paths)')
  .option('--name <name>', 'custom name for uploaded file')
  .option('--timestamp', 'add timestamp to filename')
  .action(async (file, options) => {
    const logger = new Logger({ 
      verbose: uploadCommand.parent?.opts()?.verbose || false,
      quiet: uploadCommand.parent?.opts()?.quiet || false
    });



    try {
      const fileValidation = await Validators.validateFilePath(file);
      
      if (!fileValidation.exists) {
        logger.error(`File not found: "${fileValidation.originalPath}"`);
        if (fileValidation.originalPath !== fileValidation.resolvedPath) {
          logger.error(`Resolved path: "${fileValidation.resolvedPath}"`);
        }
        process.exit(1);
      }

      const resolvedFile = fileValidation.resolvedPath;
      logger.verbose(`Using file: ${resolvedFile}`);

      const config = new ConfigManager();
      config.validateRequired();
      const r2Config = config.getR2Config();

      const s3Service = new S3Service(r2Config);
      
      let uploadFileName = options.name;
      if (options.timestamp) {
        const ext = path.extname(resolvedFile);
        const nameWithoutExt = path.basename(options.name || resolvedFile, ext);
        const timestamp = Date.now();
        uploadFileName = `${nameWithoutExt}_${timestamp}${ext}`;
      } else if (!uploadFileName) {
        uploadFileName = path.basename(resolvedFile);
      }

      const fs = require('fs').promises;
      const stats = await fs.stat(resolvedFile);
      const fileSize = Validators.formatFileSize(stats.size);

      logger.header('Upload to Cloudflare R2');
      logger.info(`File: ${fileValidation.originalPath}`);
      logger.info(`Resolved path: ${resolvedFile}`);
      logger.info(`Size: ${fileSize}`);
      logger.info(`Upload name: ${uploadFileName}`);
      logger.separator();

      const spinner = ora('Uploading to R2...').start();
      
      try {
        const result = await s3Service.uploadFile(resolvedFile, `videos/${uploadFileName}`, true);
        spinner.succeed('Upload completed successfully');

        logger.success('Upload Details:');
        logger.info(`Public URL: ${result.publicUrl}`, 1);
        logger.info(`ETag: ${result.ETag}`, 1);
        logger.info(`Location: ${result.Location}`, 1);

      } catch (error) {
        spinner.fail(`Upload failed: ${error.message}`);
        process.exit(1);
      }

    } catch (error) {
      logger.error(`Upload failed: ${error.message}`);
      process.exit(1);
    }
  });

uploadCommand
  .command('auto')
  .description('Upload to R2 and automatically import to PeerTube')
  .argument('[file]', 'file to upload (supports absolute and relative paths) or torrent URL/magnet when using --torrent. If not specified, uploads all video files from current directory')
  .option('--torrent', 'download file from torrent URL or magnet link')
  .option('--name <name>', 'custom name for the video (ignored when processing multiple files)')
  .option('--timestamp', 'add timestamp to filename')
  .option('--channel <id>', 'PeerTube channel ID')
  .option('--privacy <level>', 'privacy level (1-5)')
  .option('--password <password>', 'video password')
  .option('--wait <minutes>', 'max wait time for processing', '120')
  .option('--keep-r2', 'keep file in R2 after import')
  .option('--anime-id <id>', 'AniList anime ID for episode update')
  .action(async (file, options) => {
    const logger = new Logger({ 
      verbose: uploadCommand.parent?.opts()?.verbose || false,
      quiet: uploadCommand.parent?.opts()?.quiet || false
    });

    if (options.torrent && !file) {
      logger.error('You must specify a torrent URL/magnet when using --torrent option');
      process.exit(1);
    }

    let filesToProcess = [];
    let torrentService = null;

    try {
      if (!file) {
        const currentDir = process.cwd();
        
        logger.header('Scanning Current Directory for Video Files');
        logger.info(`Directory: ${currentDir}`);
        logger.separator();

        const fs = require('fs').promises;
        const files = await fs.readdir(currentDir);
        const videoFiles = files.filter(fileName => {
          const fullPath = path.join(currentDir, fileName);
          return Validators.isValidVideoFile(fullPath);
        });

        if (videoFiles.length === 0) {
          logger.error('No video files found in the current directory');
          process.exit(1);
        }

        filesToProcess = videoFiles.map(fileName => ({
          originalPath: fileName,
          resolvedPath: path.join(currentDir, fileName),
          fileName: fileName,
          downloadedFromTorrent: false
        }));

        logger.success(`Found ${filesToProcess.length} video file(s):`);
        filesToProcess.forEach((fileInfo, index) => {
          logger.info(`${index + 1}. ${fileInfo.fileName}`, 1);
        });
        logger.separator();

      } else if (options.torrent) {
        logger.header('Torrent Download Process');
        logger.info(`Torrent URL/Magnet: ${file}`);
        logger.separator();

        torrentService = new TorrentService({ logger });
        await torrentService.ensureDownloadDirectory();

        logger.step('📥', 'Downloading from torrent');
        
        const downloadSpinner = ora('Connecting to torrent...').start();
        
        try {
          const downloadResult = await torrentService.downloadTorrent(file, {
            selectLargestFile: true,
            timeout: 600000,
            onProgress: (progress, fileName) => {
              downloadSpinner.text = `Downloading ${fileName}: ${progress}%`;
            }
          });

          downloadSpinner.succeed(`Download completed: ${downloadResult.fileName}`);
          
          filesToProcess = [{
            originalPath: file,
            resolvedPath: downloadResult.filePath,
            fileName: downloadResult.fileName,
            downloadedFromTorrent: true,
            torrentHash: downloadResult.torrentHash,
            fileSize: downloadResult.fileSize
          }];
          
          logger.info(`Downloaded file: ${downloadResult.fileName}`, 1);
          logger.info(`File size: ${torrentService.formatBytes(downloadResult.fileSize)}`, 1);
          logger.info(`Torrent hash: ${downloadResult.torrentHash}`, 1);
          
        } catch (error) {
          downloadSpinner.fail(`Torrent download failed: ${error.message}`);
          process.exit(1);
        }
      } else {
        const fileValidation = await Validators.validateFilePath(file);
        
        if (!fileValidation.exists) {
          logger.error(`File not found: "${fileValidation.originalPath}"`);
          if (fileValidation.originalPath !== fileValidation.resolvedPath) {
            logger.error(`Resolved path: "${fileValidation.resolvedPath}"`);
          }
          process.exit(1);
        }

        if (!Validators.isValidVideoFile(fileValidation.resolvedPath)) {
          logger.warning('File does not appear to be a video file');
        }

        filesToProcess = [{
          originalPath: fileValidation.originalPath,
          resolvedPath: fileValidation.resolvedPath,
          fileName: path.basename(fileValidation.resolvedPath),
          downloadedFromTorrent: false
        }];

        logger.verbose(`Using file: ${fileValidation.resolvedPath}`);
      }

      const config = new ConfigManager();
      config.validateRequired();
      
      const r2Config = config.getR2Config();
      const peertubeConfig = config.getPeerTubeConfig();
      const defaults = config.getDefaults();

      const channelId = options.channel ? parseInt(options.channel) : await config.getDefaultChannelId();
      const privacy = options.privacy ? parseInt(options.privacy) : defaults.privacy;
      const videoPassword = options.password || defaults.videoPassword;
      const maxWaitMinutes = parseInt(options.wait);
      const keepR2File = options.keepR2;
      const animeId = options.animeId;

      if (!Validators.isValidChannelId(channelId)) {
        logger.error('Invalid channel ID');
        process.exit(1);
      }

      if (!Validators.isValidPrivacyLevel(privacy)) {
        logger.error('Invalid privacy level (must be 1-5)');
        process.exit(1);
      }

      logger.header(`Auto Upload & Import Process - ${filesToProcess.length} file(s)`);
      logger.info(`Channel ID: ${channelId}`);
      logger.info(`Privacy: ${privacy}`);
      logger.info(`Keep R2 file: ${keepR2File ? 'Yes' : 'No'}`);
      logger.info(`Max wait time: ${maxWaitMinutes} minutes`);
      if (animeId) {
        logger.info(`Anime ID: ${animeId}`);
      }
      logger.separator();

      const results = [];
      const errors = [];

      for (let i = 0; i < filesToProcess.length; i++) {
        const fileInfo = filesToProcess[i];
        const currentFile = i + 1;
        const totalFiles = filesToProcess.length;

        logger.header(`Processing File ${currentFile}/${totalFiles}: ${fileInfo.fileName}`);
        
        try {
          let uploadFileName = options.name;
          if (options.timestamp) {
            const ext = path.extname(fileInfo.resolvedPath);
            const nameWithoutExt = path.basename(options.name || fileInfo.resolvedPath, ext);
            const timestamp = Date.now();
            uploadFileName = `${nameWithoutExt}_${timestamp}${ext}`;
          } else if (!uploadFileName || filesToProcess.length > 1) {
            uploadFileName = fileInfo.fileName;
          }

          const fs = require('fs').promises;
          const stats = await fs.stat(fileInfo.resolvedPath);
          const fileSize = Validators.formatFileSize(stats.size);

          if (fileInfo.downloadedFromTorrent) {
            logger.info(`Source: Torrent download`);
          } else {
            logger.info(`File: ${fileInfo.originalPath}`);
            logger.info(`Resolved path: ${fileInfo.resolvedPath}`);
          }
          logger.info(`Size: ${fileSize}`);
          logger.info(`Upload name: ${uploadFileName}`);
          logger.separator();

          let uploadResult = null;
          let r2FileName = null;

          try {
            logger.step('📤', 'Uploading to Cloudflare R2');
            
            const s3Service = new S3Service(r2Config);
            const spinner = ora('Uploading to R2...').start();
            
            uploadResult = await s3Service.uploadFile(fileInfo.resolvedPath, `videos/${uploadFileName}`, true);
            r2FileName = uploadResult.Key;
            
            spinner.succeed('Upload completed');
            logger.info(`Public URL: ${uploadResult.publicUrl}`, 1);

            logger.step('📥', 'Importing to PeerTube');
            
            const peertubeService = new PeerTubeService(peertubeConfig);
            
            const urlParts = uploadResult.publicUrl.split('/');
            const encodedFileName = encodeURIComponent(urlParts.pop());
            const baseUrl = urlParts.join('/');
            const videoUrl = `${baseUrl}/${encodedFileName}`;
            
            let videoName = options.name;
            if (!videoName || filesToProcess.length > 1) {
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
                logger.verbose(`Failed to parse filename with anitomy: ${error.message}`);
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
            logger.info(`Import ID: ${importResult.id}`, 1);
            logger.info(`Video ID: ${videoId}`, 1);

            logger.step('⏳', 'Waiting for PeerTube to import from R2');
            
            const processingSpinner = ora('Monitoring import status...').start();
            const processingResult = await peertubeService.waitForProcessing(videoId, maxWaitMinutes);
            
            if (processingResult.success) {
              processingSpinner.succeed(`Import completed, final state: ${processingResult.finalState}`);
            } else {
              processingSpinner.warn(`Import timeout: ${processingResult.finalState}`);
            }

            if (animeId && processingResult.video) {
              logger.step('📺', 'Updating anime episode');
              
              try {
                const episodeSpinner = ora('Parsing filename and updating episode...').start();
                
                const fileName = fileInfo.fileName;
                const anitomyResult = await anitomy(fileName);
                
                if (!anitomyResult.episode_number) {
                  episodeSpinner.warn('Could not extract episode number from filename');
                  logger.warning('Skipping episode update - no episode number found');
                } else {
                  const episodeNumber = parseInt(anitomyResult.episode_number);
                  const video = processingResult.video;
                  
                  const anitorrentService = new AniTorrentService();
                  
                  let animeTitle = anitomyResult.anime_title || video.name;
                  
                  try {
                    const animeData = await anitorrentService.getAnimeById(animeId);
                    animeTitle = animeData.title?.english || animeData.title?.romaji || animeTitle;
                  } catch (error) {
                    logger.verbose(`Could not fetch anime data, using parsed title: ${error.message}`);
                  }
                  
                  const thumbnailUrl = video.thumbnailPath 
                    ? `https://peertube.anitorrent.com${video.thumbnailPath}`
                    : null;
                  
                  if (!thumbnailUrl) {
                    throw new Error('No thumbnail available for episode');
                  }
                  
                  const episodeData = {
                    peertubeId: video.id.toString(),
                    uuid: video.uuid,
                    shortUUID: video.shortUUID,
                    password: videoPassword || null,
                    title: {
                      es: null,
                      en: null,
                      ja: null
                    },
                    embedUrl: `${peertubeConfig.apiUrl.replace('/api/v1', '')}/videos/embed/${video.shortUUID}`,
                    thumbnailUrl: thumbnailUrl,
                    description: video.description || null,
                    duration: video.duration || null
                  };
                  
                  await anitorrentService.updateCustomEpisode(animeId, episodeNumber, episodeData);
                  
                  episodeSpinner.succeed(`Episode ${episodeNumber} updated successfully`);
                  logger.info(`Episode: ${episodeNumber}`, 1);
                  logger.info(`Anime: ${animeTitle}`, 1);
                }
                
              } catch (error) {
                logger.error(`Failed to update episode: ${error.message}`);
                logger.warning('Video upload completed but episode update failed');
              }
            }

            if (!keepR2File) {
              logger.step('🗑️', 'Cleaning up R2 file');
              
              const cleanupSpinner = ora('Deleting R2 file...').start();
              await s3Service.deleteFile(r2FileName, true);
              cleanupSpinner.succeed('R2 file deleted');
            }

            if (fileInfo.downloadedFromTorrent && torrentService) {
              logger.step('🗑️', 'Cleaning up torrent file');
              
              const torrentCleanupSpinner = ora('Deleting downloaded torrent file...').start();
              await torrentService.cleanupFile(fileInfo.resolvedPath);
              torrentService.destroy();
              torrentCleanupSpinner.succeed('Torrent file deleted');
            }

            const result = {
              fileName: fileInfo.fileName,
              success: true,
              video: processingResult.video,
              finalState: processingResult.finalState,
              videoUrl: videoUrl,
              keepR2File: keepR2File
            };

            results.push(result);
            logger.success(`✅ File ${currentFile}/${totalFiles} completed successfully`);

          } catch (error) {
            logger.error(`❌ File ${currentFile}/${totalFiles} failed: ${error.message}`);
            
            errors.push({
              fileName: fileInfo.fileName,
              error: error.message
            });

            if (r2FileName && !keepR2File) {
              logger.info('Attempting cleanup of R2 file...');
              try {
                const s3Service = new S3Service(r2Config);
                await s3Service.deleteFile(r2FileName, true);
                logger.success('R2 file cleaned up successfully');
              } catch (cleanupError) {
                logger.error(`Failed to cleanup R2 file: ${cleanupError.message}`);
                logger.error(`Manual cleanup required for: ${r2FileName}`);
              }
            }

            if (fileInfo.downloadedFromTorrent && torrentService) {
              logger.info('Attempting cleanup of torrent file...');
              try {
                await torrentService.cleanupFile(fileInfo.resolvedPath);
                torrentService.destroy();
                logger.success('Torrent file cleaned up successfully');
              } catch (cleanupError) {
                logger.error(`Failed to cleanup torrent file: ${cleanupError.message}`);
              }
            }
          }

        } catch (fileError) {
          logger.error(`❌ File ${currentFile}/${totalFiles} failed: ${fileError.message}`);
          errors.push({
            fileName: fileInfo.fileName,
            error: fileError.message
          });
        }

        logger.separator();
      }

      logger.header('Batch Process Summary');
      logger.info(`Total files processed: ${filesToProcess.length}`);
      logger.info(`Successful uploads: ${results.length}`);
      logger.info(`Failed uploads: ${errors.length}`);
      logger.separator();

      if (results.length > 0) {
        logger.success('Successfully processed files:');
        results.forEach((result, index) => {
          logger.info(`${index + 1}. ${result.fileName}`, 1);
          if (result.video) {
            logger.info(`   Video ID: ${result.video.id}`, 2);
            logger.info(`   Watch URL: ${result.video.url}`, 2);
            logger.info(`   Embed URL: ${peertubeConfig.apiUrl.replace('/api/v1', '')}/videos/embed/${result.video.shortUUID}`, 2);
          }
          if (result.keepR2File) {
            logger.info(`   R2 File: ${result.videoUrl}`, 2);
          } else {
            logger.info(`   R2 File: Deleted`, 2);
          }
        });
        logger.separator();
      }

      if (errors.length > 0) {
        logger.error('Failed files:');
        errors.forEach((error, index) => {
          logger.info(`${index + 1}. ${error.fileName}: ${error.error}`, 1);
        });
        logger.separator();
        
        if (results.length === 0) {
          process.exit(1);
        }
      }

    } catch (error) {
      logger.error(`Auto upload failed: ${error.message}`);
      
      if (torrentService) {
        try {
          filesToProcess.forEach(async (fileInfo) => {
            if (fileInfo.downloadedFromTorrent) {
              await torrentService.cleanupFile(fileInfo.resolvedPath);
            }
          });
          torrentService.destroy();
        } catch (cleanupError) {
          logger.verbose(`Failed to cleanup torrent files: ${cleanupError.message}`);
        }
      }
      
      process.exit(1);
    }
  });

module.exports = uploadCommand; 