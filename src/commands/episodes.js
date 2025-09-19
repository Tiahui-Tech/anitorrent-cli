const { Command } = require('commander');
const chalk = require('chalk');
const ora = require('ora');
const Table = require('cli-table3');
const ConfigManager = require('../utils/config');
const { logger } = require('../utils/logger');
const PostgreSQLService = require('../services/postgresql-service');
const AniTorrentService = require('../services/anitorrent-service');
const AniZipService = require('../services/anizip-service');

const episodesCommand = new Command('episodes');
episodesCommand.description('Manage anime episodes in database');

episodesCommand
  .command('list')
  .description('List all episodes for an anime')
  .requiredOption('--anilist-id <id>', 'AniList ID of the anime')
  .option('--format <format>', 'Output format: table, json', 'table')
  .action(async (options) => {
    try {
      const config = new ConfigManager();
      
      if (!config.get('DB_HOST')) {
        logger.error('Database configuration not found. Please run "anitorrent config setup" first.');
        process.exit(1);
      }

      const dbConfig = config.getDatabaseConfig();
      const dbService = new PostgreSQLService(dbConfig);

      const spinner = ora('Fetching episodes from database...').start();

      try {
        const episodes = await dbService.getAnimeEpisodes(parseInt(options.anilistId));
        spinner.stop();

        if (episodes.length === 0) {
          logger.warning(`No episodes found for anime ID: ${options.anilistId}`);
          return;
        }

        if (options.format === 'json') {
          console.log(JSON.stringify(episodes, null, 2));
          return;
        }

        const table = new Table({
          head: [
            chalk.cyan('Episode'),
            chalk.cyan('PeerTube ID'),
            chalk.cyan('Short UUID'),
            chalk.cyan('Ready'),
            chalk.cyan('Duration'),
            chalk.cyan('Created')
          ],
          colWidths: [10, 12, 25, 8, 10, 20]
        });

        episodes.forEach(episode => {
          const readyStatus = episode.isReady ? chalk.green('✓') : chalk.red('✗');
          const duration = episode.duration ? `${Math.floor(episode.duration / 60)}:${(episode.duration % 60).toString().padStart(2, '0')}` : 'N/A';
          const createdAt = new Date(episode.createdAt).toLocaleDateString();

          table.push([
            episode.episodeNumber,
            episode.peertubeId || 'N/A',
            episode.shortUUID || 'N/A',
            readyStatus,
            duration,
            createdAt
          ]);
        });

        console.log(`\n${chalk.bold(`Episodes for Anime ID: ${options.anilistId}`)}`);
        console.log(`${chalk.gray(`Total episodes: ${episodes.length}`)}\n`);
        console.log(table.toString());

        const readyCount = episodes.filter(ep => ep.isReady).length;
        console.log(`\n${chalk.green(`Ready: ${readyCount}`)} | ${chalk.red(`Not Ready: ${episodes.length - readyCount}`)}`);

      } catch (error) {
        spinner.fail('Failed to fetch episodes');
        throw error;
      } finally {
        await dbService.close();
      }

    } catch (error) {
      logger.error(`Failed to list episodes: ${error.message}`);
      process.exit(1);
    }
  });

