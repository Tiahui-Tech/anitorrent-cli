const { Command } = require('commander');
const inquirer = require('inquirer');
const chalk = require('chalk');
const ora = require('ora');
const path = require('path');
const anitomy = require('anitomyscript');
const { Logger } = require('../utils/logger');
const FileService = require('../services/file-service');
const Validators = require('../utils/validators');

const filesCommand = new Command('files');
filesCommand.description('File and folder management operations');

filesCommand
  .command('rename')
  .description('Batch rename files and folders with episode number adjustment')
  .option(
    '--path <directory>',
    'target directory path (default: current directory)'
  )
  .option('--start <number>', 'starting episode number (default: 1)', '1')
  .option('--dry-run', 'show preview without making changes')
  .action(async (options) => {
    const isLogs = filesCommand.parent?.opts()?.logs || false;
    const logger = new Logger({
      verbose: false,
      quiet: filesCommand.parent?.opts()?.quiet || false,
    });

    try {
      const targetPath = options.path || process.cwd();
      const startEpisode = parseInt(options.start) || 1;

      logger.header('AniTorrent CLI - Batch File Rename');
      logger.info(`Target directory: ${targetPath}`);
      logger.info(`Starting episode number: ${startEpisode}`);
      logger.separator();

      const fileService = new FileService({
        verbose: false,
        quiet: filesCommand.parent?.opts()?.quiet || false,
      });

      logger.step('📁', 'Scanning directories');
      const spinner = ora('Analyzing folder structure...').start();

      let directories;
      try {
        directories = await fileService.scanDirectory(targetPath);
        spinner.succeed(
          `Found ${directories.length} directories with video files`
        );
      } catch (error) {
        spinner.fail(`Failed to scan directory: ${error.message}`);
        process.exit(1);
      }

      if (directories.length === 0) {
        logger.warning(
          'No directories with video files found in the target path'
        );
        logger.info(
          'Make sure you are in the correct directory and that subdirectories contain video files'
        );
        process.exit(0);
      }

      logger.step('🔍', 'Analyzing video files');
      const analysisSpinner = ora('Parsing episode information...').start();

      let preview;
      try {
        preview = await fileService.createRenamePreview(
          directories,
          startEpisode
        );
        analysisSpinner.succeed('Episode analysis completed');
      } catch (error) {
        analysisSpinner.fail(`Failed to analyze files: ${error.message}`);
        process.exit(1);
      }

      logger.step('📋', 'Rename Preview');
      logger.info('The following changes will be made:', 1);
      logger.separator();

      let episodeCounter = startEpisode;
      for (const item of preview) {
        logger.info(
          `📂 Folder: ${chalk.red(item.originalFolder)} → ${chalk.green(
            item.newFolder
          )}`,
          1
        );

        for (const file of item.files) {
          logger.info(`   📄 ${chalk.red(file.originalFile)}`, 2);
          logger.info(`   → ${chalk.green(file.newFile)}`, 2);

          if (file.episodeInfo.anime_title) {
            logger.info(`   📺 Detected: ${file.episodeInfo.anime_title}`, 3);
            if (file.episodeInfo.anime_season) {
              logger.info(`   🎬 Season: ${file.episodeInfo.anime_season}`, 3);
            }
            if (file.episodeInfo.episode_number) {
              logger.info(
                `   📊 Original Episode: ${file.episodeInfo.episode_number} → New Episode: ${episodeCounter}`,
                3
              );
            }
          }
        }

        logger.separator();
        episodeCounter++;
      }

      if (options.dryRun) {
        logger.info('🔍 Dry run mode - no changes were made');
        logger.info('Remove --dry-run flag to execute the rename operation');
        return;
      }

      const { confirm } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: `Proceed with renaming ${directories.length} folders and their video files?`,
          default: false,
        },
      ]);

      if (!confirm) {
        logger.info('Operation cancelled by user');
        return;
      }

      logger.step('🔄', 'Executing rename operations');
      const renameSpinner = ora('Renaming files and folders...').start();

      try {
        const results = await fileService.executeRename(directories, preview);

        if (results.errors.length > 0) {
          renameSpinner.fail(`Completed with ${results.errors.length} errors`);

          logger.warning('Errors occurred during rename:');
          for (const error of results.errors) {
            logger.error(`${error.folder}: ${error.error}`, 1);
          }
        } else {
          renameSpinner.succeed('All files and folders renamed successfully');
        }

        if (results.success.length > 0) {
          logger.success(
            `Successfully renamed ${results.success.length} items:`
          );

          const fileRenames = results.success.filter(
            (item) => item.type === 'file'
          );
          const folderRenames = results.success.filter(
            (item) => item.type === 'folder'
          );

          logger.info(`📄 Files: ${fileRenames.length}`, 1);
          logger.info(`📂 Folders: ${folderRenames.length}`, 1);
        }
      } catch (error) {
        renameSpinner.fail(`Rename operation failed: ${error.message}`);
        if (isLogs) {
          logger.info(`Full error: ${error.stack}`);
        }
        process.exit(1);
      }
    } catch (error) {
      logger.error(`File rename operation failed: ${error.message}`);
      if (isLogs) {
        logger.info(`Full error: ${error.stack}`);
      }
      process.exit(1);
    }
  });

