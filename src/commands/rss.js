const { Command } = require('commander');
const ora = require('ora');
const chalk = require('chalk');
const anitomy = require('anitomyscript');
const { Logger } = require('../utils/logger');
const ConfigManager = require('../utils/config');
const Validators = require('../utils/validators');
const UploadService = require('../services/upload-service');
const AniTorrentService = require('../services/anitorrent-service');
const TorrentService = require('../services/torrent-service');

const rssCommand = new Command('rss');
rssCommand.description('RSS feed operations');

const toshoUrl = 'https://feed.animetosho.org/json?qx=1&q=%22[Erai-raws]%20%22%221080p%22!(%22REPACK%22|%22v2%22|%22(ita)%22|%22~%22)'

const fetchWithRetry = async (url, retries = 3) => {
  const https = require('https');
  const http = require('http');
  
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    
    const request = client.get(url, (response) => {
      let data = '';
      
      response.on('data', (chunk) => {
        data += chunk;
      });
      
      response.on('end', () => {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          try {
            const jsonData = JSON.parse(data);
            resolve(jsonData);
          } catch (error) {
            reject(new Error(`Failed to parse JSON: ${error.message}`));
          }
        } else {
          reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
        }
      });
    });
    
    request.on('error', (error) => {
      if (retries > 0) {
        setTimeout(() => {
          fetchWithRetry(url, retries - 1).then(resolve).catch(reject);
        }, 1000);
      } else {
        reject(error);
      }
    });
    
    request.setTimeout(10000, () => {
      request.destroy();
      reject(new Error('Request timeout'));
    });
  });
};

const filterDuplicateEpisodes = async (episodes, logger) => {
  const episodeMap = new Map();
  const duplicates = [];
  const invalidEpisodes = [];
  
  for (const episode of episodes) {
    try {
      if (!episode.anidb_aid) {
        invalidEpisodes.push(episode);
        logger.verbose(`Skipped episode (no AniDB ID): ${episode.title}`);
        continue;
      }
      
      const anizipUrl = `https://api.ani.zip/mappings?anidb_id=${episode.anidb_aid}`;
      const anizipData = await fetchWithRetry(anizipUrl);
      
      if (!anizipData || !anizipData.mappings || !anizipData.mappings.anilist_id) {
        invalidEpisodes.push(episode);
        logger.verbose(`Skipped episode (no AniList ID): ${episode.title}`);
        continue;
      }
      
      const anilistId = anizipData.mappings.anilist_id;
      const episodeMatch = Object.values(anizipData.episodes || {}).find(ep => 
        ep.anidbEid === episode.anidb_eid
      );
      
      if (!episodeMatch) {
        invalidEpisodes.push(episode);
        logger.verbose(`Skipped episode (no episode match): ${episode.title}`);
        continue;
      }
      
      const parsed = await anitomy(episode.title);
      if (!parsed.episode_number) {
        invalidEpisodes.push(episode);
        logger.verbose(`Skipped episode (no episode number from anitomy): ${episode.title}`);
        continue;
      }
      
      const episodeNumber = episodeMatch.episode;
      const key = `${anilistId}_${episodeNumber}`;
      
      if (episodeMap.has(key)) {
        const existing = episodeMap.get(key);
        
        const isCurrentJA = episode.title.includes('(JA)');
        const isExistingJA = existing.title.includes('(JA)');
        const isCurrentCA = episode.title.includes('(CA)');
        const isExistingCA = existing.title.includes('(CA)');
        
        if (isCurrentJA && isExistingCA) {
          episodeMap.set(key, episode);
          duplicates.push(existing);
          logger.verbose(`Replaced CA with JA: AniList ${anilistId} EP${episodeNumber}`);
        } else if (isExistingJA && isCurrentCA) {
          duplicates.push(episode);
          logger.verbose(`Kept JA over CA: AniList ${anilistId} EP${episodeNumber}`);
        } else {
          duplicates.push(episode);
          logger.verbose(`Duplicate found: AniList ${anilistId} EP${episodeNumber}`);
        }
      } else {
        episodeMap.set(key, episode);
      }
    } catch (error) {
      invalidEpisodes.push(episode);
      logger.verbose(`Skipped episode (error): ${episode.title} - ${error.message}`);
    }
  }
  
  const filteredEpisodes = Array.from(episodeMap.values());
  logger.info(`Filtered ${duplicates.length} duplicate episodes`);
  logger.info(`Skipped ${invalidEpisodes.length} invalid episodes`);
  
  return filteredEpisodes;
};