episodesCommand
  .command('get')
  .description('Get specific episode details')
  .requiredOption('--anilist-id <id>', 'AniList ID of the anime')
  .requiredOption('--episode <number>', 'Episode number')
  .option('--format <format>', 'Output format: table, json', 'table')
  .action(async (options) => {
    try {
      const config = new ConfigManager();
      
      if (!config.get('DB_HOST')) {
        logger.error('Database configuration not found. Please run "anitorrent config setup" first.');
        process.exit(1);
      }

      const dbConfig = config.getDatabaseConfig();
      const dbService = new PostgreSQLService(dbConfig);

      const spinner = ora('Fetching episode from database...').start();

      try {
        const episode = await dbService.getEpisodeByNumber(parseInt(options.anilistId), parseInt(options.episode));
        spinner.stop();

        if (!episode) {
          logger.warning(`Episode ${options.episode} not found for anime ID: ${options.anilistId}`);
          return;
        }

        if (options.format === 'json') {
          console.log(JSON.stringify(episode, null, 2));
          return;
        }

        const table = new Table({
          head: [chalk.cyan('Property'), chalk.cyan('Value')],
          colWidths: [20, 60]
        });

        const readyStatus = episode.isReady ? chalk.green('Ready') : chalk.red('Not Ready');
        const duration = episode.duration ? `${Math.floor(episode.duration / 60)}:${(episode.duration % 60).toString().padStart(2, '0')}` : 'N/A';

        table.push(
          ['ID', episode.id],
          ['AniList ID', episode.idAnilist],
          ['Episode Number', episode.episodeNumber],
          ['PeerTube ID', episode.peertubeId || 'N/A'],
          ['UUID', episode.uuid || 'N/A'],
          ['Short UUID', episode.shortUUID || 'N/A'],
          ['Password', episode.password ? '***' : 'None'],
          ['Title', episode.title ? JSON.stringify(episode.title) : 'None'],
          ['Embed URL', episode.embedUrl || 'N/A'],
          ['Thumbnail URL', episode.thumbnailUrl || 'N/A'],
          ['Description', episode.description || 'None'],
          ['Duration', duration],
          ['Status', readyStatus],
          ['Created', new Date(episode.createdAt).toLocaleString()],
          ['Updated', new Date(episode.updatedAt).toLocaleString()]
        );

        console.log(`\n${chalk.bold(`Episode ${episode.episodeNumber} - Anime ID: ${episode.idAnilist}`)}\n`);
        console.log(table.toString());

      } catch (error) {
        spinner.fail('Failed to fetch episode');
        throw error;
      } finally {
        await dbService.close();
      }

    } catch (error) {
      logger.error(`Failed to get episode: ${error.message}`);
      process.exit(1);
    }
  });

episodesCommand
  .command('stats')
  .description('Show statistics for anime episodes')
  .requiredOption('--anilist-id <id>', 'AniList ID of the anime')
  .action(async (options) => {
    try {
      const config = new ConfigManager();
      
      if (!config.get('DB_HOST')) {
        logger.error('Database configuration not found. Please run "anitorrent config setup" first.');
        process.exit(1);
      }

      const dbConfig = config.getDatabaseConfig();
      const dbService = new PostgreSQLService(dbConfig);

      const spinner = ora('Calculating statistics...').start();

      try {
        const episodes = await dbService.getAnimeEpisodes(parseInt(options.anilistId));
        spinner.stop();

        if (episodes.length === 0) {
          logger.warning(`No episodes found for anime ID: ${options.anilistId}`);
          return;
        }

        const readyCount = episodes.filter(ep => ep.isReady).length;
        const notReadyCount = episodes.length - readyCount;
        const totalDuration = episodes.reduce((sum, ep) => sum + (ep.duration || 0), 0);
        const avgDuration = totalDuration / episodes.length;

        const table = new Table({
          head: [chalk.cyan('Statistic'), chalk.cyan('Value')],
          colWidths: [25, 25]
        });

        table.push(
          ['Total Episodes', episodes.length],
          ['Ready Episodes', chalk.green(readyCount)],
          ['Not Ready Episodes', chalk.red(notReadyCount)],
          ['Completion Rate', `${((readyCount / episodes.length) * 100).toFixed(1)}%`],
          ['Total Duration', `${Math.floor(totalDuration / 60)}:${(totalDuration % 60).toString().padStart(2, '0')}`],
          ['Average Duration', `${Math.floor(avgDuration / 60)}:${(avgDuration % 60).toString().padStart(2, '0')}`]
        );

        console.log(`\n${chalk.bold(`Statistics for Anime ID: ${options.anilistId}`)}\n`);
        console.log(table.toString());

      } catch (error) {
        spinner.fail('Failed to calculate statistics');
        throw error;
      } finally {
        await dbService.close();
      }

    } catch (error) {
      logger.error(`Failed to get statistics: ${error.message}`);
      process.exit(1);
    }
  });

