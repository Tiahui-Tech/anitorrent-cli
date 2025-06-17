const { Command } = require('commander');
const ora = require('ora');
const path = require('path');
const { Logger } = require('../utils/logger');
const Validators = require('../utils/validators');
const VideoService = require('../services/video-service');

const videoCommand = new Command('video');
videoCommand.description('Video manipulation operations');

videoCommand
  .command('merge')
  .description('Merge intro video with input video')
  .argument('<input>', 'input video file to add intro to')
  .option('--output <path>', 'output file path (default: input_with_intro.ext)')
  .option('--intro <path>', 'custom intro file path (default: data/intro.mp4)')
  .action(async (input, options) => {
    const logger = new Logger({ 
      verbose: videoCommand.parent?.opts()?.verbose || false,
      quiet: videoCommand.parent?.opts()?.quiet || false
    });

    try {
      const inputValidation = await Validators.validateFilePath(input);
      
      if (!inputValidation.exists) {
        logger.error(`Input video file not found: "${inputValidation.originalPath}"`);
        if (inputValidation.originalPath !== inputValidation.resolvedPath) {
          logger.error(`Resolved path: "${inputValidation.resolvedPath}"`);
        }
        process.exit(1);
      }

      const inputVideoPath = inputValidation.resolvedPath;
      logger.verbose(`Using input video: ${inputVideoPath}`);

      if (!Validators.isValidVideoFile(inputVideoPath)) {
        logger.warning('Input file does not appear to be a video file');
      }

      const introPath = options.intro || path.resolve(__dirname, '..', '..', 'data', 'intro.mp4');
      logger.verbose(`Using intro file: ${introPath}`);

      const videoService = new VideoService({
        verbose: videoCommand.parent?.opts()?.verbose || false,
        quiet: videoCommand.parent?.opts()?.quiet || false
      });

      const introExists = await videoService.fileExists(introPath);
      if (!introExists) {
        logger.error(`Intro file not found: ${introPath}`);
        logger.info('Make sure the intro file exists at data/intro.mp4 or specify a custom path with --intro');
        process.exit(1);
      }

      const outputPath = options.output || videoService.generateOutputFileName(inputVideoPath);
      logger.verbose(`Output will be saved to: ${outputPath}`);

      const outputExists = await videoService.fileExists(outputPath);
      if (outputExists) {
        logger.warning(`Output file already exists and will be overwritten: ${outputPath}`);
      }

      logger.header('Video Merge Operation');
      logger.info(`Input video: ${inputValidation.originalPath}`);
      logger.info(`Intro video: ${introPath}`);
      logger.info(`Output video: ${outputPath}`);
      logger.separator();

      logger.step('📹', 'Analyzing video files');
      
      const [inputInfo, introInfo, inputSize, introSize] = await Promise.all([
        videoService.getVideoInfo(inputVideoPath).catch(() => ({ duration: 'Unknown', resolution: 'Unknown' })),
        videoService.getVideoInfo(introPath).catch(() => ({ duration: 'Unknown', resolution: 'Unknown' })),
        videoService.getFileSize(inputVideoPath),
        videoService.getFileSize(introPath)
      ]);

      logger.info('Input Video Info:', 1);
      logger.info(`Duration: ${inputInfo.duration}`, 2);
      logger.info(`Resolution: ${inputInfo.resolution}`, 2);
      logger.info(`Size: ${inputSize}`, 2);

      logger.info('Intro Video Info:', 1);
      logger.info(`Duration: ${introInfo.duration}`, 2);
      logger.info(`Resolution: ${introInfo.resolution}`, 2);
      logger.info(`Size: ${introSize}`, 2);

      logger.step('🔧', 'Checking FFmpeg installation');
      const ffmpegInstalled = await videoService.checkFFmpegInstalled();
      
      if (!ffmpegInstalled) {
        logger.error('FFmpeg is not installed or not available in PATH');
        logger.info('Please install FFmpeg to use video merge functionality');
        logger.info('Visit: https://ffmpeg.org/download.html');
        process.exit(1);
      }

      logger.success('FFmpeg is available');

      logger.step('🎬', 'Merging videos');
      logger.info('This may take a while depending on video size and system performance...', 1);

      const spinner = ora('Processing videos...').start();
      
      try {
        const result = await videoService.mergeVideos(introPath, inputVideoPath, outputPath);
        spinner.succeed('Videos merged successfully');

        logger.success('Merge completed!');
        logger.info(`Output saved to: ${outputPath}`, 1);

        const outputSize = await videoService.getFileSize(outputPath);
        const outputInfo = await videoService.getVideoInfo(outputPath).catch(() => ({ duration: 'Unknown', resolution: 'Unknown' }));

        logger.info('Output Video Info:', 1);
        logger.info(`Duration: ${outputInfo.duration}`, 2);
        logger.info(`Resolution: ${outputInfo.resolution}`, 2);
        logger.info(`Size: ${outputSize}`, 2);

      } catch (error) {
        spinner.fail(`Merge failed: ${error.message}`);
        logger.verbose(`Full error: ${error.stack}`);
        process.exit(1);
      }

    } catch (error) {
      logger.error(`Video merge failed: ${error.message}`);
      logger.verbose(`Full error: ${error.stack}`);
      process.exit(1);
    }
  });

module.exports = videoCommand; 