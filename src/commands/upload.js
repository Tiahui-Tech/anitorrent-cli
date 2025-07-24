const { Command } = require('commander');
const ora = require('ora');
const path = require('path');
const inquirer = require('inquirer');
const ConfigManager = require('../utils/config');
const { Logger } = require('../utils/logger');
const Validators = require('../utils/validators');
const S3Service = require('../services/s3-service');
const PeerTubeService = require('../services/peertube-service');
const AniTorrentService = require('../services/anitorrent-service');
const TorrentService = require('../services/torrent-service');
const SubtitleService = require('../services/subtitle-service');
const UploadService = require('../services/upload-service');
const anitomy = require('anitomyscript');

async function scanDirectoryForVideos(dir, recursive = false, logger) {
  const fs = require('fs').promises;
  const foundFiles = [];

  async function scanDir(currentDir, relativePath = '') {
    try {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        const relativeFilePath = path.join(relativePath, entry.name);

        if (entry.isFile()) {
          if (Validators.isValidVideoFile(fullPath)) {
            const stats = await fs.stat(fullPath);
            foundFiles.push({
              originalPath: relativeFilePath,
              resolvedPath: fullPath,
              fileName: entry.name,
              downloadedFromTorrent: false,
              size: stats.size,
              directory: relativePath || '.',
            });
          }
        } else if (entry.isDirectory() && recursive) {
          await scanDir(fullPath, relativeFilePath);
        }
      }
    } catch (error) {
      // Skip verbose logging here since scanDirectoryForVideos doesn't have access to isLogs
    }
  }

  await scanDir(dir);
  return foundFiles;
}

async function scanDirectoryForSubtitles(dir, recursive = false, logger) {
  const fs = require('fs').promises;
  const foundFiles = [];

  async function scanDir(currentDir, relativePath = '') {
    try {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        const relativeFilePath = path.join(relativePath, entry.name);

        if (entry.isFile()) {
          if (Validators.isValidSubtitleFile(fullPath)) {
            const stats = await fs.stat(fullPath);
            foundFiles.push({
              originalPath: relativeFilePath,
              resolvedPath: fullPath,
              fileName: entry.name,
              size: stats.size,
              directory: relativePath || '.',
            });
          }
        } else if (entry.isDirectory() && recursive) {
          await scanDir(fullPath, relativeFilePath);
        }
      }
    } catch (error) {
      // Skip verbose logging here since scanDirectoryForSubtitles doesn't have access to isLogs
    }
  }

  await scanDir(dir);
  return foundFiles;
}

const uploadCommand = new Command('upload');
uploadCommand.description('File upload operations');