episodesCommand
  .command('check-subs')
  .description('Check episodes without Spanish Latino subtitles')
  .option('--anilist-id <id>', 'AniList ID of specific anime (if not provided, checks latest episodes)')
  .option('--format <format>', 'Output format: table, json', 'table')
  .option('--limit <number>', 'Maximum number of episodes to check', '100')
  .action(async (options) => {
    try {
      const config = new ConfigManager();
      
      if (!config.get('DB_HOST')) {
        logger.error('Database configuration not found. Please run "anitorrent config setup" first.');
        process.exit(1);
      }

      if (!config.get('ANITORRENT_API_KEY')) {
        logger.error('AniTorrent API key not found. Please run "anitorrent config setup" first.');
        process.exit(1);
      }

      const dbConfig = config.getDatabaseConfig();
      const dbService = new PostgreSQLService(dbConfig);
      const aniTorrentService = new AniTorrentService(config);

      const spinner = ora('Checking episodes for Spanish Latino subtitles...').start();

      try {
        const limit = parseInt(options.limit);
        let allEpisodes;
        let isSpecificAnime = false;
        
        if (options.anilistId) {
          allEpisodes = await dbService.getAnimeEpisodes(parseInt(options.anilistId));
          isSpecificAnime = true;
          
          if (allEpisodes.length === 0) {
            spinner.fail('No episodes found');
            logger.warning(`No episodes found for anime ID: ${options.anilistId}`);
            return;
          }
        } else {
          allEpisodes = await dbService.getLatestEpisodes(limit * 2);
          
          if (allEpisodes.length === 0) {
            spinner.fail('No episodes found');
            logger.warning('No episodes found in database');
            return;
          }
          
          spinner.text = `Checking latest ${Math.min(limit, allEpisodes.length)} episodes for Spanish Latino subtitles...`;
        }

        const episodes = allEpisodes.slice(0, limit);
        
        if (isSpecificAnime && allEpisodes.length > limit) {
          spinner.text = `Checking first ${limit} of ${allEpisodes.length} episodes for Spanish Latino subtitles...`;
        }

        const episodesWithoutLatino = [];
        let checkedCount = 0;
        let processedCount = 0;
        const totalToProcess = episodes.length;

        for (const episode of episodes) {
          processedCount++;
          const percentage = Math.round((processedCount / totalToProcess) * 100);
          
          spinner.text = `Checking episode ${processedCount}/${totalToProcess} (${percentage}%) - Episode ${episode.episodeNumber} for Spanish Latino subtitles...`;
          
          if (!episode.shortUUID) {
            episodesWithoutLatino.push({
              ...episode,
              hasLatino: false,
              totalSubs: 0,
              reason: 'No shortUUID',
              animeTitle: episode.animeTitle || 'Unknown Anime'
            });
            continue;
          }

          try {
            const subtitles = await aniTorrentService.getSubtitles(episode.shortUUID);
            const hasLatino = subtitles.some(sub => sub.language === 'default');
            
            if (!hasLatino) {
              episodesWithoutLatino.push({
                ...episode,
                hasLatino: false,
                totalSubs: subtitles.length,
                reason: 'No Latino subs',
                animeTitle: episode.animeTitle || 'Unknown Anime'
              });
            }
            
            checkedCount++;
          } catch (error) {
            episodesWithoutLatino.push({
              ...episode,
              hasLatino: false,
              totalSubs: 0,
              reason: `API Error: ${error.message}`,
              animeTitle: episode.animeTitle || 'Unknown Anime'
            });
          }
        }

        spinner.succeed(`Completed checking ${processedCount} episodes for Spanish Latino subtitles`);

        if (options.format === 'json') {
          console.log(JSON.stringify({
            mode: options.anilistId ? 'specific_anime' : 'latest_episodes',
            anilistId: options.anilistId ? parseInt(options.anilistId) : null,
            totalEpisodes: allEpisodes.length,
            episodesToCheck: episodes.length,
            checkedEpisodes: checkedCount,
            episodesWithoutLatino: episodesWithoutLatino.length,
            episodes: episodesWithoutLatino
          }, null, 2));
          return;
        }

        if (episodesWithoutLatino.length === 0) {
          console.log(`\n${chalk.bold.green('✓')} All checked episodes have Spanish Latino subtitles!`);
          
          if (options.anilistId) {
            const anime = await dbService.getAnimeById(parseInt(options.anilistId));
            let animeTitle = 'Unknown Anime';
            
            if (anime && anime.title) {
              try {
                const titleObj = typeof anime.title === 'string' ? JSON.parse(anime.title) : anime.title;
                animeTitle = titleObj.english || titleObj.romaji || titleObj.native || 'Unknown Anime';
              } catch (error) {
                animeTitle = anime.title.toString();
              }
            }
            
            console.log(`${chalk.gray(`Anime: ${animeTitle}`)}`);
          } else {
            console.log(`${chalk.gray(`Checked latest episodes from database`)}`);
          }
          
          console.log(`${chalk.gray(`Episodes checked: ${checkedCount}${allEpisodes.length > episodes.length ? ` of ${allEpisodes.length} total` : ''}`)}\n`);
          return;
        }

        const table = new Table({
          head: [
            chalk.cyan('Episode'),
            chalk.cyan('AniList ID'),
            chalk.cyan('Anime Title'),
            chalk.cyan('Latino Subs'),
            chalk.cyan('Total Subs'),
            chalk.cyan('Status')
          ],
          colWidths: [10, 12, 30, 12, 12, 20]
        });

        episodesWithoutLatino.forEach(episode => {
          const latinoStatus = episode.hasLatino ? chalk.green('✓') : chalk.red('✗');
          const subsCount = episode.totalSubs > 0 ? episode.totalSubs.toString() : '0';
          
          let displayTitle = 'Unknown Anime';
          
          if (options.anilistId) {
            if (episode.animeTitle) {
              try {
                const titleObj = typeof episode.animeTitle === 'string' ? JSON.parse(episode.animeTitle) : episode.animeTitle;
                displayTitle = titleObj.english || titleObj.romaji || titleObj.native || 'Unknown Anime';
              } catch (error) {
                displayTitle = episode.animeTitle.toString();
              }
            }
          } else {
            if (episode.animeTitle) {
              try {
                const titleObj = typeof episode.animeTitle === 'string' ? JSON.parse(episode.animeTitle) : episode.animeTitle;
                displayTitle = titleObj.english || titleObj.romaji || titleObj.native || 'Unknown Anime';
              } catch (error) {
                displayTitle = episode.animeTitle.toString();
              }
            }
          }
          
          table.push([
            episode.episodeNumber,
            episode.idAnilist,
            displayTitle.length > 25 ? displayTitle.substring(0, 22) + '...' : displayTitle,
            latinoStatus,
            subsCount,
            episode.reason || 'OK'
          ]);
        });

        console.log(`\n${chalk.bold(`Episodes without Spanish Latino subtitles`)}`);
        
        if (options.anilistId) {
          const anime = await dbService.getAnimeById(parseInt(options.anilistId));
          let animeTitle = 'Unknown Anime';
          
          if (anime && anime.title) {
            try {
              const titleObj = typeof anime.title === 'string' ? JSON.parse(anime.title) : anime.title;
              animeTitle = titleObj.english || titleObj.romaji || titleObj.native || 'Unknown Anime';
            } catch (error) {
              animeTitle = anime.title.toString();
            }
          }
          
          console.log(`${chalk.gray(`Anime: ${animeTitle}`)}`);
        } else {
          console.log(`${chalk.gray(`Latest episodes from database`)}`);
        }
        
        console.log(`${chalk.gray(`Total episodes: ${allEpisodes.length} | Checked: ${checkedCount} | Missing Latino subs: ${episodesWithoutLatino.length}`)}\n`);
        console.log(table.toString());

        const episodesWithLatino = checkedCount - episodesWithoutLatino.length;
        const summary = `\n${chalk.red(`Episodes missing Latino subs: ${episodesWithoutLatino.length}`)} | ${chalk.green(`Episodes with Latino subs: ${episodesWithLatino}`)}`;
        
        if (allEpisodes.length > episodes.length) {
          console.log(summary);
          if (options.anilistId) {
            console.log(`${chalk.yellow(`Note: Only checked first ${episodes.length} of ${allEpisodes.length} total episodes`)}`);
          } else {
            console.log(`${chalk.yellow(`Note: Checked ${episodes.length} latest episodes`)}`);
          }
        } else {
          console.log(summary);
        }

      } catch (error) {
        spinner.fail('Failed to check subtitles');
        throw error;
      } finally {
        await dbService.close();
      }

    } catch (error) {
      logger.error(`Failed to check subtitles: ${error.message}`);
      process.exit(1);
    }
  });

