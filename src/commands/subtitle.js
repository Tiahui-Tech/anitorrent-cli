const { Command } = require('commander');
const ora = require('ora');
const ConfigManager = require('../utils/config');
const { Logger } = require('../utils/logger');
const Validators = require('../utils/validators');
const SubtitleService = require('../services/subtitle-service');
const TranslationService = require('../services/translation-service');
const anitomy = require('anitomyscript');

const subtitlesCommand = new Command('subtitle');
subtitlesCommand.description('Subtitle extraction and management');

subtitlesCommand
  .command('list')
  .description('List subtitle tracks from a video file')
  .argument('<file>', 'video file path')
  .option('--debug, -d', 'debug output')
  .option('--quiet, -q', 'quiet mode')
  .action(async (file, options) => {
    const isDebug = options.debug || false;
    const logger = new Logger({
      verbose: isDebug,
      quiet: options.quiet || false,
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

      const subtitleService = new SubtitleService();

      logger.header('Subtitle Track Information');
      logger.info(`File: ${videoFile}`);
      logger.separator();

      const spinner = ora('Analyzing subtitle tracks...').start();
      const subtitleTracks = await subtitleService.listSubtitleTracks(
        videoFile
      );
      spinner.succeed(`Found ${subtitleTracks.length} subtitle tracks`);

      if (subtitleTracks.length === 0) {
        logger.warning('No subtitle tracks found in the video file');
        return;
      }

      subtitleTracks.forEach((track, index) => {
        logger.info(`Track ${track.trackNumber}:`);
        logger.info(
          `  Language: ${track.language}${
            track.languageDetail ? ` (${track.languageDetail})` : ''
          }`,
          1
        );
        logger.info(`  Title: ${track.title}`, 1);
        logger.info(`  Codec: ${track.codec}`, 1);
        if (track.forced !== undefined) {
          logger.info(`  Forced: ${track.forced ? 'Yes' : 'No'}`, 1);
        }
        if (track.default !== undefined) {
          logger.info(`  Default: ${track.default ? 'Yes' : 'No'}`, 1);
        }

        if (isLogs) {
          logger.info(`  Source: ${track.source}`);
          logger.info(`  Stream Index: ${track.index}`);

          if (track.mkvTrackId !== undefined) {
            logger.info(`  MKV Track ID: ${track.mkvTrackId}`);
          }

          if (track.originalTrackName) {
            logger.info(`  Original Track Name: ${track.originalTrackName}`);
          }

          if (track.properties) {
            logger.info(`  MKV Properties:`);
            Object.entries(track.properties).forEach(([key, value]) => {
              logger.info(`    ${key}: ${value}`);
            });
          }

          if (track.allTags) {
            logger.info(`  FFprobe Tags:`);
            Object.entries(track.allTags).forEach(([key, value]) => {
              logger.info(`    ${key}: ${value}`);
            });
          }

          if (track.disposition) {
            const dispositionFlags = Object.entries(track.disposition)
              .filter(([key, value]) => value === 1)
              .map(([key]) => key);
            if (dispositionFlags.length > 0) {
              logger.info(`  Disposition: ${dispositionFlags.join(', ')}`);
            }
          }
        }

        if (index < subtitleTracks.length - 1) {
          logger.separator();
        }
      });
    } catch (error) {
      logger.error(`Failed to list subtitle tracks: ${error.message}`);
      process.exit(1);
    }
  });

subtitlesCommand
  .command('extract')
  .description('Extract subtitles from videos or playlists')
  .argument(
    '[input]',
    'video file path or PeerTube playlist ID (auto-detected)'
  )
  .option(
    '--folder <path>',
    'folder path to search for videos (default: current directory)'
  )
  .option('--sub-folders', 'search for video files in subfolders as well')
  .option(
    '--track <number>',
    'subtitle track number (if not specified, auto-finds Spanish Latino)'
  )
  .option(
    '--subtitle-suffix <suffix>',
    'custom suffix for the extracted subtitle file (can only be used with --track)'
  )
  .option('--all', 'extract all subtitle tracks')
  .option('--translate', 'also create AI-translated version to Spanish')
  .option(
    '--translate-prompt <path>',
    'custom system prompt file for translation'
  )
  .option(
    '--offset <ms>',
    'adjust subtitle timing by specified milliseconds (e.g., 4970 for +4.970s)',
    parseInt
  )
  .option('--logs', 'detailed output')
  .action(async (input, options, cmd) => {
    const isLogs = options.logs || false;

    const logger = new Logger({
      verbose: false,
      quiet: options.quiet || false,
    });

    const detectInputType = async (input) => {
      if (!input) return { type: 'folder', value: null };

      const fs = require('fs').promises;
      const path = require('path');

      try {
        const pathValidation = await Validators.validateFilePath(input);
        const resolvedPath = pathValidation.resolvedPath;

        const stats = await fs.stat(resolvedPath);

        if (stats.isFile()) {
          const ext = path.extname(resolvedPath).toLowerCase();
          const videoExtensions = [
            '.mp4',
            '.mkv',
            '.avi',
            '.mov',
            '.wmv',
            '.flv',
            '.webm',
            '.m4v',
            '.ts',
            '.mts',
          ];

          if (videoExtensions.includes(ext)) {
            return { type: 'video', value: resolvedPath };
          } else {
            throw new Error(`File "${input}" is not a supported video format`);
          }
        } else if (stats.isDirectory()) {
          return { type: 'folder', value: resolvedPath };
        }
      } catch (error) {
        if (error.code === 'ENOENT') {
          const trimmedInput = input.trim();
          if (trimmedInput && trimmedInput.length > 0) {
            return { type: 'playlist', value: trimmedInput };
          }
        }
        throw error;
      }

      return { type: 'unknown', value: input };
    };

    const applyOffsetToFile = async (filePath, offsetMs) => {
      if (!offsetMs || offsetMs === 0)
        return { success: true, offsetApplied: false };

      const subtitleService = new SubtitleService();

      try {
        const result = await subtitleService.adjustSubtitleTiming(
          filePath,
          offsetMs,
          filePath
        );
        return {
          success: result.success,
          offsetApplied: true,
          error: result.error,
        };
      } catch (error) {
        return {
          success: false,
          offsetApplied: false,
          error: error.message,
        };
      }
    };

    try {
      let subtitleTrack = null;

      if (options.track !== undefined) {
        subtitleTrack = parseInt(options.track);
        if (!Validators.isValidSubtitleTrack(subtitleTrack)) {
          logger.error('Invalid subtitle track number');
          process.exit(1);
        }
      }

      if (options.subtitleSuffix && options.track === undefined) {
        logger.error('--subtitle-suffix can only be used with --track option');
        process.exit(1);
      }

      if (options.subtitleSuffix && options.all) {
        logger.error('--subtitle-suffix cannot be used with --all option');
        process.exit(1);
      }

      const subtitleService = new SubtitleService();

      let translationConfig = null;
      if (options.translate) {
        const config = new ConfigManager();
        translationConfig = config.getTranslationConfig();

        if (!translationConfig.apiKey) {
          logger.error('Claude API key not configured. Translation disabled.');
          logger.info('Run "anitorrent config setup" to set up configuration');
          translationConfig = null;
        }
      }

      let folderPath = '.';
      if (options.folder) {
        const pathValidation = await Validators.validateFilePath(
          options.folder
        );
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

      const inputType = await detectInputType(input);

      if (inputType.type === 'video') {
        const videoFile = inputType.value;

        if (options.all) {
          logger.header('Extract All Subtitle Tracks');
          logger.info(`File: ${videoFile}`);
          if (translationConfig) {
            logger.info('Translation: Enabled');
          }
          if (options.offset) {
            logger.info(
              `Timing offset: ${options.offset}ms (${
                options.offset >= 0 ? 'forward' : 'backward'
              })`
            );
          }
          logger.separator();

          const spinner = ora('Extracting all subtitle tracks...').start();

          let results;
          if (translationConfig) {
            const onProgress = (progress) => {
              if (progress.type === 'translation_start') {
                spinner.text = `Translating ${require('path').basename(
                  progress.file
                )}...`;
              } else if (progress.type === 'translation_complete') {
                spinner.text = 'Extracting subtitle tracks...';
              }
            };

            results =
              await subtitleService.extractAllSubtitleTracksWithTranslation(
                videoFile,
                folderPath,
                translationConfig,
                onProgress
              );
          } else {
            results = await subtitleService.extractAllSubtitleTracks(
              videoFile,
              folderPath
            );
          }

          spinner.succeed(`Extraction completed`);

          if (options.offset) {
            const offsetSpinner = ora(
              'Applying timing offset to extracted files...'
            ).start();
            let offsetSuccessful = 0;
            let offsetFailed = 0;

            for (const result of results) {
              if (result.success && result.outputFile) {
                const offsetResult = await applyOffsetToFile(
                  result.outputFile,
                  options.offset
                );
                if (offsetResult.success) {
                  offsetSuccessful++;
                  result.offsetApplied = true;
                } else {
                  offsetFailed++;
                  result.offsetError = offsetResult.error;
                }
              }
            }

            if (offsetFailed === 0) {
              offsetSpinner.succeed(
                `Timing offset applied to ${offsetSuccessful} files`
              );
            } else {
              offsetSpinner.warn(
                `Timing offset: ${offsetSuccessful} successful, ${offsetFailed} failed`
              );
            }
          }

          const successful = results.filter((r) => r.success).length;
          const failed = results.filter((r) => !r.success).length;

          logger.success(
            `Extraction completed: ${successful} successful, ${failed} failed`
          );
          if (options.offset) {
            const offsetSuccessful = results.filter(
              (r) => r.success && r.offsetApplied
            ).length;
            const offsetFailed = results.filter(
              (r) => r.success && r.offsetError
            ).length;
            if (offsetSuccessful > 0 || offsetFailed > 0) {
              logger.info(
                `Timing offset (${options.offset}ms): ${offsetSuccessful} applied, ${offsetFailed} failed`
              );
            }
          }

          if (isLogs) {
            results.forEach((result) => {
              if (result.success) {
                logger.info(
                  `  ✓ Track ${result.track.trackNumber} (${result.track.language}) → ${result.outputFile}`
                );
                if (result.offsetApplied) {
                  logger.info(
                    `    ✓ Timing offset applied: ${options.offset}ms`
                  );
                } else if (result.offsetError) {
                  logger.info(
                    `    ✗ Timing offset failed: ${result.offsetError}`
                  );
                }
                if (result.translationResult) {
                  logger.info(
                    `    ✓ Translation → ${require('path').basename(
                      result.translationResult.outputPath
                    )}`
                  );
                } else if (result.translationError) {
                  logger.info(
                    `    ✗ Translation failed: ${result.translationError}`
                  );
                }
              } else {
                logger.info(
                  `  ✗ Track ${result.track.trackNumber}: ${result.error}`
                );
              }
            });
          }
        } else {
          logger.header('Single Subtitle Track Extraction');
          logger.info(`File: ${videoFile}`);

          if (subtitleTrack !== null) {
            logger.info(`Track: ${subtitleTrack}`);
            if (options.subtitleSuffix) {
              logger.info(`Subtitle suffix: ${options.subtitleSuffix}`);
            }
          } else {
            logger.info('Track: Auto-detect Spanish Latino');
          }
          if (translationConfig) {
            logger.info('Translation: Enabled');
          }
          if (options.offset) {
            logger.info(
              `Timing offset: ${options.offset}ms (${
                options.offset >= 0 ? 'forward' : 'backward'
              })`
            );
          }
          logger.separator();

          let targetTrack = subtitleTrack;
          if (targetTrack === null) {
            const tracks = await subtitleService.listSubtitleTracks(videoFile);
            targetTrack = subtitleService.findDefaultSpanishTrack(tracks);
            if (targetTrack === -1) {
              targetTrack = 0;
            }
            logger.info(`Auto-detected track: ${targetTrack}`);
          }

          const tracks = await subtitleService.listSubtitleTracks(videoFile);
          const spanishTracks = tracks.filter(
            (t) => t.language === 'spa' || t.language === 'es'
          );
          const nameWithoutExt = require('path').parse(videoFile).name;

          let outputFile;
          if (targetTrack < tracks.length) {
            const track = tracks[targetTrack];
            logger.info(`Track: ${JSON.stringify(track)}`);
            const langSuffix = subtitleService.getLanguageSuffix(
              track,
              spanishTracks.length === 1,
              options.subtitleSuffix
            );
            outputFile = langSuffix
              ? `${nameWithoutExt}_${langSuffix}.ass`
              : `${nameWithoutExt}.ass`;
          } else {
            outputFile = `${nameWithoutExt}.ass`;
          }

          const spinner = ora('Extracting subtitle track...').start();

          let result;
          if (translationConfig) {
            const onProgress = (progress) => {
              if (progress.type === 'translation_start') {
                spinner.text = `Translating ${require('path').basename(
                  progress.file
                )}...`;
              } else if (progress.type === 'translation_complete') {
                spinner.text = 'Extraction completed';
              }
            };

            result = await subtitleService.extractAndTranslateSubtitles(
              videoFile,
              outputFile,
              targetTrack,
              folderPath,
              translationConfig,
              onProgress
            );
          } else {
            result = await subtitleService.extractSubtitles(
              videoFile,
              outputFile,
              targetTrack,
              folderPath
            );
          }

          if (result.success) {
            if (options.offset) {
              spinner.text = 'Applying timing offset...';
              const offsetResult = await applyOffsetToFile(
                result.outputPath,
                options.offset
              );

              if (offsetResult.success) {
                spinner.succeed(
                  `Subtitle extracted with timing offset applied: ${result.outputPath}`
                );
                if (offsetResult.offsetApplied) {
                  logger.info(`Timing adjusted by ${options.offset}ms`);
                }
              } else {
                spinner.succeed(`Subtitle extracted to: ${result.outputPath}`);
                logger.warning(
                  `Failed to apply timing offset: ${offsetResult.error}`
                );
              }
            } else {
              spinner.succeed(`Subtitle extracted to: ${result.outputPath}`);
            }

            if (result.translationResult) {
              logger.success(
                `Translation created: ${result.translationResult.outputPath}`
              );
            } else if (result.translationError) {
              logger.warning(`Translation failed: ${result.translationError}`);
            }
          } else {
            spinner.fail(`Extraction failed: ${result.error}`);
            process.exit(1);
          }
        }
      } else if (inputType.type === 'folder') {
        const targetDir = inputType.value || folderPath;

        logger.header(
          `${
            options.subFolders ? 'Directory Tree' : 'Folder-based'
          } Subtitle Extraction`
        );
        logger.info(
          `Directory: ${targetDir === '.' ? 'Current directory' : targetDir}`
        );
        if (options.subFolders) {
          logger.info('Including subfolders: Yes');
        }

        if (options.all) {
          logger.info('Mode: Extract all subtitle tracks');
        } else if (subtitleTrack !== null) {
          logger.info(`Subtitle track: ${subtitleTrack}`);
        } else {
          logger.info('Subtitle track: Auto-detect Spanish Latino');
        }
        if (translationConfig) {
          logger.info('Translation: Enabled');
        }
        if (options.offset) {
          logger.info(
            `Timing offset: ${options.offset}ms (${
              options.offset >= 0 ? 'forward' : 'backward'
            })`
          );
        }
        logger.separator();

        const spinner = ora('Finding local video files...').start();
        const localFiles = await subtitleService.getLocalVideoFiles(
          targetDir,
          options.subFolders
        );
        spinner.succeed(`Found ${localFiles.length} local video files`);

        if (localFiles.length === 0) {
          logger.warning(`No video files found in directory: ${targetDir}`);
          return;
        }

        logger.info('Extracting subtitles...');
        let results;

        if (options.all) {
          if (translationConfig) {
            const onProgress = (progress) => {
              if (progress.type === 'translation_start') {
                spinner.text = `Translating ${require('path').basename(
                  progress.file
                )}...`;
              } else if (progress.type === 'translation_complete') {
                spinner.text = 'Extracting subtitles...';
              }
            };
            results = await subtitleService.extractAllSubtitlesFromFolder(
              targetDir,
              options.subFolders
            );
          } else {
            results = await subtitleService.extractAllSubtitlesFromFolder(
              targetDir,
              options.subFolders
            );
          }
        } else {
          if (translationConfig) {
            const onProgress = (progress) => {
              if (progress.type === 'translation_start') {
                spinner.text = `Translating ${require('path').basename(
                  progress.file
                )}...`;
              } else if (progress.type === 'translation_complete') {
                spinner.text = 'Extracting subtitles...';
              }
            };
            results =
              await subtitleService.extractAllLocalSubtitlesWithTranslation(
                subtitleTrack,
                targetDir,
                translationConfig,
                onProgress,
                options.subFolders
              );
          } else {
            results = await subtitleService.extractAllLocalSubtitles(
              subtitleTrack,
              targetDir,
              options.subFolders
            );
          }
        }

        if (options.offset) {
          const offsetSpinner = ora(
            'Applying timing offset to extracted files...'
          ).start();
          let offsetSuccessful = 0;
          let offsetFailed = 0;

          for (const result of results) {
            if (result.success && result.outputFile) {
              const outputPath = require('path').join(
                targetDir,
                result.outputFile
              );
              const offsetResult = await applyOffsetToFile(
                outputPath,
                options.offset
              );
              if (offsetResult.success) {
                offsetSuccessful++;
                result.offsetApplied = true;
              } else {
                offsetFailed++;
                result.offsetError = offsetResult.error;
              }
            }
          }

          if (offsetFailed === 0) {
            offsetSpinner.succeed(
              `Timing offset applied to ${offsetSuccessful} files`
            );
          } else {
            offsetSpinner.warn(
              `Timing offset: ${offsetSuccessful} successful, ${offsetFailed} failed`
            );
          }
        }

        const successful = results.filter((r) => r.success).length;
        const failed = results.filter((r) => !r.success).length;

        logger.separator();
        logger.success(
          `Extraction completed: ${successful} successful, ${failed} failed`
        );

        if (options.offset) {
          const offsetSuccessful = results.filter(
            (r) => r.success && r.offsetApplied
          ).length;
          const offsetFailed = results.filter(
            (r) => r.success && r.offsetError
          ).length;
          if (offsetSuccessful > 0 || offsetFailed > 0) {
            logger.info(
              `Timing offset (${options.offset}ms): ${offsetSuccessful} applied, ${offsetFailed} failed`
            );
          }
        }

        if (isLogs) {
          results.forEach((result) => {
            if (result.success) {
              if (result.track) {
                logger.info(
                  `  ✓ ${result.filename} Track ${result.track.trackNumber} → ${result.outputFile}`
                );
                if (result.translationResult) {
                  logger.info(
                    `    ✓ Translation → ${require('path').basename(
                      result.translationResult.outputPath
                    )}`
                  );
                } else if (result.translationError) {
                  logger.info(
                    `    ✗ Translation failed: ${result.translationError}`
                  );
                }
              } else if (result.trackUsed !== undefined) {
                const trackInfo = result.trackInfo
                  ? ` (${result.trackInfo.language}${
                      result.trackInfo.languageDetail
                        ? ' ' + result.trackInfo.languageDetail
                        : ''
                    })`
                  : '';
                logger.info(
                  `  ✓ ${result.filename} Track ${result.trackUsed}${trackInfo} → ${result.outputFile}`
                );
                if (result.translationResult) {
                  logger.info(
                    `    ✓ Translation → ${require('path').basename(
                      result.translationResult.outputPath
                    )}`
                  );
                } else if (result.translationError) {
                  logger.info(
                    `    ✗ Translation failed: ${result.translationError}`
                  );
                }
              } else {
                logger.info(`  ✓ ${result.filename} → ${result.outputFile}`);
                if (result.translationResult) {
                  logger.info(
                    `    ✓ Translation → ${require('path').basename(
                      result.translationResult.outputPath
                    )}`
                  );
                } else if (result.translationError) {
                  logger.info(
                    `    ✗ Translation failed: ${result.translationError}`
                  );
                }
              }
            } else {
              logger.info(`  ✗ ${result.filename}: ${result.error}`);
            }
          });
        }
      } else if (inputType.type === 'playlist') {
        const playlistId = inputType.value;

        logger.header('Playlist-based Subtitle Extraction');
        logger.info(`Playlist ID: ${playlistId}`);
        logger.info(
          `Directory: ${folderPath === '.' ? 'Current directory' : folderPath}`
        );
        logger.info(`Subtitle track: ${subtitleTrack}`);
        if (options.offset) {
          logger.info(
            `Timing offset: ${options.offset}ms (${
              options.offset >= 0 ? 'forward' : 'backward'
            })`
          );
        }

        if (isLogs) {
          logger.info(`Logs: Detailed logging is active`);
        }

        logger.separator();

        const config = new ConfigManager();
        const peertubeConfig = config.getPeerTubeConfig();

        const spinner = ora('Fetching playlist videos...').start();
        try {
          const { matches, results } =
            await subtitleService.extractFromPlaylist(
              playlistId,
              subtitleTrack,
              peertubeConfig.apiUrl,
              folderPath,
              options.offset || 0,
              options.subFolders
            );
          spinner.succeed(`Found ${matches.length} matches`);

          logger.info('Matches found:');
          matches.forEach((match, index) => {
            logger.info(
              `${index + 1}. ${match.localFile} ↔ ${
                match.peertubeVideo.video.name
              }`,
              1
            );
          });

          logger.separator();
          const successful = results.filter((r) => r.success).length;
          const failed = results.filter((r) => !r.success).length;

          logger.success(
            `Extraction completed: ${successful} successful, ${failed} failed`
          );

          if (options.offset) {
            const offsetSuccessful = results.filter(
              (r) => r.success && r.offsetApplied
            ).length;
            const offsetFailed = results.filter(
              (r) => r.success && r.offsetError
            ).length;
            if (offsetSuccessful > 0 || offsetFailed > 0) {
              logger.info(
                `Timing offset (${options.offset}ms): ${offsetSuccessful} applied, ${offsetFailed} failed`
              );
            }
          }

          if (isLogs) {
            logger.info('Detailed extraction results:');
            results.forEach((result) => {
              if (result.success) {
                logger.info(
                  `  ✓ ${result.match.localFile} → ${result.outputFile}`
                );
                if (result.offsetApplied) {
                  logger.info(
                    `    ✓ Timing offset applied: ${options.offset}ms`
                  );
                } else if (result.offsetError) {
                  logger.info(
                    `    ✗ Timing offset failed: ${result.offsetError}`
                  );
                }
              } else {
                logger.info(`  ✗ ${result.match.localFile}: ${result.error}`);
              }
            });
          }
        } catch (error) {
          spinner.fail(`Failed to process playlist: ${error.message}`);
          process.exit(1);
        }
      } else {
        if (!input) {
          logger.header(
            `${
              options.subFolders ? 'Directory Tree' : 'Current Directory'
            } Subtitle Extraction`
          );
          logger.info(
            `Directory: ${
              folderPath === '.' ? 'Current directory' : folderPath
            }`
          );
          if (options.subFolders) {
            logger.info('Including subfolders: Yes');
          }

          if (options.all) {
            logger.info('Mode: Extract all subtitle tracks');
          } else if (subtitleTrack !== null) {
            logger.info(`Subtitle track: ${subtitleTrack}`);
          } else {
            logger.info('Subtitle track: Auto-detect Spanish Latino');
          }
          if (translationConfig) {
            logger.info('Translation: Enabled');
          }
          if (options.offset) {
            logger.info(
              `Timing offset: ${options.offset}ms (${
                options.offset >= 0 ? 'forward' : 'backward'
              })`
            );
          }
          logger.separator();

          const spinner = ora('Finding local video files...').start();
          const localFiles = await subtitleService.getLocalVideoFiles(
            folderPath,
            options.subFolders
          );
          spinner.succeed(`Found ${localFiles.length} local video files`);

          if (localFiles.length === 0) {
            logger.warning(`No video files found in directory: ${folderPath}`);
            return;
          }

          logger.info('Extracting subtitles...');
          let results;

          if (options.all) {
            if (translationConfig) {
              const onProgress = (progress) => {
                if (progress.type === 'translation_start') {
                  spinner.text = `Translating ${require('path').basename(
                    progress.file
                  )}...`;
                } else if (progress.type === 'translation_complete') {
                  spinner.text = 'Extracting subtitles...';
                }
              };
              results = await subtitleService.extractAllSubtitlesFromFolder(
                folderPath,
                options.subFolders
              );
            } else {
              results = await subtitleService.extractAllSubtitlesFromFolder(
                folderPath,
                options.subFolders
              );
            }
          } else {
            if (translationConfig) {
              const onProgress = (progress) => {
                if (progress.type === 'translation_start') {
                  spinner.text = `Translating ${require('path').basename(
                    progress.file
                  )}...`;
                } else if (progress.type === 'translation_complete') {
                  spinner.text = 'Extracting subtitles...';
                }
              };
              results =
                await subtitleService.extractAllLocalSubtitlesWithTranslation(
                  subtitleTrack,
                  folderPath,
                  translationConfig,
                  onProgress,
                  options.subFolders
                );
            } else {
              results = await subtitleService.extractAllLocalSubtitles(
                subtitleTrack,
                folderPath,
                options.subFolders
              );
            }
          }

          if (options.offset) {
            const offsetSpinner = ora(
              'Applying timing offset to extracted files...'
            ).start();
            let offsetSuccessful = 0;
            let offsetFailed = 0;

            for (const result of results) {
              if (result.success && result.outputFile) {
                const outputPath = require('path').join(
                  folderPath,
                  result.outputFile
                );
                const offsetResult = await applyOffsetToFile(
                  outputPath,
                  options.offset
                );
                if (offsetResult.success) {
                  offsetSuccessful++;
                  result.offsetApplied = true;
                } else {
                  offsetFailed++;
                  result.offsetError = offsetResult.error;
                }
              }
            }

            if (offsetFailed === 0) {
              offsetSpinner.succeed(
                `Timing offset applied to ${offsetSuccessful} files`
              );
            } else {
              offsetSpinner.warn(
                `Timing offset: ${offsetSuccessful} successful, ${offsetFailed} failed`
              );
            }
          }

          const successful = results.filter((r) => r.success).length;
          const failed = results.filter((r) => !r.success).length;

          logger.separator();
          logger.success(
            `Extraction completed: ${successful} successful, ${failed} failed`
          );

          if (options.offset) {
            const offsetSuccessful = results.filter(
              (r) => r.success && r.offsetApplied
            ).length;
            const offsetFailed = results.filter(
              (r) => r.success && r.offsetError
            ).length;
            if (offsetSuccessful > 0 || offsetFailed > 0) {
              logger.info(
                `Timing offset (${options.offset}ms): ${offsetSuccessful} applied, ${offsetFailed} failed`
              );
            }
          }

          if (isLogs) {
            results.forEach((result) => {
              if (result.success) {
                if (result.track) {
                  logger.info(
                    `  ✓ ${result.filename} Track ${result.track.trackNumber} → ${result.outputFile}`
                  );
                  if (result.offsetApplied) {
                    logger.info(
                      `    ✓ Timing offset applied: ${options.offset}ms`
                    );
                  } else if (result.offsetError) {
                    logger.info(
                      `    ✗ Timing offset failed: ${result.offsetError}`
                    );
                  }
                  if (result.translationResult) {
                    logger.info(
                      `    ✓ Translation → ${require('path').basename(
                        result.translationResult.outputPath
                      )}`
                    );
                  } else if (result.translationError) {
                    logger.info(
                      `    ✗ Translation failed: ${result.translationError}`
                    );
                  }
                } else if (result.trackUsed !== undefined) {
                  const trackInfo = result.trackInfo
                    ? ` (${result.trackInfo.language}${
                        result.trackInfo.languageDetail
                          ? ' ' + result.trackInfo.languageDetail
                          : ''
                      })`
                    : '';
                  logger.info(
                    `  ✓ ${result.filename} Track ${result.trackUsed}${trackInfo} → ${result.outputFile}`
                  );
                  if (result.offsetApplied) {
                    logger.info(
                      `    ✓ Timing offset applied: ${options.offset}ms`
                    );
                  } else if (result.offsetError) {
                    logger.info(
                      `    ✗ Timing offset failed: ${result.offsetError}`
                    );
                  }
                  if (result.translationResult) {
                    logger.info(
                      `    ✓ Translation → ${require('path').basename(
                        result.translationResult.outputPath
                      )}`
                    );
                  } else if (result.translationError) {
                    logger.info(
                      `    ✗ Translation failed: ${result.translationError}`
                    );
                  }
                } else {
                  logger.info(`  ✓ ${result.filename} → ${result.outputFile}`);
                  if (result.offsetApplied) {
                    logger.info(
                      `    ✓ Timing offset applied: ${options.offset}ms`
                    );
                  } else if (result.offsetError) {
                    logger.info(
                      `    ✗ Timing offset failed: ${result.offsetError}`
                    );
                  }
                  if (result.translationResult) {
                    logger.info(
                      `    ✓ Translation → ${require('path').basename(
                        result.translationResult.outputPath
                      )}`
                    );
                  } else if (result.translationError) {
                    logger.info(
                      `    ✗ Translation failed: ${result.translationError}`
                    );
                  }
                }
              } else {
                logger.info(`  ✗ ${result.filename}: ${result.error}`);
              }
            });
          }
        } else {
          logger.error(`Unable to determine input type: "${input}"`);
          logger.info('Input can be:');
          logger.info('  - A video file path (e.g., "./video.mkv")');
          logger.info('  - A directory path (e.g., "./videos/")');
          logger.info(
            '  - A PeerTube playlist ID (e.g., "123" or "tgjYS5VH2vJFkp3fCVcmP5")'
          );
          process.exit(1);
        }
      }
    } catch (error) {
      console.log(error);
      logger.error(`Subtitle extraction failed: ${error.message}`);
      process.exit(1);
    }
  });

subtitlesCommand
  .command('translate')
  .description('Translate subtitle files using AI')
  .argument(
    '[file]',
    'subtitle file path (.ass format) - if not provided, translates all .ass files in current directory'
  )
  .option(
    '--output <path>',
    'output file path (default: adds _translated suffix)'
  )
  .option('--prompt <path>', 'custom system prompt file path')
  .option(
    '--max-dialogs <number>',
    'maximum number of dialogs to translate',
    parseInt
  )
  .option('--logs', 'detailed output')
  .option('--quiet, -q', 'quiet mode')
  .action(async (file, options) => {
    const isLogs = options.logs || false;
    const logger = new Logger({
      verbose: false,
      quiet: options.quiet || false,
    });

    try {
      const config = new ConfigManager();
      const translationConfig = config.getTranslationConfig();

      if (!translationConfig.apiKey) {
        logger.error(
          'Claude API key not configured. Please set CLAUDE_API_KEY in your config or environment variables.'
        );
        logger.info('Run "anitorrent config setup" to set up configuration');
        process.exit(1);
      }

      const fs = require('fs').promises;
      const path = require('path');

      if (file) {
        const pathValidation = await Validators.validateFilePath(file);
        const subtitleFile = pathValidation.resolvedPath;

        try {
          const stats = await fs.stat(subtitleFile);
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

        if (!subtitleFile.toLowerCase().endsWith('.ass')) {
          logger.error(
            'Only .ass subtitle files are supported for translation'
          );
          process.exit(1);
        }

        logger.header('AI Subtitle Translation');
        logger.info(`File: ${subtitleFile}`);
        if (options.output) {
          logger.info(`Output: ${options.output}`);
        }
        if (options.prompt) {
          logger.info(`Custom prompt: ${options.prompt}`);
        }
        if (options.maxDialogs) {
          logger.info(`Max dialogs: ${options.maxDialogs}`);
        }
        logger.separator();

        const translationService = new TranslationService(translationConfig);

        let currentGroup = 0;
        let totalGroups = 0;
        let spinner = ora('Initializing translation...').start();

        const onProgress = (progress) => {
          switch (progress.type) {
            case 'start':
              totalGroups = progress.totalGroups;
              spinner.succeed(
                `Found ${progress.totalDialogs} dialog lines in ${totalGroups} groups`
              );
              spinner = ora(`Translating group 1/${totalGroups}...`).start();
              break;
            case 'progress':
              currentGroup = progress.currentGroup;
              spinner.text = `Translating group ${currentGroup}/${totalGroups}...`;
              break;
            case 'error':
              if (!logger.quiet) {
                logger.warning(`Translation warning: ${progress.message}`);
              }
              break;
            case 'complete':
              spinner.succeed(
                `Translation completed: ${progress.translatedCount} lines translated`
              );
              break;
          }
        };

        const translationOptions = {
          outputPath: options.output,
          customPromptPath: options.prompt,
          maxDialogs: options.maxDialogs,
          onProgress,
        };

        const result = await translationService.translateSubtitles(
          subtitleFile,
          translationOptions
        );

        if (result.success) {
          logger.separator();
          logger.success(`Translation completed successfully!`);
          logger.info(`Original file: ${subtitleFile}`);
          logger.info(`Translated file: ${result.outputPath}`);
          logger.info(
            `Lines translated: ${result.translatedCount}/${result.originalCount}`
          );
        } else {
          logger.error('Translation failed');
          process.exit(1);
        }
      } else {
        const currentDir = process.cwd();

        logger.header('Batch AI Subtitle Translation');
        logger.info(`Directory: ${currentDir}`);
        if (options.prompt) {
          logger.info(`Custom prompt: ${options.prompt}`);
        }
        if (options.maxDialogs) {
          logger.info(`Max dialogs: ${options.maxDialogs}`);
        }
        logger.separator();

        const spinner = ora('Finding .ass subtitle files...').start();

        try {
          const files = await fs.readdir(currentDir);
          const allAssFiles = files.filter((file) =>
            file.toLowerCase().endsWith('.ass')
          );

          const assFiles = allAssFiles.filter((file) => {
            const fileName = file.toLowerCase();

            if (fileName.includes('_translated')) {
              return false;
            }

            const baseName = path.parse(file).name;
            const translatedVersion = `${baseName}_translated.ass`;
            if (
              allAssFiles.some(
                (f) => f.toLowerCase() === translatedVersion.toLowerCase()
              )
            ) {
              return false;
            }

            return true;
          });

          spinner.succeed(
            `Found ${assFiles.length} .ass files to translate (${
              allAssFiles.length - assFiles.length
            } files ignored)`
          );

          if (assFiles.length === 0) {
            logger.warning('No .ass subtitle files found in current directory');
            return;
          }

          logger.info('Files to translate:');
          assFiles.forEach((file, index) => {
            logger.info(`${index + 1}. ${file}`, 1);
          });
          logger.separator();

          const translationService = new TranslationService(translationConfig);
          const results = [];

          for (let i = 0; i < assFiles.length; i++) {
            const assFile = assFiles[i];
            const fullPath = path.join(currentDir, assFile);

            logger.info(`Translating ${i + 1}/${assFiles.length}: ${assFile}`);

            let currentGroup = 0;
            let totalGroups = 0;
            let fileSpinner = ora('Initializing translation...').start();

            const onProgress = (progress) => {
              switch (progress.type) {
                case 'start':
                  totalGroups = progress.totalGroups;
                  fileSpinner.succeed(
                    `Found ${progress.totalDialogs} dialog lines in ${totalGroups} groups`
                  );
                  fileSpinner = ora(
                    `Translating group 1/${totalGroups}...`
                  ).start();
                  break;
                case 'progress':
                  currentGroup = progress.currentGroup;
                  fileSpinner.text = `Translating group ${currentGroup}/${totalGroups}...`;
                  break;
                case 'error':
                  if (!logger.quiet) {
                    logger.warning(`Translation warning: ${progress.message}`);
                  }
                  break;
                case 'complete':
                  fileSpinner.succeed(
                    `Translation completed: ${progress.translatedCount} lines translated`
                  );
                  break;
              }
            };

            const translationOptions = {
              customPromptPath: options.prompt,
              maxDialogs: options.maxDialogs,
              onProgress,
            };

            try {
              const result = await translationService.translateSubtitles(
                fullPath,
                translationOptions
              );

              if (result.success) {
                logger.success(
                  `✓ ${assFile} → ${path.basename(result.outputPath)}`
                );
                results.push({ file: assFile, success: true, result });
              } else {
                logger.error(`✗ ${assFile}: Translation failed`);
                results.push({
                  file: assFile,
                  success: false,
                  error: 'Translation failed',
                });
              }
            } catch (error) {
              fileSpinner.fail(`Translation failed: ${error.message}`);
              logger.error(`✗ ${assFile}: ${error.message}`);
              results.push({
                file: assFile,
                success: false,
                error: error.message,
              });
            }

            if (i < assFiles.length - 1) {
              logger.separator();
            }
          }

          logger.separator();
          const successful = results.filter((r) => r.success).length;
          const failed = results.filter((r) => !r.success).length;

          logger.success(
            `Batch translation completed: ${successful} successful, ${failed} failed`
          );

          if (isLogs && failed > 0) {
            logger.info('Failed translations:');
            results
              .filter((r) => !r.success)
              .forEach((result) => {
                logger.info(`  ✗ ${result.file}: ${result.error}`);
              });
          }
        } catch (error) {
          spinner.fail(`Failed to read directory: ${error.message}`);
          process.exit(1);
        }
      }
    } catch (error) {
      logger.error(`Translation failed: ${error.message}`);
      process.exit(1);
    }
  });

subtitlesCommand
  .command('rename')
  .description('Rename subtitle files with various naming patterns')
  .argument(
    '[pattern]',
    'renaming pattern, directory path, or PeerTube playlist ID (default: current directory)'
  )
  .option('--include-translated', 'also rename files with _translated suffix')
  .option(
    '--anitomy',
    'use anitomy parsing to generate anime-style names (Title_S01E01)'
  )
  .option('--prefix <text>', 'add prefix to all filenames')
  .option('--suffix <text>', 'add suffix to all filenames (before extension)')
  .option(
    '--replace <from,to>',
    'replace text in filenames (format: "old,new")'
  )
  .option(
    '--playlist',
    'treat pattern as PeerTube playlist ID and rename using shortUUID'
  )
  .option(
    '--folder <path>',
    'folder path to search for videos when using playlist mode (default: current directory)'
  )
  .option('--sub-folders', 'search for subtitle files in subfolders as well')
  .option(
    '--auto-translate',
    'automatically translate selected Latino subtitles'
  )
  .option('--dry-run', 'show what would be renamed without actually renaming')
  .option('--logs', 'detailed output')
  .option('--quiet, -q', 'quiet mode')
  .action(async (pattern, options) => {
    const isLogs = options.logs || false;
    const logger = new Logger({
      verbose: false,
      quiet: options.quiet || false,
    });

    const scanSubtitlesRecursively = async (dir, includeTranslated = false) => {
      const foundFiles = [];

      async function scanDir(currentDir, relativePath = '') {
        try {
          const entries = await fs.readdir(currentDir, { withFileTypes: true });
          const subtitleFiles = [];

          for (const entry of entries) {
            const fullPath = path.join(currentDir, entry.name);
            const relativeFilePath = path.join(relativePath, entry.name);

            if (entry.isFile()) {
              const ext = path.extname(entry.name).toLowerCase();
              if (['.ass', '.srt', '.vtt', '.sub'].includes(ext)) {
                if (
                  includeTranslated ||
                  !entry.name.toLowerCase().includes('_translated')
                ) {
                  subtitleFiles.push({
                    filename: entry.name,
                    fullPath: fullPath,
                    relativePath: relativeFilePath,
                    directory: relativePath || '.',
                  });
                }
              }
            } else if (entry.isDirectory() && options.subFolders) {
              await scanDir(fullPath, relativeFilePath);
            }
          }

          if (subtitleFiles.length > 0) {
            const selectedFile = selectBestLatinSubtitle(subtitleFiles);
            if (selectedFile) {
              foundFiles.push(selectedFile);
            }
          }
        } catch (error) {
          // Skip directories that can't be read
        }
      }

      await scanDir(dir);
      return foundFiles;
    };

    const selectBestLatinSubtitle = (subtitleFiles) => {
      if (subtitleFiles.length === 0) return null;

      if (subtitleFiles.length === 1) {
        return subtitleFiles[0];
      }

      const es419Files = subtitleFiles.filter(
        (file) =>
          file.filename.toLowerCase().includes('_es-419') ||
          file.filename.toLowerCase().includes('_es_419')
      );

      if (es419Files.length > 0) {
        return es419Files[0];
      }

      const esFiles = subtitleFiles.filter(
        (file) =>
          file.filename.toLowerCase().includes('_es') &&
          !file.filename.toLowerCase().includes('_es-') &&
          !file.filename.toLowerCase().includes('_es_')
      );

      if (esFiles.length > 0) {
        return esFiles[0];
      }

      const latinFiles = subtitleFiles.filter(
        (file) =>
          file.filename.toLowerCase().includes('_lat') ||
          file.filename.toLowerCase().includes('_latino')
      );

      if (latinFiles.length > 0) {
        return latinFiles[0];
      }

      return subtitleFiles[0];
    };

    try {
      const fs = require('fs').promises;
      const path = require('path');

      if (options.playlist) {
        if (!pattern) {
          logger.error('Playlist ID is required when using --playlist option');
          process.exit(1);
        }

        const playlistId = pattern.trim();
        if (!playlistId || playlistId.length === 0) {
          logger.error('Playlist ID cannot be empty');
          process.exit(1);
        }

        let folderPath = '.';
        if (options.folder) {
          const pathValidation = await Validators.validateFilePath(
            options.folder
          );
          folderPath = pathValidation.resolvedPath;

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

        logger.header('Playlist-based Subtitle Renaming');
        logger.info(`Playlist ID: ${playlistId}`);
        logger.info(
          `Directory: ${folderPath === '.' ? 'Current directory' : folderPath}`
        );
        if (options.includeTranslated) {
          logger.info('Mode: Include translated files');
        } else {
          logger.info('Mode: Exclude translated files');
        }
        if (options.dryRun) {
          logger.info('Mode: Dry run (preview only)');
        }
        logger.separator();

        const config = new ConfigManager();
        const peertubeConfig = config.getPeerTubeConfig();
        const subtitleService = new SubtitleService();

        const spinner = ora('Fetching playlist videos...').start();

        try {
          const peertubeVideos = await subtitleService.fetchPlaylistVideos(
            playlistId,
            peertubeConfig.apiUrl
          );

          const parsedPeertubeVideos = [];

          for (let i = 0; i < peertubeVideos.length; i++) {
            const video = peertubeVideos[i];

            try {
              const videoName = video.video?.name;

              if (!videoName || typeof videoName !== 'string') {
                parsedPeertubeVideos.push({
                  original: video,
                  parsed: null,
                });
                continue;
              }

              const parsed = await subtitleService.parseVideoName(videoName);

              parsedPeertubeVideos.push({
                original: video,
                parsed,
              });
            } catch (error) {
              parsedPeertubeVideos.push({
                original: video,
                parsed: null,
              });
            }
          }

          const subtitleSpinner = ora('Finding subtitle files...').start();

          const files = await fs.readdir(folderPath);
          const allSubtitleFiles = files.filter((file) => {
            const ext = path.extname(file).toLowerCase();
            return ['.ass', '.srt', '.vtt', '.sub'].includes(ext);
          });

          let subtitleFiles = allSubtitleFiles;

          if (!options.includeTranslated) {
            subtitleFiles = allSubtitleFiles.filter((file) => {
              return !file.toLowerCase().includes('_translated');
            });
          }

          subtitleSpinner.succeed(
            `Found ${subtitleFiles.length} subtitle files${
              !options.includeTranslated
                ? ` (${
                    allSubtitleFiles.length - subtitleFiles.length
                  } translated files excluded)`
                : ''
            }`
          );

          if (subtitleFiles.length === 0) {
            logger.warning('No subtitle files found to rename');
            return;
          }

          const parsedSubtitleFiles = [];

          for (let i = 0; i < subtitleFiles.length; i++) {
            const subtitleFile = subtitleFiles[i];

            try {
              if (!subtitleFile || typeof subtitleFile !== 'string') {
                continue;
              }

              const subtitleBaseName = path.parse(subtitleFile).name;

              const cleanBaseName = subtitleBaseName
                .replace(/_[a-z]{2,3}$/, '')
                .replace(/_translated$/, '');

              if (!cleanBaseName || cleanBaseName.trim() === '') {
                parsedSubtitleFiles.push({
                  filename: subtitleFile,
                  baseName: subtitleBaseName,
                  cleanBaseName: cleanBaseName,
                  parsed: null,
                });
                continue;
              }

              const parsed = await subtitleService.parseVideoName(
                cleanBaseName
              );

              parsedSubtitleFiles.push({
                filename: subtitleFile,
                baseName: subtitleBaseName,
                cleanBaseName: cleanBaseName,
                parsed,
              });
            } catch (error) {
              parsedSubtitleFiles.push({
                filename: subtitleFile,
                baseName: subtitleFile
                  ? path.parse(subtitleFile).name
                  : 'unknown',
                cleanBaseName: 'unknown',
                parsed: null,
              });
            }
          }

          const matches = [];

          for (const peertubeVideo of parsedPeertubeVideos) {
            const peertubeData = peertubeVideo.parsed;

            if (!peertubeData || !peertubeData.episode_number) {
              continue;
            }

            const targetSeason = peertubeData.anime_season || 1;
            const targetEpisode = peertubeData.episode_number;

            const matchingSubtitle = parsedSubtitleFiles.find(
              (subtitleFile) => {
                const subtitleData = subtitleFile.parsed;
                if (!subtitleData || !subtitleData.episode_number) return false;

                const subtitleSeason = subtitleData.anime_season || 1;
                const subtitleEpisode = subtitleData.episode_number;

                return (
                  subtitleSeason === targetSeason &&
                  subtitleEpisode === targetEpisode
                );
              }
            );

            if (matchingSubtitle) {
              matches.push({
                peertubeVideo: peertubeVideo.original,
                subtitleFile: matchingSubtitle.filename,
                peertubeData,
                subtitleData: matchingSubtitle.parsed,
              });
            }
          }

          spinner.succeed(`Found ${matches.length} subtitle matches`);

          if (matches.length === 0) {
            logger.warning(
              'No matches found between PeerTube playlist and local subtitle files'
            );
            return;
          }

          logger.info('Subtitle matches found:');
          matches.forEach((match, index) => {
            logger.info(
              `${index + 1}. ${match.subtitleFile} ↔ ${
                match.peertubeVideo.video.name
              }`,
              1
            );
          });
          logger.separator();

          const renameOperations = [];

          for (let i = 0; i < matches.length; i++) {
            const match = matches[i];

            const subtitleFile = match.subtitleFile;

            if (!subtitleFile || typeof subtitleFile !== 'string') {
              continue;
            }

            const subtitleBaseName = path.parse(subtitleFile).name;
            const subtitleExt = path.extname(subtitleFile);

            const shortUUID = match.peertubeVideo.video?.shortUUID;

            if (!shortUUID || typeof shortUUID !== 'string') {
              continue;
            }

            let newBaseName = shortUUID;

            const langSuffix = subtitleBaseName.match(
              /_([a-z]{2,3})(?:_translated)?$/
            );

            if (langSuffix) {
              newBaseName += `_${langSuffix[1]}`;
            }

            const newFileName = newBaseName + subtitleExt;

            const oldPath = path.join(folderPath, subtitleFile);
            const newPath = path.join(folderPath, newFileName);

            if (subtitleFile !== newFileName) {
              renameOperations.push({
                oldPath,
                newPath,
                oldName: subtitleFile,
                newName: newFileName,
                match: match,
              });
            }
          }

          if (renameOperations.length === 0) {
            logger.info('No subtitle files need to be renamed');
            return;
          }

          logger.info(`Subtitle files to rename (${renameOperations.length}):`);
          renameOperations.forEach((op, index) => {
            logger.info(`${index + 1}. ${op.oldName} → ${op.newName}`, 1);
            if (isLogs) {
              const videoName = op.match.localFile
                ? path.basename(op.match.localFile)
                : op.match.peertubeVideo.video.name;
              logger.info(
                `     Video: ${videoName} ↔ ${op.match.peertubeVideo.video.name}`
              );
            }
          });

          if (options.dryRun) {
            logger.separator();
            logger.info('Dry run completed - no files were actually renamed');
            return;
          }

          logger.separator();
          const renameSpinner = ora('Renaming subtitle files...').start();

          let successful = 0;
          let failed = 0;
          const errors = [];

          for (const operation of renameOperations) {
            try {
              const newPathExists = await fs
                .access(operation.newPath)
                .then(() => true)
                .catch(() => false);

              if (newPathExists) {
                errors.push(`${operation.oldName}: Target file already exists`);
                failed++;
                continue;
              }

              await fs.rename(operation.oldPath, operation.newPath);
              successful++;

              if (isLogs) {
                logger.info(
                  `    ✓ ${operation.oldName} → ${operation.newName}`
                );
              }
            } catch (error) {
              errors.push(`${operation.oldName}: ${error.message}`);
              failed++;
            }
          }

          if (successful > 0) {
            renameSpinner.succeed(
              `Renaming completed: ${successful} successful, ${failed} failed`
            );
          } else {
            renameSpinner.fail(`Renaming failed: ${failed} errors`);
          }

          if (
            errors.length > 0 &&
            (isLogs || failed === renameOperations.length)
          ) {
            logger.separator();
            logger.info('Errors:');
            errors.forEach((error) => {
              logger.error(`✗ ${error}`, 1);
            });
          }

          if (successful > 0) {
            logger.separator();
            logger.success(
              `Successfully renamed ${successful} subtitle files using playlist shortUUIDs`
            );
          }
        } catch (error) {
          spinner.fail(`Failed to process playlist: ${error.message}`);
          process.exit(1);
        }
      } else {
        let targetDir = process.cwd();
        let customPattern = null;

        if (pattern) {
          try {
            const stats = await fs.stat(pattern);
            if (stats.isDirectory()) {
              targetDir = path.resolve(pattern);
            } else {
              customPattern = pattern;
            }
          } catch (error) {
            customPattern = pattern;
          }
        }

        logger.header(
          `${options.subFolders ? 'Directory Tree' : 'Subtitle File'} Renaming`
        );
        logger.info(`Directory: ${targetDir}`);
        if (options.subFolders) {
          logger.info('Including subfolders: Yes (one subtitle per folder)');
        }
        if (customPattern) {
          logger.info(`Pattern: ${customPattern}`);
        }
        if (options.includeTranslated) {
          logger.info('Mode: Include translated files');
        } else {
          logger.info('Mode: Exclude translated files');
        }
        if (options.anitomy) {
          logger.info('Parsing: Anitomy anime-style naming');
        }
        if (options.autoTranslate) {
          logger.info('Auto-translate: Enabled for selected Latino subtitles');
        }
        if (options.prefix) {
          logger.info(`Prefix: "${options.prefix}"`);
        }
        if (options.suffix) {
          logger.info(`Suffix: "${options.suffix}"`);
        }
        if (options.replace) {
          logger.info(`Replace: "${options.replace}"`);
        }
        if (options.dryRun) {
          logger.info('Mode: Dry run (preview only)');
        }
        logger.separator();

        const spinner = ora('Finding subtitle files...').start();

        let subtitleFiles;

        if (options.subFolders) {
          subtitleFiles = await scanSubtitlesRecursively(
            targetDir,
            options.includeTranslated
          );
        } else {
          const files = await fs.readdir(targetDir);
          const allSubtitleFiles = files.filter((file) => {
            const ext = path.extname(file).toLowerCase();
            return ['.ass', '.srt', '.vtt', '.sub'].includes(ext);
          });

          if (options.includeTranslated) {
            subtitleFiles = allSubtitleFiles.map((file) => ({
              filename: file,
              fullPath: path.join(targetDir, file),
              relativePath: file,
              directory: '.',
            }));
          } else {
            subtitleFiles = allSubtitleFiles
              .filter((file) => !file.toLowerCase().includes('_translated'))
              .map((file) => ({
                filename: file,
                fullPath: path.join(targetDir, file),
                relativePath: file,
                directory: '.',
              }));
          }
        }

        spinner.succeed(
          `Found ${subtitleFiles.length} subtitle files${
            options.subFolders ? ' (one per folder)' : ''
          }`
        );

        if (subtitleFiles.length === 0) {
          logger.warning('No subtitle files found to rename');
          return;
        }

        if (options.subFolders && isLogs) {
          logger.info('Selected subtitle files:');
          subtitleFiles.forEach((fileInfo, index) => {
            logger.info(
              `${index + 1}. ${fileInfo.relativePath} (from ${
                fileInfo.directory
              })`,
              1
            );
          });
          logger.separator();
        }

        const renameOperations = [];
        const translationTasks = [];

        for (const fileInfo of subtitleFiles) {
          const file = fileInfo.filename;
          const fullPath = fileInfo.fullPath;
          const ext = path.extname(file);
          const baseName = path.basename(file, ext);

          let newBaseName = baseName;

          if (options.anitomy) {
            try {
              const anitomyResult = await anitomy(file);

              if (anitomyResult.anime_title && anitomyResult.episode_number) {
                const animeTitle = anitomyResult.anime_title.replace(
                  /\s+/g,
                  '+'
                );
                const seasonNumber = parseInt(anitomyResult.anime_season) || 1;
                const episodeNumber = parseInt(anitomyResult.episode_number);

                const seasonStr =
                  seasonNumber < 10
                    ? `0${seasonNumber}`
                    : seasonNumber.toString();
                const episodeStr =
                  episodeNumber < 10
                    ? `0${episodeNumber}`
                    : episodeNumber.toString();

                newBaseName = `${animeTitle}_S${seasonStr}E${episodeStr}`;

                if (file.toLowerCase().includes('_translated')) {
                  newBaseName += '_translated';
                }
              }
            } catch (error) {
              if (isLogs) {
                logger.info(
                  `  Failed to parse ${file} with anitomy: ${error.message}`
                );
              }
            }
          } else if (customPattern) {
            newBaseName = customPattern;
          }

          if (options.replace) {
            const [from, to] = options.replace.split(',');
            if (from && to !== undefined) {
              newBaseName = newBaseName.replace(new RegExp(from, 'g'), to);
            } else {
              logger.warning(
                `Invalid replace format: "${options.replace}". Use "old,new" format.`
              );
            }
          }

          if (options.prefix) {
            newBaseName = options.prefix + newBaseName;
          }

          if (options.suffix) {
            newBaseName = newBaseName + options.suffix;
          }

          const newFileName = newBaseName + ext;
          const newFullPath = options.subFolders
            ? path.join(path.dirname(fullPath), newFileName)
            : path.join(targetDir, newFileName);

          if (file !== newFileName) {
            renameOperations.push({
              oldPath: fullPath,
              newPath: newFullPath,
              oldName: file,
              newName: newFileName,
              directory: fileInfo.directory,
              fileInfo: fileInfo,
            });
          }

          if (
            options.autoTranslate &&
            ext.toLowerCase() === '.ass' &&
            !file.toLowerCase().includes('_translated')
          ) {
            const isLatinSubtitle =
              file.toLowerCase().includes('_es-419') ||
              file.toLowerCase().includes('_es_419') ||
              file.toLowerCase().includes('_es') ||
              file.toLowerCase().includes('_lat');

            if (isLatinSubtitle) {
              const translatedName = newBaseName + '_translated' + ext;
              const translatedPath = options.subFolders
                ? path.join(path.dirname(fullPath), translatedName)
                : path.join(targetDir, translatedName);

              translationTasks.push({
                sourceFile: newFullPath,
                targetFile: translatedPath,
                sourceName: newFileName,
                targetName: translatedName,
                directory: fileInfo.directory,
              });
            }
          }
        }

        if (renameOperations.length === 0 && translationTasks.length === 0) {
          logger.info('No files need to be renamed or translated');
          return;
        }

        if (renameOperations.length > 0) {
          logger.info(`Files to rename (${renameOperations.length}):`);
          renameOperations.forEach((op, index) => {
            logger.info(`${index + 1}. ${op.oldName} → ${op.newName}`, 1);
            if (options.subFolders && op.directory !== '.') {
              logger.info(`     Directory: ${op.directory}`, 2);
            }
          });
        }

        if (translationTasks.length > 0) {
          logger.separator();
          logger.info(`Files to translate (${translationTasks.length}):`);
          translationTasks.forEach((task, index) => {
            logger.info(
              `${index + 1}. ${task.sourceName} → ${task.targetName}`,
              1
            );
            if (options.subFolders && task.directory !== '.') {
              logger.info(`     Directory: ${task.directory}`, 2);
            }
          });
        }

        if (options.dryRun) {
          logger.separator();
          logger.info(
            'Dry run completed - no files were actually renamed or translated'
          );
          return;
        }

        logger.separator();
        const renameSpinner = ora('Renaming files...').start();

        let successful = 0;
        let failed = 0;
        const errors = [];

        for (const operation of renameOperations) {
          try {
            const newPathExists = await fs
              .access(operation.newPath)
              .then(() => true)
              .catch(() => false);

            if (newPathExists) {
              errors.push(`${operation.oldName}: Target file already exists`);
              failed++;
              continue;
            }

            await fs.rename(operation.oldPath, operation.newPath);
            successful++;

            if (isLogs) {
              logger.info(`    ✓ ${operation.oldName} → ${operation.newName}`);
            }
          } catch (error) {
            errors.push(`${operation.oldName}: ${error.message}`);
            failed++;
          }
        }

        if (successful > 0) {
          renameSpinner.succeed(
            `Renaming completed: ${successful} successful, ${failed} failed`
          );
        } else {
          renameSpinner.fail(`Renaming failed: ${failed} errors`);
        }

        if (
          errors.length > 0 &&
          (isLogs || failed === renameOperations.length)
        ) {
          logger.separator();
          logger.info('Errors:');
          errors.forEach((error) => {
            logger.error(`✗ ${error}`, 1);
          });
        }

        if (successful > 0) {
          logger.separator();
          logger.success(`Successfully renamed ${successful} subtitle files`);
        }

        if (translationTasks.length > 0 && !options.dryRun) {
          logger.separator();
          logger.step('🌐', 'Auto-translating Latino subtitles');

          const config = new ConfigManager();
          const translationConfig = config.getTranslationConfig();

          if (!translationConfig.apiKey) {
            logger.warning(
              'Claude API key not configured. Skipping auto-translation.'
            );
            logger.info(
              'Run "anitorrent config setup" to set up translation configuration'
            );
          } else {
            const TranslationService = require('../services/translation-service');
            const translationService = new TranslationService(
              translationConfig
            );

            let translationSuccessful = 0;
            let translationFailed = 0;
            const translationErrors = [];

            for (let i = 0; i < translationTasks.length; i++) {
              const task = translationTasks[i];
              const currentTask = i + 1;
              const totalTasks = translationTasks.length;

              logger.info(
                `Translating ${currentTask}/${totalTasks}: ${task.sourceName}`
              );

              try {
                const sourceExists = await fs
                  .access(task.sourceFile)
                  .then(() => true)
                  .catch(() => false);

                if (!sourceExists) {
                  translationErrors.push(
                    `${task.sourceName}: Source file not found after rename`
                  );
                  translationFailed++;
                  continue;
                }

                const targetExists = await fs
                  .access(task.targetFile)
                  .then(() => true)
                  .catch(() => false);

                if (targetExists) {
                  translationErrors.push(
                    `${task.sourceName}: Translation file already exists`
                  );
                  translationFailed++;
                  continue;
                }

                let currentGroup = 0;
                let totalGroups = 0;
                let translationSpinner = ora(
                  'Initializing translation...'
                ).start();

                const onProgress = (progress) => {
                  switch (progress.type) {
                    case 'start':
                      totalGroups = progress.totalGroups;
                      translationSpinner.succeed(
                        `Found ${progress.totalDialogs} dialog lines in ${totalGroups} groups`
                      );
                      translationSpinner = ora(
                        `Translating group 1/${totalGroups}...`
                      ).start();
                      break;
                    case 'progress':
                      currentGroup = progress.currentGroup;
                      translationSpinner.text = `Translating group ${currentGroup}/${totalGroups}...`;
                      break;
                    case 'error':
                      if (!logger.quiet) {
                        logger.warning(
                          `Translation warning: ${progress.message}`
                        );
                      }
                      break;
                    case 'complete':
                      translationSpinner.succeed(
                        `Translation completed: ${progress.translatedCount} lines translated`
                      );
                      break;
                  }
                };

                const translationOptions = {
                  outputPath: task.targetFile,
                  onProgress,
                };

                const result = await translationService.translateSubtitles(
                  task.sourceFile,
                  translationOptions
                );

                if (result.success) {
                  translationSuccessful++;
                  logger.success(`✓ ${task.sourceName} → ${task.targetName}`);
                } else {
                  translationFailed++;
                  translationErrors.push(
                    `${task.sourceName}: Translation failed`
                  );
                  logger.error(`✗ ${task.sourceName}: Translation failed`);
                }
              } catch (error) {
                translationFailed++;
                translationErrors.push(`${task.sourceName}: ${error.message}`);
                logger.error(`✗ ${task.sourceName}: ${error.message}`);
              }

              if (i < translationTasks.length - 1) {
                logger.separator();
              }
            }

            logger.separator();
            if (translationSuccessful > 0) {
              logger.success(
                `Auto-translation completed: ${translationSuccessful} successful, ${translationFailed} failed`
              );
            } else {
              logger.error(
                `Auto-translation failed: ${translationFailed} errors`
              );
            }

            if (
              translationErrors.length > 0 &&
              (isLogs || translationFailed === translationTasks.length)
            ) {
              logger.separator();
              logger.info('Translation errors:');
              translationErrors.forEach((error) => {
                logger.error(`✗ ${error}`, 1);
              });
            }
          }
        }
      }
    } catch (error) {
      logger.error(`Rename operation failed: ${error.message}`);
      process.exit(1);
    }
  });

subtitlesCommand
  .command('offset')
  .description('Adjust subtitle timing by adding or subtracting time offset')
  .argument('<file>', 'subtitle file path (.ass format)')
  .argument(
    '<offset>',
    'time offset in milliseconds (positive for forward, negative for backward)'
  )
  .option(
    '--output <path>',
    'output file path (default: adds _offset_XXXms suffix)'
  )
  .option(
    '--overwrite',
    'overwrite the original file instead of creating a new one'
  )
  .option('--logs', 'detailed output')
  .option('--quiet, -q', 'quiet mode')
  .action(async (file, offset, options) => {
    const isLogs = options.logs || false;
    const logger = new Logger({
      verbose: false,
      quiet: options.quiet || false,
    });

    try {
      const offsetMs = parseInt(offset);
      if (isNaN(offsetMs)) {
        logger.error(
          'Invalid offset value. Please provide a valid number in milliseconds.'
        );
        logger.info('Examples:');
        logger.info('  4970 (move forward 4.970 seconds)');
        logger.info('  -2500 (move backward 2.5 seconds)');
        process.exit(1);
      }

      const pathValidation = await Validators.validateFilePath(file);
      const subtitleFile = pathValidation.resolvedPath;

      const fs = require('fs').promises;
      try {
        const stats = await fs.stat(subtitleFile);
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

      if (!subtitleFile.toLowerCase().endsWith('.ass')) {
        logger.error(
          'Only .ass subtitle files are supported for timing adjustment'
        );
        process.exit(1);
      }

      const subtitleService = new SubtitleService();

      let outputFile = options.output;

      if (options.overwrite) {
        outputFile = subtitleFile;
      }

      logger.header('Subtitle Timing Adjustment');
      logger.info(`File: ${subtitleFile}`);
      logger.info(
        `Offset: ${offsetMs}ms (${offsetMs >= 0 ? 'forward' : 'backward'})`
      );
      if (offsetMs >= 0) {
        logger.info(`  Equivalent: +${(offsetMs / 1000).toFixed(3)} seconds`);
      } else {
        logger.info(`  Equivalent: ${(offsetMs / 1000).toFixed(3)} seconds`);
      }

      if (options.overwrite) {
        logger.info('Mode: Overwrite original file');
      } else if (outputFile) {
        logger.info(`Output: ${outputFile}`);
      } else {
        logger.info('Output: Auto-generated filename with offset suffix');
      }
      logger.separator();

      const spinner = ora('Adjusting subtitle timing...').start();

      const result = await subtitleService.adjustSubtitleTiming(
        subtitleFile,
        offsetMs,
        outputFile
      );

      if (result.success) {
        if (options.overwrite) {
          spinner.succeed('Subtitle timing adjusted successfully');
          logger.success(`Original file updated: ${result.outputFile}`);
        } else {
          spinner.succeed('Subtitle timing adjusted successfully');
          logger.success(`Adjusted file created: ${result.outputFile}`);
        }

        logger.separator();
        logger.info('Timing adjustment completed');
        logger.info(`Original: ${result.inputFile}`);
        if (!options.overwrite) {
          logger.info(`Adjusted: ${result.outputFile}`);
        }
        logger.info(`Offset applied: ${result.offsetMs}ms`);
      } else {
        spinner.fail('Timing adjustment failed');
        logger.error(`Error: ${result.error}`);
        process.exit(1);
      }
    } catch (error) {
      logger.error(`Timing adjustment failed: ${error.message}`);
      process.exit(1);
    }
  });

subtitlesCommand
  .command('s3-rename')
  .description('Rename a subtitle file in S3 storage')
  .argument('<current-name>', 'current subtitle file name in S3')
  .argument('<new-name>', 'new subtitle file name')
  .option('--logs', 'detailed output')
  .option('--quiet, -q', 'quiet mode')
  .action(async (currentName, newName, options) => {
    const isLogs = options.logs || false;
    const logger = new Logger({
      verbose: false,
      quiet: options.quiet || false,
    });

    try {
      const config = new ConfigManager();
      const s3Config = config.getR2Config();

      if (!s3Config.accessKeyId || !s3Config.secretAccessKey) {
        logger.error('S3 credentials not configured');
        logger.info('Run "anitorrent config setup" to set up S3 configuration');
        process.exit(1);
      }

      const S3Service = require('../services/s3-service');
      const s3Service = new S3Service(s3Config);

      logger.header('S3 Subtitle Rename');
      logger.info(`Current name: ${currentName}`);
      logger.info(`New name: ${newName}`);
      logger.separator();

      const spinner = ora('Renaming file in S3...').start();

      const result = await s3Service.renameFile('subtitles/' + currentName, 'subtitles/' + newName, true);

      if (result.success) {
        spinner.succeed('File renamed successfully');
        logger.success(`Renamed: ${currentName} → ${newName}`);
        logger.info(`Public URL: ${result.publicUrl}`);
      } else {
        spinner.fail('Rename failed');
        process.exit(1);
      }
    } catch (error) {
      logger.error(`Failed to rename file in S3: ${error.message}`);
      process.exit(1);
    }
  });

subtitlesCommand
  .command('s3-delete')
  .description('Delete a subtitle file from S3 storage')
  .argument('<file-name>', 'subtitle file name to delete from S3')
  .option('--logs', 'detailed output')
  .option('--quiet, -q', 'quiet mode')
  .action(async (fileName, options) => {
    const isLogs = options.logs || false;
    const logger = new Logger({
      verbose: false,
      quiet: options.quiet || false,
    });

    try {
      const config = new ConfigManager();
      const s3Config = config.getR2Config();

      if (!s3Config.accessKeyId || !s3Config.secretAccessKey) {
        logger.error('S3 credentials not configured');
        logger.info('Run "anitorrent config setup" to set up S3 configuration');
        process.exit(1);
      }

      const S3Service = require('../services/s3-service');
      const s3Service = new S3Service(s3Config);

      logger.header('S3 Subtitle Delete');
      logger.info(`File to delete: ${fileName}`);
      logger.separator();

      const spinner = ora('Deleting file from S3...').start();

      await s3Service.deleteFile('subtitles/' + fileName, true);

      spinner.succeed('File deleted successfully');
      logger.success(`Deleted: ${fileName}`);
    } catch (error) {
      logger.error(`Failed to delete file from S3: ${error.message}`);
      process.exit(1);
    }
  });

module.exports = subtitlesCommand;
