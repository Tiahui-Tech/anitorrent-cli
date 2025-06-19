const { Command } = require('commander');
const ora = require('ora');
const { Logger } = require('../utils/logger');
const Validators = require('../utils/validators');
const AudioService = require('../services/audio-service');

const audioCommand = new Command('audio');
audioCommand.description('Audio track management and extraction');

audioCommand
  .command('list')
  .description('List audio tracks from a video file')
  .argument('<file>', 'video file path')
  .action(async (file, options) => {
    const isLogs = audioCommand.parent?.opts()?.logs || false;
    const logger = new Logger({ 
      verbose: false,
      quiet: audioCommand.parent?.opts()?.quiet || false
    });

    try {
      const pathValidation = await Validators.validateFilePath(file);
      const videoFile = pathValidation.resolvedPath;
      
      const fs = require('fs').promises;
      try {
        const stats = await fs.stat(videoFile);
        if (!stats.isFile()) {
          logger.error(`Path "${file}" is not a file`);
          process.exit(1);
        }
      } catch (error) {
        logger.error(`File not found: "${file}"`);
        if (pathValidation.originalPath !== pathValidation.resolvedPath) {
          logger.error(`Resolved path: "${pathValidation.resolvedPath}"`);
        }
        process.exit(1);
      }

      const audioService = new AudioService();
      
      logger.header('Audio Track Information');
      logger.info(`File: ${videoFile}`);
      logger.separator();

      const spinner = ora('Analyzing audio tracks...').start();
      const audioTracks = await audioService.listAudioTracks(videoFile);
      spinner.succeed(`Found ${audioTracks.length} audio tracks`);

      if (audioTracks.length === 0) {
        logger.warning('No audio tracks found in the video file');
        return;
      }

      audioTracks.forEach((track, index) => {
        logger.info(`Track ${track.trackNumber}:`);
        logger.info(`  Language: ${track.language}${track.languageDetail ? ` (${track.languageDetail})` : ''}`, 1);
        logger.info(`  Title: ${track.title}`, 1);
        logger.info(`  Codec: ${track.codec}`, 1);
        logger.info(`  Channels: ${track.channels}`, 1);
        logger.info(`  Sample Rate: ${track.sampleRate} Hz`, 1);
        if (track.bitrate) {
          logger.info(`  Bitrate: ${Math.round(track.bitrate / 1000)} kbps`, 1);
        }
        
        if (isLogs) {
          logger.info(`  Stream Index: ${track.index}`, 1);
          
          if (track.allTags) {
            logger.info(`  All Tags:`, 1);
            Object.entries(track.allTags).forEach(([key, value]) => {
              logger.info(`    ${key}: ${value}`, 1);
            });
          }
          
          if (track.disposition) {
            const dispositionFlags = Object.entries(track.disposition)
              .filter(([key, value]) => value === 1)
              .map(([key]) => key);
            if (dispositionFlags.length > 0) {
              logger.info(`  Disposition: ${dispositionFlags.join(', ')}`, 1);
            }
          }
        }
        
        if (index < audioTracks.length - 1) {
          logger.separator();
        }
      });

    } catch (error) {
      logger.error(`Failed to list audio tracks: ${error.message}`);
      process.exit(1);
    }
  });