episodesCommand
  .command('update-thumbnails')
  .description('Update episode thumbnails using ani.zip API')
  .option('--limit <number>', 'Number of episodes to process', '50')
  .option('--format <format>', 'Output format: table, json', 'table')
  .action(async (options) => {
    try {
      const config = new ConfigManager();
      
      if (!config.get('DB_HOST')) {
        logger.error('Database configuration not found. Please run "anitorrent config setup" first.');
        process.exit(1);
      }

      const dbConfig = config.getDatabaseConfig();
      const dbService = new PostgreSQLService(dbConfig);
      const aniZipService = new AniZipService();

      const limit = parseInt(options.limit);
      const spinner = ora(`Fetching ${limit} episodes for thumbnail update...`).start();

      try {
        const episodesByAnilist = await dbService.getEpisodesForThumbnailUpdate(limit);
        const anilistIds = Object.keys(episodesByAnilist);
        
        if (anilistIds.length === 0) {
          spinner.fail('No episodes found');
          logger.warning('No episodes found in database');
          return;
        }

        spinner.succeed(`Found ${Object.values(episodesByAnilist).flat().length} episodes from ${anilistIds.length} anime series`);

        const results = [];
        let processedAnime = 0;
        let updatedEpisodes = 0;
        let skippedEpisodes = 0;
        let errorCount = 0;

        for (const anilistId of anilistIds) {
          processedAnime++;
          const episodes = episodesByAnilist[anilistId];
          const percentage = Math.round((processedAnime / anilistIds.length) * 100);
          
          const processingSpinner = ora(`Processing anime ${processedAnime}/${anilistIds.length} (${percentage}%) - AniList ID: ${anilistId}...`).start();

          try {
            const mappings = await aniZipService.getAnimeMappings(anilistId);
            
            if (!mappings) {
              processingSpinner.text = `Skipping anime ${anilistId} - No mappings found in ani.zip`;
              processingSpinner.succeed();
              
              episodes.forEach(episode => {
                results.push({
                  id: episode.id,
                  anilistId: parseInt(anilistId),
                  episodeNumber: episode.episodeNumber,
                  status: 'skipped',
                  reason: 'No ani.zip mappings',
                  oldThumbnail: episode.thumbnailUrl,
                  newThumbnail: null
                });
                skippedEpisodes++;
              });
              continue;
            }

            for (const episode of episodes) {
              const imageUrl = aniZipService.getEpisodeImageUrl(mappings, episode.episodeNumber);
              
              if (!imageUrl) {
                results.push({
                  id: episode.id,
                  anilistId: parseInt(anilistId),
                  episodeNumber: episode.episodeNumber,
                  status: 'skipped',
                  reason: 'No image in ani.zip',
                  oldThumbnail: episode.thumbnailUrl,
                  newThumbnail: null
                });
                skippedEpisodes++;
                continue;
              }

              if (episode.thumbnailUrl === imageUrl) {
                results.push({
                  id: episode.id,
                  anilistId: parseInt(anilistId),
                  episodeNumber: episode.episodeNumber,
                  status: 'skipped',
                  reason: 'Same URL',
                  oldThumbnail: episode.thumbnailUrl,
                  newThumbnail: imageUrl
                });
                skippedEpisodes++;
                continue;
              }

              try {
                await dbService.updateEpisode(episode.id, { thumbnailUrl: imageUrl });
                
                results.push({
                  id: episode.id,
                  anilistId: parseInt(anilistId),
                  episodeNumber: episode.episodeNumber,
                  status: 'updated',
                  reason: 'Success',
                  oldThumbnail: episode.thumbnailUrl,
                  newThumbnail: imageUrl
                });
                updatedEpisodes++;
              } catch (error) {
                results.push({
                  id: episode.id,
                  anilistId: parseInt(anilistId),
                  episodeNumber: episode.episodeNumber,
                  status: 'error',
                  reason: `DB Error: ${error.message}`,
                  oldThumbnail: episode.thumbnailUrl,
                  newThumbnail: imageUrl
                });
                errorCount++;
              }
            }

            processingSpinner.succeed(`Processed anime ${anilistId} - ${episodes.length} episodes`);

          } catch (error) {
            processingSpinner.fail(`Failed to process anime ${anilistId}`);
            
            episodes.forEach(episode => {
              results.push({
                id: episode.id,
                anilistId: parseInt(anilistId),
                episodeNumber: episode.episodeNumber,
                status: 'error',
                reason: `API Error: ${error.message}`,
                oldThumbnail: episode.thumbnailUrl,
                newThumbnail: null
              });
              errorCount++;
            });
          }
        }

        if (options.format === 'json') {
          console.log(JSON.stringify({
            totalEpisodes: results.length,
            updatedEpisodes,
            skippedEpisodes,
            errorCount,
            processedAnime: anilistIds.length,
            results
          }, null, 2));
          return;
        }

        console.log(`\n${chalk.bold('Thumbnail Update Results')}\n`);

        if (results.length === 0) {
          console.log(chalk.yellow('No episodes processed'));
          return;
        }

        const table = new Table({
          head: [
            chalk.cyan('AniList ID'),
            chalk.cyan('Episode'),
            chalk.cyan('Status'),
            chalk.cyan('Reason'),
            chalk.cyan('Updated')
          ],
          colWidths: [12, 10, 12, 25, 10]
        });

        results.forEach(result => {
          let statusColor = chalk.gray;
          let statusIcon = '○';
          
          if (result.status === 'updated') {
            statusColor = chalk.green;
            statusIcon = '✓';
          } else if (result.status === 'error') {
            statusColor = chalk.red;
            statusIcon = '✗';
          } else {
            statusColor = chalk.yellow;
            statusIcon = '-';
          }

          const hasUpdate = result.newThumbnail && result.oldThumbnail !== result.newThumbnail;

          table.push([
            result.anilistId,
            result.episodeNumber,
            statusColor(`${statusIcon} ${result.status}`),
            result.reason.length > 22 ? result.reason.substring(0, 19) + '...' : result.reason,
            hasUpdate ? chalk.green('Yes') : chalk.gray('No')
          ]);
        });

        console.log(table.toString());

        const summary = [
          chalk.green(`Updated: ${updatedEpisodes}`),
          chalk.yellow(`Skipped: ${skippedEpisodes}`),
          chalk.red(`Errors: ${errorCount}`)
        ].join(' | ');

        console.log(`\n${summary}`);
        console.log(`${chalk.gray(`Total episodes: ${results.length} | Anime processed: ${anilistIds.length}`)}`);

      } catch (error) {
        spinner.fail('Failed to update thumbnails');
        throw error;
      } finally {
        await dbService.close();
      }

    } catch (error) {
      logger.error(`Failed to update thumbnails: ${error.message}`);
      process.exit(1);
    }
  });

module.exports = episodesCommand;