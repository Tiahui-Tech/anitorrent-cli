const { Command } = require('commander');
const ora = require('ora');
const inquirer = require('inquirer');
const anitomy = require('anitomyscript');
const ConfigManager = require('../utils/config');
const { Logger } = require('../utils/logger');
const Validators = require('../utils/validators');
const PeerTubeService = require('../services/peertube-service');

const peertubeCommand = new Command('peertube');
peertubeCommand.description('PeerTube video management');

peertubeCommand
  .command('import')
  .description('Import video from URL')
  .argument('<url>', 'video URL to import')
  .option('--name <name>', 'custom name for the video')
  .option('--channel <id>', 'PeerTube channel ID')
  .option('--privacy <level>', 'privacy level (1-5)')
  .option('--password <password>', 'video password')
  .option('--wait <minutes>', 'wait for processing to complete', '120')
  .action(async (url, options) => {
    const isLogs = peertubeCommand.parent?.opts()?.logs || false;
    const logger = new Logger({ 
      verbose: false,
      quiet: peertubeCommand.parent?.opts()?.quiet || false
    });

    try {
      if (!Validators.isValidUrl(url)) {
        logger.error('Invalid URL format');
        process.exit(1);
      }

      const config = new ConfigManager();
      config.validateRequired();
      
      const peertubeConfig = config.getPeerTubeConfig();
      const defaults = config.getDefaults();

      const channelId = options.channel ? parseInt(options.channel) : await config.getDefaultChannelId();
      const privacy = options.privacy ? parseInt(options.privacy) : defaults.privacy;
      const videoPassword = options.password || defaults.videoPassword;
      const maxWaitMinutes = parseInt(options.wait);
      const waitForCompletion = options.wait !== undefined;

      if (!Validators.isValidChannelId(channelId)) {
        logger.error('Invalid channel ID');
        process.exit(1);
      }

      if (!Validators.isValidPrivacyLevel(privacy)) {
        logger.error('Invalid privacy level (must be 1-5)');
        process.exit(1);
      }

      logger.header('PeerTube Video Import');
      logger.info(`URL: ${decodeURIComponent(url)}`);
      logger.info(`Channel ID: ${channelId}`);
      logger.info(`Privacy: ${privacy}`);
      if (waitForCompletion) {
        logger.info(`Wait for completion: ${maxWaitMinutes} minutes`);
      }
      logger.separator();

      const peertubeService = new PeerTubeService(peertubeConfig);

      const importOptions = {
        channelId,
        name: options.name,
        privacy,
        videoPasswords: [videoPassword],
        silent: true
      };

      const spinner = ora('Importing video...').start();
      
      try {
        const result = await peertubeService.importVideo(url, importOptions);
        const videoId = result.video?.id;

        spinner.succeed('Import initiated successfully');
        
        logger.success('Import Details:');
        logger.info(`Import ID: ${result.id}`, 1);
        logger.info(`Video ID: ${videoId}`, 1);
        logger.info(`Initial Status: ${result.state?.label || 'Unknown'}`, 1);

        if (waitForCompletion && videoId) {
          logger.separator();
          logger.step('⏳', 'Waiting for PeerTube to import from S3');
          
          const processingSpinner = ora('Monitoring processing status...').start();
          const processingResult = await peertubeService.waitForProcessing(videoId, maxWaitMinutes);
          
          if (processingResult.success) {
            processingSpinner.succeed(`Processing completed: ${processingResult.finalState}`);
          } else {
            processingSpinner.warn(`Processing timeout: ${processingResult.finalState}`);
          }

          logger.separator();
          logger.header('Final Result');
          
          if (processingResult.video) {
            const video = processingResult.video;
            logger.info(`Video ID: ${video.id}`);
            logger.info(`UUID: ${video.uuid}`);
            logger.info(`Short UUID: ${video.shortUUID}`);
            logger.info(`Name: ${video.name}`);
            logger.info(`Duration: ${Validators.formatDuration(video.duration)}`);
            logger.info(`Status: ${processingResult.finalState}`);
            logger.info(`Privacy: ${video.privacy?.label || 'Unknown'}`);
            logger.separator();
            logger.info(`Watch URL: ${video.url}`);
            logger.info(`Embed URL: ${peertubeConfig.apiUrl.replace('/api/v1', '')}/videos/embed/${video.shortUUID}`);
          } else {
            logger.info(`Import ID: ${result.id}`);
            logger.info(`Video ID: ${videoId}`);
            logger.info(`Final Status: ${processingResult.finalState}`);
          }
        } else if (waitForCompletion) {
          logger.warning('No video ID returned from import, cannot monitor processing');
        } else {
          logger.info('Import completed (use --wait to monitor processing)');
        }

      } catch (error) {
        spinner.fail(`Import failed: ${error.message}`);
        process.exit(1);
      }

    } catch (error) {
      logger.error(`Import failed: ${error.message}`);
      process.exit(1);
    }
  });