const checkEpisodeExists = async (episode, anitorrentService, logger) => {
  try {
    const anizipUrl = `https://api.ani.zip/mappings?anidb_id=${episode.anidb_aid}`;
    const anizipData = await fetchWithRetry(anizipUrl);
    
    const anilistId = anizipData.mappings.anilist_id;
    const episodeMatch = Object.values(anizipData.episodes || {}).find(ep => 
      ep.anidbEid === episode.anidb_eid
    );
    
    const episodeNumber = episodeMatch.episode;
    const existingEpisode = await anitorrentService.getEpisodeByNumber(anilistId, episodeNumber);
    
    return existingEpisode !== null;
  } catch (error) {
    logger.verbose(`Error checking episode existence: ${error.message}`);
    return false;
  }
};

rssCommand
  .command('test')
  .description('Test RSS feed integration with anime data and optional upload')
  .option('--debug, -d', 'debug output')
  .option('--quiet, -q', 'quiet mode')
  .option('--upload', 'download torrent and upload to PeerTube')
  .option('--channel <id>', 'PeerTube channel ID')
  .option('--privacy <level>', 'privacy level (1-5)')
  .option('--password <password>', 'video password')
  .option('--wait <minutes>', 'max wait time for processing', '120')
  .option('--keep-r2', 'keep file in R2 after import')
  .option('--anime-id <id>', 'AniList anime ID for episode update')
  .option('--track <number>', 'subtitle track number for extraction')
  .option('--use-title', 'use the title of the video for the upload name')
  .option('--kill-existing', 'kill existing torrent processes before starting')
  .option('--clean-downloads', 'clean existing files from download directory before starting')
  .action(async (options) => {
    const logger = new Logger({ 
      verbose: options.debug || false,
      quiet: options.quiet || false
    });

    try {
      if (options.killExisting) {
        logger.info('🔄 Cleaning up existing torrent processes...');
        await TorrentService.killExistingProcesses();
      }

      if (options.cleanDownloads) {
        logger.info('🧹 Cleaning existing download files...');
        const tempTorrentService = new TorrentService({ logger });
        await tempTorrentService.cleanupExistingFiles();
      }

      logger.header('RSS Feed Test');
      
      const toshoSpinner = ora('Fetching from AnimeToSho RSS...').start();
      
      const toshoData = await fetchWithRetry(toshoUrl);
      toshoSpinner.succeed('AnimeToSho data fetched successfully');
      
      if (!toshoData || !Array.isArray(toshoData) || toshoData.length === 0) {
        logger.error('No episodes found in AnimeToSho RSS feed');
        process.exit(1);
      }
      
      const firstEpisode = toshoData[0];
      logger.info(`Found episode: ${chalk.cyan(firstEpisode.title)}`);
      logger.info(`AniDB ID: ${chalk.yellow(firstEpisode.anidb_aid)}`);
      logger.info(`Episode ID: ${chalk.yellow(firstEpisode.anidb_eid)}`);
      logger.info(`Seeders: ${chalk.green(firstEpisode.seeders)} | Leechers: ${chalk.red(firstEpisode.leechers)}`);
      logger.info(`Size: ${chalk.blue((firstEpisode.total_size / 1024 / 1024 / 1024).toFixed(2) + ' GB')}`);
      logger.separator();
      
      if (!firstEpisode.anidb_aid) {
        logger.error('No AniDB ID found for this episode');
        process.exit(1);
      }
      
      const anizipSpinner = ora('Fetching anime data from ani.zip...').start();
      const anizipUrl = `https://api.ani.zip/mappings?anidb_id=${firstEpisode.anidb_aid}`;
      
      const anizipData = await fetchWithRetry(anizipUrl);
      anizipSpinner.succeed('Ani.zip data fetched successfully');
      
      if (!anizipData || !anizipData.mappings || !anizipData.mappings.anilist_id) {
        logger.error('No AniList ID found in ani.zip mapping');
        process.exit(1);
      }
      
      logger.info(`Anime Title: ${chalk.cyan(anizipData.titles?.en || anizipData.titles?.['x-jat'] || anizipData.titles?.ja || 'Unknown')}`);
      logger.info(`Japanese Title: ${chalk.cyan(anizipData.titles?.ja || 'Unknown')}`);
      logger.info(`Total Episodes: ${chalk.yellow(anizipData.episodeCount)}`);
      logger.info(`AniList ID: ${chalk.yellow(anizipData.mappings.anilist_id)}`);
      logger.info(`MAL ID: ${chalk.yellow(anizipData.mappings.mal_id)}`);
      
      const episodeMatch = Object.values(anizipData.episodes || {}).find(ep => 
        ep.anidbEid === firstEpisode.anidb_eid
      );
      
      if (episodeMatch) {
        logger.info(`Episode ${chalk.green(episodeMatch.episode)}: ${chalk.cyan(episodeMatch.title?.en || episodeMatch.title?.['x-jat'] || episodeMatch.title?.ja || 'Unknown')}`);
        logger.info(`Air Date: ${chalk.blue(episodeMatch.airdate)}`);
        logger.info(`Duration: ${chalk.blue(episodeMatch.length + ' minutes')}`);
        logger.info(`Rating: ${chalk.yellow(episodeMatch.rating)}`);
      }
      
      logger.separator();
      
      const anitorrentSpinner = ora('Fetching detailed anime info from anitorrent.com...').start();
      const anitorrentUrl = `https://api.anitorrent.com/anime/list/${anizipData.mappings.anilist_id}`;
      
      const anitorrentData = await fetchWithRetry(anitorrentUrl);
      anitorrentSpinner.succeed('Anitorrent data fetched successfully');
      
      logger.header('Complete Episode Summary');
      logger.info(`Title: ${chalk.cyan(anitorrentData.title?.romaji || anitorrentData.title?.english || 'Unknown')}`);
      logger.info(`English Title: ${chalk.cyan(anitorrentData.title?.english || 'Not available')}`);
      logger.info(`Native Title: ${chalk.cyan(anitorrentData.title?.native || 'Unknown')}`);
      logger.info(`Season: ${chalk.blue(anitorrentData.season)} ${chalk.blue(anitorrentData.seasonYear)}`);
      logger.info(`Format: ${chalk.blue(anitorrentData.format)}`);
      logger.info(`Status: ${chalk.green(anitorrentData.status)}`);
      logger.info(`Episodes: ${chalk.yellow(anitorrentData.episodes)}`);
      logger.info(`Genres: ${chalk.magenta(anitorrentData.genres?.join(', ') || 'Unknown')}`);
      
      if (anitorrentData.description) {
        logger.info(`Description: ${chalk.gray(anitorrentData.description)}`);
      }
      
      if (anitorrentData.nextAiringEpisode) {
        const nextAirDate = new Date(anitorrentData.nextAiringEpisode.airingAt * 1000);
        logger.info(`Next Episode: ${chalk.green(anitorrentData.nextAiringEpisode.episode)} on ${chalk.blue(nextAirDate.toLocaleDateString())}`);
      }
      
      if (anitorrentData.trailer?.id) {
        logger.info(`Trailer: ${chalk.blue(`https://www.youtube.com/watch?v=${anitorrentData.trailer.id}`)}`);
      }
      
      logger.separator();
      logger.info(`Torrent File: ${chalk.cyan(firstEpisode.title)}`);
      logger.info(`Direct Download: ${chalk.blue(firstEpisode.torrent_url)}`);
      
      if (options.upload) {
        logger.separator();
        logger.header('Starting Upload Process');
        
        const config = new ConfigManager();
        config.validateRequired();
        
        const defaults = config.getDefaults();
        
        const channelId = options.channel ? parseInt(options.channel) : await config.getDefaultChannelId();
        const privacy = options.privacy ? parseInt(options.privacy) : defaults.privacy;
        const videoPassword = options.password || defaults.videoPassword;
        const maxWaitMinutes = parseInt(options.wait);
        const keepR2File = options.keepR2;
        const animeId = options.animeId ? parseInt(options.animeId) : anizipData.mappings.anilist_id;
        
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

        logger.info(`Channel ID: ${channelId}`);
        logger.info(`Privacy: ${privacy}`);
        logger.info(`Keep R2 file: ${keepR2File ? 'Yes' : 'No'}`);
        logger.info(`Max wait time: ${maxWaitMinutes} minutes`);
        if (subtitleTrack !== null) {
          logger.info(`Subtitle track: ${subtitleTrack}`);
        } else {
          logger.info('Subtitle track: Auto-detect Spanish Latino');
        }
        logger.info(`Anime ID: ${animeId}`);
        logger.separator();

        const uploadService = new UploadService(config, logger);
        let torrentService = null;
        let fileInfo = null;

        try {
          const downloadResult = await uploadService.downloadFromTorrent(firstEpisode.torrent_url, logger);
          fileInfo = downloadResult.fileInfo;
          torrentService = downloadResult.torrentService;

          const uploadOptions = {
            channelId,
            privacy,
            videoPassword,
            maxWaitMinutes,
            keepR2File,
            animeId,
            subtitleTrack,
            useTitle: options.useTitle
          };

          logger.header(`Processing: ${fileInfo.fileName}`);
          
          const result = await uploadService.processFileUpload(fileInfo, uploadOptions);
          
          await uploadService.cleanupTorrentFile(fileInfo, torrentService);

          logger.success('✅ Upload completed successfully!');
          logger.separator();
          logger.info(`Video ID: ${result.video.id}`);
          logger.info(`Watch URL: ${result.video.url}`);
          logger.info(`Embed URL: ${result.video.url.replace('/w/', '/videos/embed/')}`);
          if (result.keepR2File) {
            logger.info(`R2 File: ${result.videoUrl}`);
          } else {
            logger.info(`R2 File: Deleted`);
          }
          
        } catch (error) {
          logger.error(`Upload failed: ${error.message}`);
          
          if (fileInfo && torrentService) {
            try {
              await uploadService.cleanupTorrentFile(fileInfo, torrentService);
            } catch (cleanupError) {
              logger.warning(`Failed to cleanup torrent file: ${cleanupError.message}`);
            }
          }
          
          if (options.debug) {
            console.error(error);
          }
          process.exit(1);
        }
      } else {
        logger.success('RSS test completed successfully!');
      }
      
    } catch (error) {
      logger.error(`RSS test failed: ${error.message}`);
      if (options.debug) {
        console.error(error);
      }
      process.exit(1);
    }
  });

rssCommand
  .command('auto')
  .description('Automatically download and upload latest episodes from RSS feed (runs continuously)')
  .option('--debug, -d', 'debug output')
  .option('--quiet, -q', 'quiet mode')
  .option('--limit <number>', 'maximum number of episodes to process per check', '25')
  .option('--interval <minutes>', 'check interval in minutes', '2')
  .option('--channel <id>', 'PeerTube channel ID')
  .option('--privacy <level>', 'privacy level (1-5)')
  .option('--password <password>', 'video password')
  .option('--wait <minutes>', 'max wait time for processing', '120')
  .option('--keep-r2', 'keep file in R2 after import')
  .option('--track <number>', 'subtitle track number for extraction')
  .option('--use-title', 'use the title of the video for the upload name')
  .option('--dry-run', 'show what would be processed without downloading (single run)')
  .option('--single-run', 'run once instead of continuously')
  .option('--kill-existing', 'kill existing torrent processes before starting')
  .option('--clean-downloads', 'clean existing files from download directory before starting')
  .action(async (options) => {
    const logger = new Logger({ 
      verbose: options.debug || false,
      quiet: options.quiet || false
    });

    try {
      const config = new ConfigManager();
      config.validateRequired();
      
      const anitorrentService = new AniTorrentService(config);
      const defaults = config.getDefaults();
      
      const channelId = options.channel ? parseInt(options.channel) : await config.getDefaultChannelId();
      const privacy = options.privacy ? parseInt(options.privacy) : defaults.privacy;
      const videoPassword = options.password || defaults.videoPassword;
      const maxWaitMinutes = parseInt(options.wait);
      const keepR2File = options.keepR2;
      const episodeLimit = parseInt(options.limit);
      const checkInterval = parseInt(options.interval) * 60 * 1000;
      const isContinuous = !options.singleRun && !options.dryRun;
      
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

      if (options.killExisting) {
        logger.info('🔄 Cleaning up existing torrent processes...');
        await TorrentService.killExistingProcesses();
      }

      if (options.cleanDownloads) {
        logger.info('🧹 Cleaning existing download files...');
        const tempTorrentService = new TorrentService({ logger });
        await tempTorrentService.cleanupExistingFiles();
      }

      logger.header('RSS Auto Download & Upload');
      logger.info(`Episode limit per check: ${episodeLimit}`);
      logger.info(`Channel ID: ${channelId}`);
      logger.info(`Privacy: ${privacy}`);
      logger.info(`Keep R2 file: ${keepR2File ? 'Yes' : 'No'}`);
      logger.info(`Max wait time: ${maxWaitMinutes} minutes`);
      if (subtitleTrack !== null) {
        logger.info(`Subtitle track: ${subtitleTrack}`);
      } else {
        logger.info('Subtitle track: Auto-detect Spanish Latino');
      }
      
      if (options.dryRun) {
        logger.info('Mode: Dry run (single check)');
      } else if (isContinuous) {
        logger.info(`Mode: Continuous monitoring (every ${options.interval} minutes)`);
      } else {
        logger.info('Mode: Single run');
      }
      logger.separator();

      const uploadService = new UploadService(config, logger);
      let lastTorrentService = null;
      let totalProcessed = 0;
      let totalSuccessful = 0;
      let totalFailed = 0;
      let runCount = 0;

      const processEpisodes = async () => {
        runCount++;
        const runStartTime = new Date();
        
        logger.step('🔄', `Check #${runCount} - ${runStartTime.toLocaleString()}`);
        
        try {
          const toshoSpinner = ora('Fetching from AnimeToSho RSS...').start();
          
          const toshoData = await fetchWithRetry(toshoUrl);
          toshoSpinner.succeed('AnimeToSho data fetched successfully');
          
          if (!toshoData || !Array.isArray(toshoData) || toshoData.length === 0) {
            logger.info('No episodes found in AnimeToSho RSS feed');
            return { processed: 0, successful: 0, failed: 0 };
          }
          
          const latestEpisodes = toshoData.slice(0, episodeLimit);
          logger.info(`Found ${latestEpisodes.length} episodes in RSS`);
          
          const filterSpinner = ora('Filtering duplicate episodes...').start();
          const filteredEpisodes = await filterDuplicateEpisodes(latestEpisodes, logger);
          filterSpinner.succeed(`Filtered to ${filteredEpisodes.length} unique episodes`);
          
          const checkSpinner = ora('Checking for existing episodes...').start();
          const episodesToProcess = [];
          
          for (const episode of filteredEpisodes) {
            const exists = await checkEpisodeExists(episode, anitorrentService, logger);
            if (!exists) {
              episodesToProcess.push(episode);
            } else {
              logger.verbose(`Episode already exists: ${episode.title}`);
            }
          }
          
          checkSpinner.succeed(`Found ${episodesToProcess.length} new episodes to process`);
          
          if (episodesToProcess.length === 0) {
            logger.info('No new episodes to process');
            return { processed: 0, successful: 0, failed: 0 };
          }

          if (options.dryRun) {
            logger.header('Episodes to Process (Dry Run)');
            
            for (let index = 0; index < episodesToProcess.length; index++) {
              const episode = episodesToProcess[index];
              logger.info(`${index + 1}. ${chalk.cyan(episode.title)}`);
              logger.info(`   Size: ${chalk.blue((episode.total_size / 1024 / 1024 / 1024).toFixed(2) + ' GB')}`);
              logger.info(`   Seeders: ${chalk.green(episode.seeders)} | Leechers: ${chalk.red(episode.leechers)}`);
              
              try {
                const anizipUrl = `https://api.ani.zip/mappings?anidb_id=${episode.anidb_aid}`;
                const anizipData = await fetchWithRetry(anizipUrl);
                
                const anilistId = anizipData.mappings.anilist_id;
                const animeTitle = anizipData.titles?.en || anizipData.titles?.['x-jat'] || anizipData.titles?.ja || 'Unknown';
                
                const episodeMatch = Object.values(anizipData.episodes || {}).find(ep => 
                  ep.anidbEid === episode.anidb_eid
                );
                
                const episodeNumber = episodeMatch ? episodeMatch.episode : 'Unknown';
                
                const parsed = await anitomy(episode.title);
                const anitomyEpisode = parsed.episode_number || 'Unknown';
                
                logger.info(`   AniList ID: ${chalk.yellow(anilistId)}`);
                logger.info(`   Anime Title: ${chalk.magenta(animeTitle)}`);
                logger.info(`   Episode Number: ${chalk.blue(episodeNumber)}`);
                logger.info(`   Anitomy Episode: ${chalk.cyan(anitomyEpisode)}`);
              } catch (error) {
                logger.info(`   Metadata: ${chalk.red('Error fetching data')}`);
              }
              
              logger.separator();
            }
            
            logger.success('Dry run completed');
            return { processed: episodesToProcess.length, successful: 0, failed: 0 };
          }

          logger.header('Processing Episodes');
          
          let successCount = 0;
          let errorCount = 0;
          
          for (let i = 0; i < episodesToProcess.length; i++) {
            const episode = episodesToProcess[i];
            
            logger.step(`📥 [${i + 1}/${episodesToProcess.length}]`, `Processing: ${episode.title}`);
            logger.info(`Size: ${chalk.blue((episode.total_size / 1024 / 1024 / 1024).toFixed(2) + ' GB')}`);
            logger.info(`Seeders: ${chalk.green(episode.seeders)} | Leechers: ${chalk.red(episode.leechers)}`);
            
            let torrentService = null;
            let fileInfo = null;
            
            try {
              const anizipUrl = `https://api.ani.zip/mappings?anidb_id=${episode.anidb_aid}`;
              const anizipData = await fetchWithRetry(anizipUrl);
              
              if (!anizipData || !anizipData.mappings || !anizipData.mappings.anilist_id) {
                throw new Error('No AniList ID found in ani.zip mapping');
              }
              
              const animeId = anizipData.mappings.anilist_id;
              
              const downloadResult = await uploadService.downloadFromTorrent(
                episode.torrent_url, 
                logger, 
                { keepSeeding: true }
              );
              
              fileInfo = downloadResult.fileInfo;
              torrentService = downloadResult.torrentService;
              lastTorrentService = torrentService;

              const uploadOptions = {
                channelId,
                privacy,
                videoPassword,
                maxWaitMinutes,
                keepR2File,
                animeId,
                subtitleTrack,
                useTitle: options.useTitle
              };
              
              const result = await uploadService.processFileUpload(fileInfo, uploadOptions);
              
              await uploadService.cleanupTorrentFile(fileInfo, torrentService, false);

              logger.success(`✅ Episode ${i + 1} completed successfully!`);
              logger.info(`Video ID: ${result.video.id}`);
              logger.info(`Watch URL: ${result.video.url}`);
              logger.info(`Embed URL: ${result.video.url.replace('/w/', '/videos/embed/')}`);
              
              successCount++;
              
            } catch (error) {
              logger.error(`❌ Episode ${i + 1} failed: ${error.message}`);
              
              if (fileInfo && torrentService) {
                try {
                  await uploadService.cleanupTorrentFile(fileInfo, torrentService, false);
                } catch (cleanupError) {
                  logger.warning(`Failed to cleanup torrent file: ${cleanupError.message}`);
                }
              }
              
              errorCount++;
              
              if (error.message.includes('ENOSPC') || error.message.includes('disk space')) {
                logger.error('🚨 Disk space issue detected. Cleaning up download directory...');
                
                if (lastTorrentService) {
                  try {
                    await lastTorrentService.cleanupDownloadDirectory();
                    logger.info('Download directory cleaned up');
                  } catch (cleanupError) {
                    logger.warning(`Failed to cleanup download directory: ${cleanupError.message}`);
                  }
                }
                
                logger.warning('Stopping processing due to disk space issues');
                break;
              }
              
              if (options.debug) {
                console.error(error);
              }
            }
            
            logger.separator();
          }

          return { processed: episodesToProcess.length, successful: successCount, failed: errorCount };
          
        } catch (error) {
          logger.error(`Check #${runCount} failed: ${error.message}`);
          if (options.debug) {
            console.error(error);
          }
          return { processed: 0, successful: 0, failed: 0 };
        }
      };

      // Handle graceful shutdown
      let isShuttingDown = false;
      const shutdown = () => {
        if (!isShuttingDown) {
          isShuttingDown = true;
          logger.info('\n🛑 Shutting down gracefully...');
          
          if (lastTorrentService) {
            const seedingStatus = lastTorrentService.getSeedingStatus();
            if (seedingStatus.length > 0) {
              logger.info(`Currently seeding ${seedingStatus.length} torrents - they will continue in background`);
            }
          }
          
          logger.header('Final Summary');
          logger.info(`Total checks performed: ${runCount}`);
          logger.info(`Total episodes processed: ${totalProcessed}`);
          logger.info(`Total successful uploads: ${chalk.green(totalSuccessful)}`);
          logger.info(`Total failed uploads: ${chalk.red(totalFailed)}`);
          logger.success('RSS auto monitoring stopped');
          
          process.exit(0);
        }
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);

      // Main execution
      if (options.dryRun || options.singleRun) {
        // Single run mode
        const result = await processEpisodes();
        totalProcessed += result.processed;
        totalSuccessful += result.successful;
        totalFailed += result.failed;
        
                  if (lastTorrentService) {
            const seedingStatus = lastTorrentService.getSeedingStatus();
            const seedingStats = lastTorrentService.getSeedingStats();
            
            if (seedingStatus.length > 0) {
              logger.info(`Currently seeding: ${chalk.blue(seedingStats.totalFiles)}/${chalk.blue(seedingStats.maxFiles)} torrents`);
              logger.info(`Total disk usage: ${chalk.white(lastTorrentService.formatBytes(seedingStats.totalSize))}`);
              logger.info(`Total uploaded: ${chalk.green(lastTorrentService.formatBytes(seedingStats.totalUploaded))}`);
              logger.info(`Average ratio: ${chalk.yellow(seedingStats.avgRatio.toFixed(2))}`);
              logger.separator();
              
              logger.info('Seeding Status:');
              seedingStatus.forEach((torrent, index) => {
                logger.info(`${index + 1}. ${chalk.cyan(torrent.fileName)}`);
                logger.info(`   Hash: ${chalk.gray(torrent.hash.substring(0, 16))}...`);
                logger.info(`   Ratio: ${chalk.yellow(torrent.ratio.toFixed(2))}`);
                logger.info(`   Uploaded: ${chalk.green(lastTorrentService.formatBytes(torrent.uploaded))}`);
                logger.info(`   Downloaded: ${chalk.blue(lastTorrentService.formatBytes(torrent.downloaded))}`);
                if (torrent.fileSize) {
                  logger.info(`   File Size: ${chalk.white(lastTorrentService.formatBytes(torrent.fileSize))}`);
                }
                logger.info(`   Added: ${chalk.blue(torrent.addedAt.toLocaleString())}`);
              });
              logger.separator();
              
              logger.info('📁 Seeding Management:');
              logger.info('• Physical files are kept on disk for seeding');
              logger.info('• Maximum concurrent seeding: 10 torrents');
              logger.info('• When limit exceeded: oldest torrents are stopped and files deleted');
              logger.info('• Files remain available for sharing until replaced by newer downloads');
            }
          }
        
        logger.success(options.dryRun ? 'Dry run completed!' : 'Single run completed!');
      } else {
        // Continuous monitoring mode
        logger.info('🚀 Starting continuous monitoring...');
        logger.info('Press Ctrl+C to stop gracefully');
        logger.separator();
        
        while (!isShuttingDown) {
          const result = await processEpisodes();
          totalProcessed += result.processed;
          totalSuccessful += result.successful;
          totalFailed += result.failed;
          
          if (result.processed > 0) {
            logger.info(`Session totals: ${totalProcessed} processed, ${chalk.green(totalSuccessful)} successful, ${chalk.red(totalFailed)} failed`);
            
            if (lastTorrentService) {
              const seedingStats = lastTorrentService.getSeedingStats();
              if (seedingStats.totalFiles > 0) {
                logger.info(`Currently seeding: ${chalk.blue(seedingStats.totalFiles)}/${chalk.blue(seedingStats.maxFiles)} torrents (${chalk.white(lastTorrentService.formatBytes(seedingStats.totalSize))} total)`);
                
                if (options.debug) {
                  const seedingStatus = lastTorrentService.getSeedingStatus();
                  logger.info('📁 Active seeding files:');
                  seedingStatus.forEach((torrent, index) => {
                    logger.info(`   ${index + 1}. ${chalk.cyan(torrent.fileName)}`);
                    logger.info(`      Ratio: ${chalk.yellow(torrent.ratio.toFixed(2))} | Uploaded: ${chalk.green(lastTorrentService.formatBytes(torrent.uploaded))}`);
                  });
                }
              }
            }
          }
          
          if (!isShuttingDown) {
            const nextCheck = new Date(Date.now() + checkInterval);
            logger.info(`⏰ Next check in ${options.interval} minutes (${nextCheck.toLocaleTimeString()})`);
            logger.separator();
            
            await new Promise(resolve => setTimeout(resolve, checkInterval));
          }
        }
      }
      
    } catch (error) {
      logger.error(`RSS auto processing failed: ${error.message}`);
      if (options.debug) {
        console.error(error);
      }
      process.exit(1);
    }
  });

rssCommand
  .command('status')
  .description('Show seeding status and manage active torrents')
  .option('--debug, -d', 'debug output')
  .option('--quiet, -q', 'quiet mode')
  .option('--stop <hash>', 'stop seeding specific torrent by hash')
  .option('--stop-all', 'stop seeding all torrents')
  .action(async (options) => {
    const logger = new Logger({ 
      verbose: options.debug || false,
      quiet: options.quiet || false
    });

    try {
      logger.header('Torrent Seeding Status');
      
      const config = new ConfigManager();
      const uploadService = new UploadService(config, logger);
      
      logger.info('Note: Seeding status is only available during active RSS auto sessions');
      logger.info('To view current seeding status, run this command during an active RSS auto process');
      
      if (options.stopAll) {
        logger.info('Stop-all functionality requires active torrent service instance');
        logger.warning('This feature is only available during active RSS auto sessions');
      }
      
      if (options.stop) {
        logger.info(`Stop torrent ${options.stop} functionality requires active torrent service instance`);
        logger.warning('This feature is only available during active RSS auto sessions');
      }
      
      logger.success('For real-time seeding management, use the RSS auto command with debug mode');
      
    } catch (error) {
      logger.error(`Status check failed: ${error.message}`);
      if (options.debug) {
        console.error(error);
      }
      process.exit(1);
    }
  });

module.exports = rssCommand; 