audioCommand
  .command('extract')
  .description('Extract audio tracks from videos')
  .argument('[file]', 'video file path (if not provided, extracts from all videos in folder)')
  .option('--folder <path>', 'folder path to search for videos (default: current directory)')
  .option('--track <number>', 'audio track number to extract (if not specified, auto-finds Spanish Latino)')
  .option('--format <format>', 'output audio format (mp3, aac, flac, wav, ogg)', 'mp3')
  .option('--bitrate <bitrate>', 'audio bitrate (e.g., 192k, 256k, 320k)', '192k')
  .option('--all-tracks', 'extract all audio tracks from the file')
  .option('--advanced', 'use advanced extraction with mkvmerge (better track naming)')
  .option('--prefix <prefix>', 'custom prefix for output files (default: video filename)')
  .action(async (file, options) => {
    const isLogs = audioCommand.parent?.opts()?.logs || false;
    const logger = new Logger({ 
      verbose: false,
      quiet: audioCommand.parent?.opts()?.quiet || false
    });

    try {
      let audioTrack = null;
      
      if (options.track !== undefined) {
        audioTrack = parseInt(options.track);
        if (!Validators.isValidSubtitleTrack(audioTrack)) {
          logger.error('Invalid audio track number');
          process.exit(1);
        }
      }
      
      const format = options.format.toLowerCase();
      const bitrate = options.bitrate;

      const validFormats = ['mp3', 'aac', 'flac', 'wav', 'ogg'];
      if (!validFormats.includes(format)) {
        logger.error(`Invalid format. Supported formats: ${validFormats.join(', ')}`);
        process.exit(1);
      }

      const bitrateRegex = /^\d+k?$/i;
      if (!bitrateRegex.test(bitrate)) {
        logger.error('Invalid bitrate format. Use format like: 192k, 256k, 320k');
        process.exit(1);
      }

      const audioService = new AudioService();

      let folderPath = '.';
      if (options.folder) {
        const pathValidation = await Validators.validateFilePath(options.folder);
        folderPath = pathValidation.resolvedPath;
        
        const fs = require('fs').promises;
        try {
          const stats = await fs.stat(folderPath);
          if (!stats.isDirectory()) {
            logger.error(`Path "${options.folder}" is not a directory`);
            process.exit(1);
          }
        } catch (error) {
          logger.error(`Directory not found: "${options.folder}"`);
          if (pathValidation.originalPath !== pathValidation.resolvedPath) {
            logger.error(`Resolved path: "${pathValidation.resolvedPath}"`);
          }
          process.exit(1);
        }
      }

      if (file) {
        const pathValidation = await Validators.validateFilePath(file);
        const videoFile = pathValidation.resolvedPath;
        
        const fs = require('fs').promises;
        try {
          const stats = await fs.stat(videoFile);
          if (!stats.isFile()) {
            logger.error(`Path "${file}" is not a file`);
            process.exit(1);
          }
        } catch (error) {
          logger.error(`File not found: "${file}"`);
          if (pathValidation.originalPath !== pathValidation.resolvedPath) {
            logger.error(`Resolved path: "${pathValidation.resolvedPath}"`);
          }
          process.exit(1);
        }

        if (options.allTracks) {
          if (options.advanced) {
            logger.header('Advanced Audio Extraction (All Tracks)');
            logger.info(`File: ${videoFile}`);
            logger.info(`Format: ${format.toUpperCase()}`);
            logger.info(`Bitrate: ${bitrate}`);
            logger.info(`Method: mkvmerge + ffmpeg`);
            if (options.prefix) {
              logger.info(`Prefix: ${options.prefix}`);
            }
            logger.separator();

            try {
              const results = await audioService.extractAllAudioTracksAdvanced(
                videoFile, 
                folderPath, 
                format, 
                bitrate,
                options.prefix
              );

              const successful = results.filter(r => r.success).length;
              const failed = results.filter(r => !r.success).length;

              logger.success(`Advanced extraction completed: ${successful} successful, ${failed} failed`);

              if (isLogs) {
                results.forEach(result => {
                  if (result.success) {
                    logger.info(`✓ Track ${result.trackIndex} (${result.trackInfo.language}) → ${result.outputFile}`, 1);
                  } else {
                    logger.info(`✗ Track ${result.trackIndex}: ${result.error}`, 1);
                  }
                });
              }
            } catch (error) {
              logger.error(`Advanced extraction failed: ${error.message}`);
              logger.info('Falling back to standard extraction...');
              
              const spinner = ora('Extracting all audio tracks (standard method)...').start();
              const results = await audioService.extractAllAudioTracks(videoFile, folderPath, format, options.prefix);
              spinner.succeed(`Extraction completed`);

              const successful = results.filter(r => r.success).length;
              const failed = results.filter(r => !r.success).length;

              logger.success(`Standard extraction completed: ${successful} successful, ${failed} failed`);
            }
          } else {
            logger.header('Extract All Audio Tracks');
            logger.info(`File: ${videoFile}`);
            logger.info(`Format: ${format.toUpperCase()}`);
            logger.separator();

            const spinner = ora('Extracting all audio tracks...').start();
            const results = await audioService.extractAllAudioTracks(videoFile, folderPath, format, options.prefix);
            spinner.succeed(`Extraction completed`);

            const successful = results.filter(r => r.success).length;
            const failed = results.filter(r => !r.success).length;

            logger.success(`Extraction completed: ${successful} successful, ${failed} failed`);

            if (isLogs) {
              results.forEach(result => {
                if (result.success) {
                  logger.info(`✓ Track ${result.track.trackNumber} (${result.track.language}) → ${result.outputFile}`, 1);
                } else {
                  logger.info(`✗ Track ${result.track.trackNumber}: ${result.error}`, 1);
                }
              });
            }
          }
        } else {
          logger.header('Single Audio Track Extraction');
          logger.info(`File: ${videoFile}`);
          
          if (audioTrack !== null) {
            logger.info(`Track: ${audioTrack}`);
          } else {
            logger.info('Track: Auto-detect Spanish Latino');
          }
          logger.info(`Format: ${format.toUpperCase()}`);
          logger.info(`Bitrate: ${bitrate}`);
          logger.separator();

          let targetTrack = audioTrack;
          if (targetTrack === null) {
            const tracks = await audioService.listAudioTracks(videoFile);
            targetTrack = audioService.findDefaultSpanishTrack(tracks);
            if (targetTrack === -1) {
              targetTrack = 0;
            }
            logger.info(`Auto-detected track: ${targetTrack}`);
          }

          const tracks = await audioService.listAudioTracks(videoFile);
          const spanishTracks = tracks.filter(t => t.language === 'spa' || t.language === 'es');
          const nameWithoutExt = options.prefix || require('path').parse(videoFile).name;
          
          let outputFile;
          if (spanishTracks.length === 1 && targetTrack < tracks.length && 
              (tracks[targetTrack].language === 'spa' || tracks[targetTrack].language === 'es')) {
            outputFile = `${nameWithoutExt}_lat.${format}`;
          } else if (targetTrack < tracks.length) {
            const track = tracks[targetTrack];
            const langSuffix = audioService.getLanguageSuffix(track);
            outputFile = langSuffix ? `${nameWithoutExt}_${langSuffix}.${format}` : `${nameWithoutExt}.${format}`;
          } else {
            outputFile = `${nameWithoutExt}.${format}`;
          }
          
          const spinner = ora('Extracting audio track...').start();
          const result = await audioService.extractAudio(videoFile, outputFile, targetTrack, folderPath, format, bitrate);
          
          if (result.success) {
            spinner.succeed(`Audio extracted to: ${result.outputPath}`);
          } else {
            spinner.fail(`Extraction failed: ${result.error}`);
            process.exit(1);
          }
        }
      } else {
        logger.header('Bulk Audio Extraction');
        logger.info(`Directory: ${folderPath === '.' ? 'Current directory' : folderPath}`);
        
        if (audioTrack !== null) {
          logger.info(`Audio track: ${audioTrack}`);
        } else {
          logger.info('Audio track: Auto-detect Spanish Latino');
        }
        logger.info(`Format: ${format.toUpperCase()}`);
        logger.info(`Bitrate: ${bitrate}`);
        logger.separator();

        const spinner = ora('Finding local video files...').start();
        const localFiles = await audioService.getLocalVideoFiles(folderPath);
        spinner.succeed(`Found ${localFiles.length} local video files`);

        if (localFiles.length === 0) {
          logger.warning(`No video files found in directory: ${folderPath}`);
          return;
        }

        logger.info('Extracting audio...');
        const results = await audioService.extractAllAudio(audioTrack, folderPath, format);
        
        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;

        logger.separator();
        logger.success(`Extraction completed: ${successful} successful, ${failed} failed`);

        if (isLogs) {
          results.forEach(result => {
            if (result.success) {
              logger.info(`✓ ${result.filename} → ${result.outputFile}`, 1);
            } else {
              logger.info(`✗ ${result.filename}: ${result.error}`, 1);
            }
          });
        }
      }

    } catch (error) {
      logger.error(`Audio extraction failed: ${error.message}`);
      process.exit(1);
    }
  });

module.exports = audioCommand; 