peertubeCommand
  .command('status')
  .description('Check import status')
  .argument('<import-id>', 'import ID to check')
  .action(async (importId) => {
    const isLogs = peertubeCommand.parent?.opts()?.logs || false;
    const logger = new Logger({ 
      verbose: false,
      quiet: peertubeCommand.parent?.opts()?.quiet || false
    });

    try {
      const config = new ConfigManager();
      config.validateRequired();
      
      const peertubeConfig = config.getPeerTubeConfig();
      const peertubeService = new PeerTubeService(peertubeConfig);

      logger.header('Import Status Check');
      logger.info(`Import ID: ${importId}`);
      logger.separator();

      const spinner = ora('Fetching import status...').start();
      
      try {
        const status = await peertubeService.getImportStatus(importId);
        spinner.succeed('Status retrieved');

        logger.info('Import Status:');
        logger.info(JSON.stringify(status, null, 2), 1);

      } catch (error) {
        spinner.fail(`Failed to get status: ${error.message}`);
        process.exit(1);
      }

    } catch (error) {
      logger.error(`Status check failed: ${error.message}`);
      process.exit(1);
    }
  });

peertubeCommand
  .command('get')
  .description('Get video information by ID')
  .argument('<video-id>', 'video ID to retrieve')
  .action(async (videoId) => {
    const isLogs = peertubeCommand.parent?.opts()?.logs || false;
    const logger = new Logger({ 
      verbose: false,
      quiet: peertubeCommand.parent?.opts()?.quiet || false
    });

    try {
      const config = new ConfigManager();
      config.validateRequired();
      
      const peertubeConfig = config.getPeerTubeConfig();
      const peertubeService = new PeerTubeService(peertubeConfig);

      logger.header('Video Information');
      logger.info(`Video ID: ${videoId}`);
      logger.separator();

      const spinner = ora('Fetching video information...').start();
      
      try {
        const video = await peertubeService.getVideoById(videoId);
        spinner.succeed('Video information retrieved');

        logger.info('Video Details:');
        logger.info(`ID: ${video.id}`, 1);
        logger.info(`UUID: ${video.uuid}`, 1);
        logger.info(`Short UUID: ${video.shortUUID}`, 1);
        logger.info(`Name: ${video.name}`, 1);
        logger.info(`Description: ${video.description || 'No description'}`, 1);
        logger.info(`Duration: ${Validators.formatDuration(video.duration)}`, 1);
        logger.info(`Views: ${video.views}`, 1);
        logger.info(`Likes: ${video.likes}`, 1);
        logger.info(`Privacy: ${video.privacy?.label} (${video.privacy?.id})`, 1);
        logger.info(`State: ${video.state?.label || 'Unknown'}`, 1);
        logger.info(`Published: ${new Date(video.publishedAt).toLocaleString()}`, 1);
        logger.info(`Channel: ${video.channel?.displayName}`, 1);
        logger.info(`Account: ${video.account?.displayName}`, 1);
        
        if (video.tags && video.tags.length > 0) {
          logger.info(`Tags: ${video.tags.join(', ')}`, 1);
        }
        
        logger.separator();
        logger.info(`Watch URL: ${video.url}`, 1);
        logger.info(`Embed URL: ${peertubeConfig.apiUrl.replace('/api/v1', '')}/videos/embed/${video.shortUUID}`, 1);

      } catch (error) {
        spinner.fail(`Failed to get video: ${error.message}`);
        process.exit(1);
      }

    } catch (error) {
      logger.error(`Get video failed: ${error.message}`);
      process.exit(1);
    }
  });