uploadCommand
  .command('r2')
  .description('Upload file to Cloudflare R2')
  .argument('<file>', 'file to upload (supports absolute and relative paths)')
  .option('--name <name>', 'custom name for uploaded file')
  .option('--timestamp', 'add timestamp to filename')
  .action(async (file, options) => {
    const isLogs = uploadCommand.parent?.opts()?.logs || false;
    const logger = new Logger({
      verbose: false,
      quiet: uploadCommand.parent?.opts()?.quiet || false,
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
      if (isLogs) {
        logger.info(`Using file: ${resolvedFile}`);
      }

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
        const result = await s3Service.uploadFile(
          resolvedFile,
          `videos/${uploadFileName}`,
          true
        );
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
  .argument(
    '[file]',
    'file to upload (supports absolute and relative paths) or torrent URL/magnet when using --torrent. If not specified, uploads all video files from current directory'
  )
  .option('--torrent', 'download file from torrent URL or magnet link')
  .option(
    '--name <name>',
    'custom name for the video (ignored when processing multiple files)'
  )
  .option('--timestamp', 'add timestamp to filename')
  .option('--channel <id>', 'PeerTube channel ID')
  .option('--privacy <level>', 'privacy level (1-5)')
  .option('--password <password>', 'video password')
  .option('--wait <minutes>', 'max wait time for processing', '120')
  .option('--keep-r2', 'keep file in R2 after import')
  .option('--anime-id <id>', 'AniList anime ID for episode update')
  .option('--sub-folders', 'search for video files in subfolders as well')
  .option('--use-title', 'use the title of the video for the upload name')
  .option(
    '--track <number>',
    'subtitle track number for extraction (if not specified, auto-finds Spanish Latino)'
  )
  .action(async (file, options) => {
    const isLogs = uploadCommand.parent?.opts()?.logs || false;
    const logger = new Logger({
      verbose: false,
      quiet: uploadCommand.parent?.opts()?.quiet || false,
    });

    if (options.torrent && !file) {
      logger.error(
        'You must specify a torrent URL/magnet when using --torrent option'
      );
      process.exit(1);
    }

    let filesToProcess = [];
    let torrentService = null;

    try {
      if (!file) {
        const currentDir = process.cwd();
        const searchSubfolders = options.subFolders;

        logger.header(
          `Scanning ${
            searchSubfolders ? 'Directory Tree' : 'Current Directory'
          } for Video Files`
        );
        logger.info(`Directory: ${currentDir}`);
        if (searchSubfolders) {
          logger.info('Including subfolders: Yes');
        }
        logger.separator();

        const scanSpinner = ora('Scanning for video files...').start();
        filesToProcess = await scanDirectoryForVideos(
          currentDir,
          searchSubfolders,
          logger
        );
        scanSpinner.succeed('Scan completed');

        if (filesToProcess.length === 0) {
          logger.error(
            `No video files found in the ${
              searchSubfolders ? 'directory tree' : 'current directory'
            }`
          );
          process.exit(1);
        }

        logger.success(`Found ${filesToProcess.length} video file(s):`);

        const groupedFiles = {};
        filesToProcess.forEach((fileInfo) => {
          if (!groupedFiles[fileInfo.directory]) {
            groupedFiles[fileInfo.directory] = [];
          }
          groupedFiles[fileInfo.directory].push(fileInfo);
        });

        Object.keys(groupedFiles)
          .sort()
          .forEach((dir) => {
            logger.info(`📁 ${dir}:`, 1);
            groupedFiles[dir].forEach((fileInfo, index) => {
              const fileSize = Validators.formatFileSize(fileInfo.size);
              logger.info(
                `  ${index + 1}. ${fileInfo.fileName} (${fileSize})`,
                2
              );
            });
          });

        logger.separator();

        const totalSize = filesToProcess.reduce(
          (sum, file) => sum + file.size,
          0
        );
        logger.info(`Total files: ${filesToProcess.length}`);
        logger.info(`Total size: ${Validators.formatFileSize(totalSize)}`);
        logger.separator();

        const { proceed } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'proceed',
            message: 'Do you want to proceed with uploading these files?',
            default: false,
          },
        ]);

        if (!proceed) {
          logger.info('Upload cancelled by user');
          process.exit(0);
        }

        logger.separator();
      } else if (options.torrent) {
        logger.header('Torrent Download Process');
        logger.info(`Torrent URL/Magnet: ${file}`);
        logger.separator();

        const config = new ConfigManager();
        config.validateRequired();
        const uploadService = new UploadService(config, logger);

        try {
          const downloadResult = await uploadService.downloadFromTorrent(
            file,
            logger
          );
          filesToProcess = [downloadResult.fileInfo];
          torrentService = downloadResult.torrentService;
        } catch (error) {
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

        filesToProcess = [
          {
            originalPath: fileValidation.originalPath,
            resolvedPath: fileValidation.resolvedPath,
            fileName: path.basename(fileValidation.resolvedPath),
            downloadedFromTorrent: false,
          },
        ];

        if (isLogs) {
          logger.info(`Using file: ${fileValidation.resolvedPath}`);
        }
      }

      const config = new ConfigManager();
      config.validateRequired();

      const r2Config = config.getR2Config();
      const peertubeConfig = config.getPeerTubeConfig();
      const defaults = config.getDefaults();

      const channelId = options.channel
        ? parseInt(options.channel)
        : await config.getDefaultChannelId();
      const privacy = options.privacy
        ? parseInt(options.privacy)
        : defaults.privacy;
      const videoPassword = options.password || defaults.videoPassword;
      const maxWaitMinutes = parseInt(options.wait);
      const keepR2File = options.keepR2;
      const animeId = options.animeId;

      let subtitleTrack = null;
      if (options.track !== undefined) {
        subtitleTrack = parseInt(options.track);
        if (!Validators.isValidSubtitleTrack(subtitleTrack)) {
          logger.error('Invalid subtitle track number');
          process.exit(1);
        }
      }

      if (!Validators.isValidChannelId(channelId)) {
        logger.error('Invalid channel ID');
        process.exit(1);
      }

      if (!Validators.isValidPrivacyLevel(privacy)) {
        logger.error('Invalid privacy level (must be 1-5)');
        process.exit(1);
      }

      logger.header(
        `Auto Upload & Import Process - ${filesToProcess.length} file(s)`
      );
      logger.info(`Channel ID: ${channelId}`);
      logger.info(`Privacy: ${privacy}`);
      logger.info(`Keep R2 file: ${keepR2File ? 'Yes' : 'No'}`);
      logger.info(`Max wait time: ${maxWaitMinutes} minutes`);
      if (subtitleTrack !== null) {
        logger.info(`Subtitle track: ${subtitleTrack}`);
      } else {
        logger.info('Subtitle track: Auto-detect Spanish Latino');
      }
      if (animeId) {
        logger.info(`Anime ID: ${animeId}`);
      }
      logger.separator();

      const results = [];
      const errors = [];

      const uploadService = new UploadService(config, logger);

      for (let i = 0; i < filesToProcess.length; i++) {
        const fileInfo = filesToProcess[i];
        const currentFile = i + 1;
        const totalFiles = filesToProcess.length;

        logger.header(
          `Processing File ${currentFile}/${totalFiles}: ${fileInfo.fileName}`
        );

        try {
          const uploadOptions = {
            channelId,
            privacy,
            videoPassword,
            maxWaitMinutes,
            keepR2File,
            animeId,
            subtitleTrack,
            customName:
              options.name && filesToProcess.length === 1 ? options.name : null,
            timestamp: options.timestamp,
            useTitle: options.useTitle,
          };

          const result = await uploadService.processFileUpload(
            fileInfo,
            uploadOptions
          );

          if (fileInfo.downloadedFromTorrent && torrentService) {
            await uploadService.cleanupTorrentFile(fileInfo, torrentService);
          }

          results.push(result);
          logger.success(
            `✅ File ${currentFile}/${totalFiles} completed successfully`
          );
        } catch (error) {
          logger.error(
            `❌ File ${currentFile}/${totalFiles} failed: ${error.message}`
          );

          errors.push({
            fileName: fileInfo.fileName,
            error: error.message,
          });

          if (fileInfo.downloadedFromTorrent && torrentService) {
            try {
              await uploadService.cleanupTorrentFile(fileInfo, torrentService);
            } catch (cleanupError) {
              logger.error(
                `Failed to cleanup torrent file: ${cleanupError.message}`
              );
            }
          }
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
            logger.info(
              `   Embed URL: ${peertubeConfig.apiUrl.replace(
                '/api/v1',
                ''
              )}/videos/embed/${result.video.shortUUID}`,
              2
            );
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
          if (isLogs) {
            logger.info(
              `Failed to cleanup torrent files: ${cleanupError.message}`
            );
          }
        }
      }

      process.exit(1);
    }
  });

uploadCommand
  .command('subtitles')
  .description('Upload all subtitle files (.ass) from current directory to R2')
  .option('--sub-folders', 'search for subtitle files in subfolders as well')
  .option('--timestamp', 'add timestamp to filenames')
  .action(async (options) => {
    const isLogs = uploadCommand.parent?.opts()?.logs || false;
    const logger = new Logger({
      verbose: false,
      quiet: uploadCommand.parent?.opts()?.quiet || false,
    });

    try {
      const currentDir = process.cwd();
      const searchSubfolders = options.subFolders;

      logger.header(
        `Scanning ${
          searchSubfolders ? 'Directory Tree' : 'Current Directory'
        } for Subtitle Files`
      );
      logger.info(`Directory: ${currentDir}`);
      if (searchSubfolders) {
        logger.info('Including subfolders: Yes');
      }
      logger.separator();

      const scanSpinner = ora('Scanning for subtitle files...').start();
      const filesToProcess = await scanDirectoryForSubtitles(
        currentDir,
        searchSubfolders,
        logger
      );
      scanSpinner.succeed('Scan completed');

      if (filesToProcess.length === 0) {
        logger.error(
          `No subtitle files found in the ${
            searchSubfolders ? 'directory tree' : 'current directory'
          }`
        );
        process.exit(1);
      }

      logger.success(`Found ${filesToProcess.length} subtitle file(s):`);

      const groupedFiles = {};
      filesToProcess.forEach((fileInfo) => {
        if (!groupedFiles[fileInfo.directory]) {
          groupedFiles[fileInfo.directory] = [];
        }
        groupedFiles[fileInfo.directory].push(fileInfo);
      });

      Object.keys(groupedFiles)
        .sort()
        .forEach((dir) => {
          logger.info(`📁 ${dir}:`, 1);
          groupedFiles[dir].forEach((fileInfo, index) => {
            const fileSize = Validators.formatFileSize(fileInfo.size);
            logger.info(
              `  ${index + 1}. ${fileInfo.fileName} (${fileSize})`,
              2
            );
          });
        });

      logger.separator();

      const totalSize = filesToProcess.reduce(
        (sum, file) => sum + file.size,
        0
      );
      logger.info(`Total files: ${filesToProcess.length}`);
      logger.info(`Total size: ${Validators.formatFileSize(totalSize)}`);
      logger.separator();

      const { proceed } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'proceed',
          message:
            'Do you want to proceed with uploading these subtitle files?',
          default: false,
        },
      ]);

      if (!proceed) {
        logger.info('Upload cancelled by user');
        process.exit(0);
      }

      logger.separator();

      const config = new ConfigManager();
      config.validateRequired();
      const r2Config = config.getR2Config();
      const s3Service = new S3Service(r2Config);

      const results = [];
      const errors = [];

      for (let i = 0; i < filesToProcess.length; i++) {
        const fileInfo = filesToProcess[i];
        const currentFile = i + 1;
        const totalFiles = filesToProcess.length;

        logger.header(
          `Uploading File ${currentFile}/${totalFiles}: ${fileInfo.fileName}`
        );

        try {
          let uploadFileName = fileInfo.fileName;

          if (options.timestamp) {
            const ext = path.extname(fileInfo.resolvedPath);
            const nameWithoutExt = path.basename(fileInfo.resolvedPath, ext);
            const timestamp = Date.now();
            uploadFileName = `${nameWithoutExt}_${timestamp}${ext}`;
          }

          const fileSize = Validators.formatFileSize(fileInfo.size);
          logger.info(`File: ${fileInfo.originalPath}`);
          logger.info(`Size: ${fileSize}`);
          logger.info(`Upload name: ${uploadFileName}`);
          logger.separator();

          const spinner = ora('Uploading to R2...').start();

          const result = await s3Service.uploadFile(
            fileInfo.resolvedPath,
            `subtitles/${uploadFileName}`,
            true
          );

          spinner.succeed('Upload completed');
          logger.info(`Public URL: ${result.publicUrl}`, 1);
          logger.info(`ETag: ${result.ETag}`, 1);

          results.push({
            fileName: fileInfo.fileName,
            uploadName: uploadFileName,
            success: true,
            publicUrl: result.publicUrl,
            size: fileInfo.size,
          });

          logger.success(
            `✅ File ${currentFile}/${totalFiles} uploaded successfully`
          );
        } catch (error) {
          logger.error(
            `❌ File ${currentFile}/${totalFiles} failed: ${error.message}`
          );

          errors.push({
            fileName: fileInfo.fileName,
            error: error.message,
          });
        }

        logger.separator();
      }

      logger.header('Subtitle Upload Summary');
      logger.info(`Total files processed: ${filesToProcess.length}`);
      logger.info(`Successful uploads: ${results.length}`);
      logger.info(`Failed uploads: ${errors.length}`);
      logger.separator();

      if (results.length > 0) {
        logger.success('Successfully uploaded files:');
        results.forEach((result, index) => {
          logger.info(`${index + 1}. ${result.fileName}`, 1);
          logger.info(`   Upload name: ${result.uploadName}`, 2);
          logger.info(`   Public URL: ${result.publicUrl}`, 2);
          logger.info(`   Size: ${Validators.formatFileSize(result.size)}`, 2);
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
      logger.error(`Subtitle upload failed: ${error.message}`);
      process.exit(1);
    }
  });

module.exports = uploadCommand;