filesCommand
  .command('parse')
  .description('Parse anime file names and extract metadata using anitomy')
  .argument('[input]', 'file path or text to parse (if not provided, scans current directory)')
  .option('--path <directory>', 'target directory path (default: current directory)')
  .option('--recursive', 'search for files in subdirectories')
  .option('--json', 'output results in JSON format')
  .option('--text', 'treat input as text instead of file path')
  .action(async (input, options) => {
    const isLogs = filesCommand.parent?.opts()?.logs || false;
    const logger = new Logger({
      verbose: false,
      quiet: filesCommand.parent?.opts()?.quiet || false,
    });

    try {
      let filesToParse = [];

      if (input && options.text) {
        logger.header('AniTorrent CLI - Anime Text Parser');
        logger.info(`Parsing text: "${input}"`);
        logger.separator();

        logger.step('🔍', 'Parsing text with anitomy');
        const parseSpinner = ora('Analyzing anime metadata...').start();

        try {
          const parsed = await anitomy(input);
          parseSpinner.succeed('Text parsing completed');

          if (options.json) {
            const jsonOutput = {
              input: input,
              success: true,
              metadata: parsed
            };
            console.log(JSON.stringify(jsonOutput, null, 2));
            return;
          }

          logger.step('📊', 'Parse Results');
          logger.separator();

          logger.info(`📄 Input: ${chalk.cyan(input)}`);
          
          if (parsed.anime_title) {
            logger.info(`   📺 Title: ${chalk.green(parsed.anime_title)}`, 1);
          }
          
          if (parsed.anime_season) {
            logger.info(`   🎬 Season: ${chalk.yellow(parsed.anime_season)}`, 1);
          }
          
          if (parsed.episode_number) {
            logger.info(`   📊 Episode: ${chalk.blue(parsed.episode_number)}`, 1);
          }
          
          if (parsed.anime_year) {
            logger.info(`   📅 Year: ${chalk.magenta(parsed.anime_year)}`, 1);
          }
          
          if (parsed.video_resolution) {
            logger.info(`   🎥 Resolution: ${chalk.white(parsed.video_resolution)}`, 1);
          }
          
          if (parsed.source) {
            logger.info(`   💿 Source: ${chalk.gray(parsed.source)}`, 1);
          }
          
          if (parsed.audio_language) {
            logger.info(`   🎵 Audio: ${chalk.cyan(parsed.audio_language)}`, 1);
          }
          
          if (parsed.subtitle_language) {
            logger.info(`   📝 Subtitles: ${chalk.white(parsed.subtitle_language)}`, 1);
          }
          
          if (parsed.release_group) {
            logger.info(`   👥 Group: ${chalk.red(parsed.release_group)}`, 1);
          }
          
          if (parsed.file_extension) {
            logger.info(`   📎 Extension: ${chalk.gray(parsed.file_extension)}`, 1);
          }

          return;
        } catch (error) {
          parseSpinner.fail(`Failed to parse text: ${error.message}`);
          
          if (options.json) {
            const jsonOutput = {
              input: input,
              success: false,
              error: error.message
            };
            console.log(JSON.stringify(jsonOutput, null, 2));
            return;
          }

          logger.error(`Parse failed: ${error.message}`);
          process.exit(1);
        }
      }

      if (input && !options.text) {
        const fileValidation = await Validators.validateFilePath(input);
        
        if (!fileValidation.exists) {
          logger.error(`File not found: "${fileValidation.originalPath}"`);
          process.exit(1);
        }

        filesToParse = [{
          fileName: path.basename(fileValidation.resolvedPath),
          fullPath: fileValidation.resolvedPath,
          relativePath: fileValidation.originalPath
        }];
      } else if (!input) {
        const targetPath = options.path || process.cwd();
        const isRecursive = options.recursive || false;

        logger.header('AniTorrent CLI - Anime File Parser');
        logger.info(`Target directory: ${targetPath}`);
        if (isRecursive) {
          logger.info('Including subdirectories: Yes');
        }
        logger.separator();

        const scanSpinner = ora('Scanning for video files...').start();

        try {
          const fs = require('fs').promises;
          
          async function scanDir(currentDir, relativePath = '') {
            const entries = await fs.readdir(currentDir, { withFileTypes: true });
            
            for (const entry of entries) {
              const fullPath = path.join(currentDir, entry.name);
              const relativeFilePath = path.join(relativePath, entry.name);
              
              if (entry.isFile() && Validators.isValidVideoFile(fullPath)) {
                filesToParse.push({
                  fileName: entry.name,
                  fullPath,
                  relativePath: relativeFilePath || entry.name
                });
              } else if (entry.isDirectory() && isRecursive) {
                await scanDir(fullPath, relativeFilePath);
              }
            }
          }

          await scanDir(targetPath);
          scanSpinner.succeed(`Found ${filesToParse.length} video files`);
        } catch (error) {
          scanSpinner.fail(`Failed to scan directory: ${error.message}`);
          process.exit(1);
        }

        if (filesToParse.length === 0) {
          logger.warning('No video files found in the target directory');
          process.exit(0);
        }
      }

      logger.step('🔍', 'Parsing file names with anitomy');
      const parseSpinner = ora('Analyzing anime metadata...').start();

      const results = [];
      let successCount = 0;
      let errorCount = 0;

      for (const fileInfo of filesToParse) {
        try {
          const parsed = await anitomy(fileInfo.fileName);
          results.push({
            file: fileInfo,
            parsed,
            success: true
          });
          successCount++;
        } catch (error) {
          results.push({
            file: fileInfo,
            error: error.message,
            success: false
          });
          errorCount++;
        }
      }

      parseSpinner.succeed(`Parsing completed: ${successCount} success, ${errorCount} errors`);

      if (options.json) {
        const jsonOutput = results.map(result => ({
          fileName: result.file.fileName,
          relativePath: result.file.relativePath,
          success: result.success,
          ...(result.success ? { metadata: result.parsed } : { error: result.error })
        }));
        
        console.log(JSON.stringify(jsonOutput, null, 2));
        return;
      }

      logger.step('📊', 'Parse Results');
      logger.separator();

      for (const result of results) {
        if (result.success) {
          logger.info(`📄 ${chalk.cyan(result.file.relativePath)}`);
          
          const metadata = result.parsed;
          
          if (metadata.anime_title) {
            logger.info(`   📺 Title: ${chalk.green(metadata.anime_title)}`, 1);
          }
          
          if (metadata.anime_season) {
            logger.info(`   🎬 Season: ${chalk.yellow(metadata.anime_season)}`, 1);
          }
          
          if (metadata.episode_number) {
            logger.info(`   📊 Episode: ${chalk.blue(metadata.episode_number)}`, 1);
          }
          
          if (metadata.anime_year) {
            logger.info(`   📅 Year: ${chalk.magenta(metadata.anime_year)}`, 1);
          }
          
          if (metadata.video_resolution) {
            logger.info(`   🎥 Resolution: ${chalk.white(metadata.video_resolution)}`, 1);
          }
          
          if (metadata.source) {
            logger.info(`   💿 Source: ${chalk.gray(metadata.source)}`, 1);
          }
          
          if (metadata.audio_language) {
            logger.info(`   🎵 Audio: ${chalk.cyan(metadata.audio_language)}`, 1);
          }
          
          if (metadata.subtitle_language) {
            logger.info(`   📝 Subtitles: ${chalk.white(metadata.subtitle_language)}`, 1);
          }
          
          if (metadata.release_group) {
            logger.info(`   👥 Group: ${chalk.red(metadata.release_group)}`, 1);
          }
          
          if (metadata.file_extension) {
            logger.info(`   📎 Extension: ${chalk.gray(metadata.file_extension)}`, 1);
          }
          
        } else {
          logger.info(`📄 ${chalk.red(result.file.relativePath)}`);
          logger.error(`   ❌ Parse failed: ${result.error}`, 1);
        }
        
        logger.separator();
      }

      logger.info(`Total files: ${filesToParse.length}`);
      logger.info(`Successfully parsed: ${chalk.green(successCount)}`);
      if (errorCount > 0) {
        logger.info(`Failed to parse: ${chalk.red(errorCount)}`);
      }

    } catch (error) {
      logger.error(`Parse operation failed: ${error.message}`);
      if (isLogs) {
        logger.info(`Full error: ${error.stack}`);
      }
      process.exit(1);
    }
  });

module.exports = filesCommand;