peertubeCommand
  .command('list')
  .description('List recent videos')
  .option('--limit <number>', 'number of videos to list', '10')
  .action(async (options) => {
    const isLogs = peertubeCommand.parent?.opts()?.logs || false;
    const logger = new Logger({ 
      verbose: false,
      quiet: peertubeCommand.parent?.opts()?.quiet || false
    });

    try {
      const limit = parseInt(options.limit);
      
      if (isNaN(limit) || limit < 1 || limit > 100) {
        logger.error('Invalid limit (must be 1-100)');
        process.exit(1);
      }

      const config = new ConfigManager();
      config.validateRequired();
      
      const peertubeConfig = config.getPeerTubeConfig();
      const peertubeService = new PeerTubeService(peertubeConfig);

      logger.header('Recent Videos');
      logger.info(`Limit: ${limit}`);
      logger.separator();

      const spinner = ora('Fetching videos...').start();
      
      try {
        const data = await peertubeService.listVideos(limit, 0);
        spinner.succeed(`Found ${data.total} total videos`);

        logger.info(`Showing ${data.data.length} videos:`);
        logger.separator();
        
        data.data.forEach((video, index) => {
          logger.info(`${index + 1}. ID: ${video.id}`);
          logger.info(`   Name: ${video.name}`, 1);
          logger.info(`   Duration: ${Validators.formatDuration(video.duration)}`, 1);
          logger.info(`   Views: ${video.views}`, 1);
          logger.info(`   State: ${video.state?.label || 'Unknown'}`, 1);
          logger.info(`   Embed URL: ${peertubeConfig.apiUrl.replace('/api/v1', '')}/videos/embed/${video.shortUUID}`, 1);
          logger.separator();
        });

      } catch (error) {
        spinner.fail(`Failed to list videos: ${error.message}`);
        process.exit(1);
      }

    } catch (error) {
      logger.error(`List videos failed: ${error.message}`);
      process.exit(1);
    }
  });

peertubeCommand
  .command('playlist')
  .description('Create playlist from recent videos')
  .option('--count <number>', 'number of videos to fetch (max per request: 100)', '200')
  .action(async (options) => {
    const isLogs = peertubeCommand.parent?.opts()?.logs || false;
    const logger = new Logger({ 
      verbose: false,
      quiet: peertubeCommand.parent?.opts()?.quiet || false
    });

    try {
      const totalCount = parseInt(options.count);
      
      if (isNaN(totalCount) || totalCount < 1) {
        logger.error('Invalid count (must be a positive number)');
        process.exit(1);
      }

      const config = new ConfigManager();
      config.validateRequired();
      
      const peertubeConfig = config.getPeerTubeConfig();
      const peertubeService = new PeerTubeService(peertubeConfig);
      const defaults = config.getDefaults();
      const channelId = await config.getDefaultChannelId();

      logger.header('PeerTube Playlist Creator');
      logger.info(`Fetching ${totalCount} videos...`);
      logger.separator();

      const spinner = ora('Fetching videos from PeerTube...').start();
      
      try {
        const allVideos = [];
        const requestsNeeded = Math.ceil(totalCount / 100);
        
        for (let i = 0; i < requestsNeeded; i++) {
          const limit = Math.min(100, totalCount - (i * 100));
          const start = i * 100;
          
          const data = await peertubeService.listVideos(limit, start);
          allVideos.push(...data.data);
          
          if (data.data.length < limit) break;
        }

        spinner.succeed(`Fetched ${allVideos.length} videos`);

        logger.info('Parsing video names with anitomy...');
        const parseSpinner = ora('Analyzing anime information...').start();

        const animeGroups = {};
        
        for (const video of allVideos) {
          try {
            const parsed = await anitomy(video.name);
            
            if (parsed.anime_title) {
              const animeTitle = parsed.anime_title;
              const season = parsed.anime_season || '1';
              const episode = parsed.episode_number || '1';
              
              const groupKey = `${animeTitle} - Season ${season}`;
              
              if (!animeGroups[groupKey]) {
                animeGroups[groupKey] = {
                  title: animeTitle,
                  season: season,
                  videos: []
                };
              }
              
              animeGroups[groupKey].videos.push({
                ...video,
                episode: parseInt(episode) || 1
              });
            }
          } catch (error) {
            // Skip videos that can't be parsed
          }
        }

        const groupKeys = Object.keys(animeGroups);
        
        if (groupKeys.length === 0) {
          parseSpinner.fail('No anime series found in the videos');
          return;
        }

        parseSpinner.succeed(`Found ${groupKeys.length} anime series`);

        groupKeys.forEach(key => {
          animeGroups[key].videos.sort((a, b) => a.episode - b.episode);
        });

        logger.separator();
        logger.info('Available anime series:');
        groupKeys.forEach((key, index) => {
          const group = animeGroups[key];
          logger.info(`${index + 1}. ${key} (${group.videos.length} episodes)`, 1);
        });

        const { selectedGroup } = await inquirer.prompt([
          {
            type: 'list',
            name: 'selectedGroup',
            message: 'Select an anime series to create a playlist:',
            choices: groupKeys.map(key => ({
              name: `${key} (${animeGroups[key].videos.length} episodes)`,
              value: key
            }))
          }
        ]);

        const selectedAnime = animeGroups[selectedGroup];
        
        logger.separator();
        logger.header(`Creating Playlist: ${selectedGroup}`);

        const createSpinner = ora('Creating playlist...').start();
        
        try {
          const playlistResult = await peertubeService.createPlaylist({
            displayName: selectedGroup,
            privacy: 1,
            videoChannelId: channelId
          });

          createSpinner.succeed('Playlist created successfully');
          
          logger.info('Playlist Details:');
          logger.info(`ID: ${playlistResult.videoPlaylist.id}`, 1);
          logger.info(`UUID: ${playlistResult.videoPlaylist.uuid}`, 1);
          logger.info(`Short UUID: ${playlistResult.videoPlaylist.shortUUID}`, 1);

          logger.separator();
          logger.info('Adding videos to playlist...');

          const addSpinner = ora('Adding videos in order...').start();
          
          for (let i = 0; i < selectedAnime.videos.length; i++) {
            const video = selectedAnime.videos[i];
            
            try {
              await peertubeService.addVideoToPlaylist(
                playlistResult.videoPlaylist.id,
                video.id
              );
              
              addSpinner.text = `Added episode ${video.episode}: ${video.name}`;
              
            } catch (error) {
              logger.warning(`Failed to add video ${video.id}: ${error.message}`);
            }
          }

          addSpinner.succeed(`Added ${selectedAnime.videos.length} videos to playlist`);

          logger.separator();
          logger.success('Playlist created successfully!');
          logger.info(`Playlist URL: ${peertubeConfig.apiUrl.replace('/api/v1', '')}/video-playlists/${playlistResult.videoPlaylist.shortUUID}`);

        } catch (error) {
          createSpinner.fail(`Failed to create playlist: ${error.message}`);
          process.exit(1);
        }

      } catch (error) {
        spinner.fail(`Failed to fetch videos: ${error.message}`);
        process.exit(1);
      }

    } catch (error) {
      logger.error(`Playlist creation failed: ${error.message}`);
      process.exit(1);
    }
  });

module.exports = peertubeCommand; 