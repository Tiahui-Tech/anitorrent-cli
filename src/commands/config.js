const { Command } = require('commander');
const inquirer = require('inquirer');
const chalk = require('chalk');
const ora = require('ora');
const ConfigManager = require('../utils/config');
const { logger } = require('../utils/logger');
const Validators = require('../utils/validators');
const PeerTubeService = require('../services/peertube-service');
const SystemCheck = require('../utils/system-check');

const configCommand = new Command('config');
configCommand.description('Configuration management');

configCommand
  .command('init')
  .description('Create configuration template file')
  .action(async () => {
    try {
      const config = new ConfigManager();
      
      if (await config.exists()) {
        const { overwrite } = await inquirer.prompt([{
          type: 'confirm',
          name: 'overwrite',
          message: 'Configuration already exists. Overwrite?',
          default: false
        }]);
        
        if (!overwrite) {
          logger.info('Operation cancelled');
          return;
        }
      }
      
      await config.createTemplate();
      logger.success('Configuration template created successfully');
      logger.info(`Configuration saved to: ${config.getConfigPath()}`);
      logger.info('Please run "anitorrent config setup" to configure your settings');
    } catch (error) {
      logger.error(`Failed to create configuration template: ${error.message}`);
      process.exit(1);
    }
  });

configCommand
  .command('setup')
  .description('Interactive configuration setup')
  .action(async () => {
    try {
      logger.header('AniTorrent CLI - Interactive Configuration');
      
      const config = new ConfigManager();
      const existingConfig = await config.exists();
      
      if (existingConfig) {
        logger.info('Existing configuration found. Checking for missing values...');
        logger.separator();
      }

      const needsValue = (key, defaultValues = []) => {
        const currentValue = config.get(key);
        if (!currentValue) return true;
        if (defaultValues.includes(currentValue)) return true;
        return false;
      };

      const r2Questions = [
        {
          type: 'input',
          name: 'R2_ACCESS_KEY_ID',
          message: 'R2 Access Key ID (required):',
          validate: input => input.trim() !== '' || 'Access Key ID is required',
          when: () => needsValue('R2_ACCESS_KEY_ID', ['your_access_key_id'])
        },
        {
          type: 'input',
          name: 'R2_SECRET_ACCESS_KEY',
          message: 'R2 Secret Access Key (required):',
          validate: input => input.trim() !== '' || 'Secret Access Key is required',
          when: () => needsValue('R2_SECRET_ACCESS_KEY', ['your_secret_access_key'])
        },
        {
          type: 'input',
          name: 'R2_ENDPOINT',
          message: 'R2 Endpoint URL (required):',
          validate: input => {
            if (!input.trim()) return 'Endpoint URL is required';
            if (!Validators.isValidUrl(input)) return 'Invalid URL format';
            return true;
          },
          when: () => needsValue('R2_ENDPOINT', ['https://your-account-id.r2.cloudflarestorage.com'])
        },
        {
          type: 'input',
          name: 'R2_BUCKET_NAME',
          message: 'R2 Bucket Name (required):',
          validate: input => input.trim() !== '' || 'Bucket name is required',
          when: () => needsValue('R2_BUCKET_NAME', ['your_bucket_name'])
        },
        {
          type: 'input',
          name: 'R2_PUBLIC_DOMAIN',
          message: 'R2 Public Domain (optional):',
          default: 'https://cdn.anitorrent.com',
          validate: input => {
            if (!input.trim()) return true;
            return Validators.isValidUrl(input) || 'Invalid URL format';
          },
          when: () => needsValue('R2_PUBLIC_DOMAIN') && !config.get('R2_PUBLIC_DOMAIN')
        }
      ];

             const r2Answers = await inquirer.prompt(r2Questions);

      const peertubeBaseQuestions = [
        {
          type: 'input',
          name: 'PEERTUBE_API_URL',
          message: 'PeerTube API URL (optional):',
          default: 'https://peertube.anitorrent.com/api/v1',
          validate: input => {
            if (!input.trim()) return true;
            return Validators.isValidUrl(input) || 'Invalid URL format';
          },
          when: () => needsValue('PEERTUBE_API_URL') && !config.get('PEERTUBE_API_URL')
        }
      ];

      const peertubeBaseAnswers = await inquirer.prompt(peertubeBaseQuestions);

      Object.entries({...r2Answers, ...peertubeBaseAnswers}).forEach(([key, value]) => {
        config.set(key, value);
      });

      let peertubeCredentials = {};
      let userInfo;
      let validCredentials = false;
      let needsPeertubeCredentials = needsValue('PEERTUBE_USERNAME', ['your_username']) || needsValue('PEERTUBE_PASSWORD', ['your_password']);

      if (needsPeertubeCredentials) {
        while (!validCredentials) {
          const credentialQuestions = [
            {
              type: 'input',
              name: 'PEERTUBE_USERNAME',
              message: 'PeerTube Username (required):',
              validate: input => input.trim() !== '' || 'Username is required',
              when: () => needsValue('PEERTUBE_USERNAME', ['your_username']),
              default: () => config.get('PEERTUBE_USERNAME') !== 'your_username' ? config.get('PEERTUBE_USERNAME') : undefined
            },
            {
              type: 'input',
              name: 'PEERTUBE_PASSWORD',
              message: 'PeerTube Password (required):',
              validate: input => input.trim() !== '' || 'Password is required',
              when: () => needsValue('PEERTUBE_PASSWORD', ['your_password'])
            }
          ];

          peertubeCredentials = await inquirer.prompt(credentialQuestions);

          const spinner = ora('Validating PeerTube credentials...').start();
          
          try {
            Object.entries(peertubeCredentials).forEach(([key, value]) => {
              config.set(key, value);
            });

            const peertubeService = new PeerTubeService(config.getPeerTubeConfig());
            userInfo = await peertubeService.getCurrentUser();
            validCredentials = true;
            spinner.succeed('Credentials validated successfully');
            
            logger.info(`Welcome ${userInfo.username}! (${userInfo.email})`);
            
          } catch (error) {
            spinner.fail('Invalid credentials');
            logger.error('Username or password is incorrect. Please try again.');
            validCredentials = false;
          }
        }
      } else {
        try {
          const peertubeService = new PeerTubeService(config.getPeerTubeConfig());
          userInfo = await peertubeService.getCurrentUser();
          logger.info(`Using existing credentials for ${userInfo.username}! (${userInfo.email})`);
        } catch (error) {
          logger.error('Existing PeerTube credentials are invalid. Please reconfigure.');
          process.exit(1);
        }
      }

      let channelAnswer = {};
      if (needsValue('DEFAULT_CHANNEL_ID', [''])) {
        if (userInfo.videoChannels && userInfo.videoChannels.length > 0) {
          const channelChoices = userInfo.videoChannels.map(channel => ({
            name: `${channel.displayName} (ID: ${channel.id})`,
            value: channel.id.toString()
          }));

          channelAnswer = await inquirer.prompt([
            {
              type: 'list',
              name: 'DEFAULT_CHANNEL_ID',
              message: 'Select default channel:',
              choices: channelChoices,
              default: channelChoices[0].value
            }
          ]);
        } else {
          logger.warning('No channels found for this user');
          channelAnswer = { DEFAULT_CHANNEL_ID: '' };
        }
      } else {
        logger.info(`Using existing channel ID: ${config.get('DEFAULT_CHANNEL_ID')}`);
      }

      const apiKeysQuestions = [
        {
          type: 'input',
          name: 'CLAUDE_API_KEY',
          message: 'Claude API Key (for AI translation, optional):',
          validate: input => {
            if (!input.trim()) return true;
            return input.trim().length > 10 || 'API key seems too short';
          },
          when: () => needsValue('CLAUDE_API_KEY', ['your_claude_api_key'])
        },
        {
          type: 'input',
          name: 'ANITORRENT_API_KEY',
          message: 'AniTorrent API Key (for api.anitorrent.com, optional):',
          validate: input => {
            if (!input.trim()) return true;
            return input.trim().length > 10 || 'API key seems too short';
          },
          when: () => needsValue('ANITORRENT_API_KEY', ['your_anitorrent_api_key'])
        }
      ];

      const apiKeysAnswers = await inquirer.prompt(apiKeysQuestions);

      const finalQuestions = [
        {
          type: 'list',
          name: 'DEFAULT_PRIVACY_LEVEL',
          message: 'Default Privacy Level:',
          choices: [
            { name: '1 - Public', value: '1' },
            { name: '2 - Unlisted', value: '2' },
            { name: '3 - Private', value: '3' },
            { name: '4 - Internal', value: '4' },
            { name: '5 - Password Protected', value: '5' }
          ],
          default: () => config.get('DEFAULT_PRIVACY_LEVEL') || '5',
          when: () => needsValue('DEFAULT_PRIVACY_LEVEL', ['5']) && !config.get('DEFAULT_PRIVACY_LEVEL')
        },
        {
          type: 'input',
          name: 'DEFAULT_VIDEO_PASSWORD',
          message: 'Default Video Password (optional):',
          default: () => config.get('DEFAULT_VIDEO_PASSWORD') || '12345',
          when: () => needsValue('DEFAULT_VIDEO_PASSWORD', ['12345', 'AniTorrent108']) && !config.get('DEFAULT_VIDEO_PASSWORD')
        }
      ];

      const finalAnswers = await inquirer.prompt(finalQuestions);

      Object.entries({...channelAnswer, ...apiKeysAnswers, ...finalAnswers}).forEach(([key, value]) => {
        config.set(key, value);
      });

      await config.saveConfig();
      
      const allAnswers = {...r2Answers, ...peertubeBaseAnswers, ...peertubeCredentials, ...channelAnswer, ...apiKeysAnswers, ...finalAnswers};
      const configuredKeys = Object.keys(allAnswers);
      
      logger.success('Configuration saved successfully');
      logger.info(`Configuration saved to: ${config.getConfigPath()}`);
      
      if (configuredKeys.length > 0) {
        logger.info(`Updated configurations: ${configuredKeys.join(', ')}`);
      } else {
        logger.info('All configurations were already set - no changes needed');
      }
      
      logger.info('Configuration completed successfully!');
      
    } catch (error) {
      logger.error(`Setup failed: ${error.message}`);
      process.exit(1);
    }
  });

configCommand
  .command('check')
  .description('Verify current configuration')
  .action(async () => {
    try {
      const config = new ConfigManager();
      
      if (!(await config.exists())) {
        logger.error('Configuration not found');
        logger.info('Run "anitorrent config init" or "anitorrent config setup" first');
        process.exit(1);
      }
      
      logger.info('Checking configuration...');
      
      try {
        config.validateRequired();
        logger.success('All required configuration variables are set');
      } catch (error) {
        logger.error(error.message);
        process.exit(1);
      }
      
      try {
        const r2Config = config.getR2Config();
        Validators.validateR2Config(r2Config);
        logger.success('R2 configuration is valid');
      } catch (error) {
        logger.error(`R2 configuration error: ${error.message}`);
        process.exit(1);
      }
      
      try {
        const peertubeConfig = config.getPeerTubeConfig();
        Validators.validatePeerTubeConfig(peertubeConfig);
        logger.success('PeerTube configuration is valid');
      } catch (error) {
        logger.error(`PeerTube configuration error: ${error.message}`);
        process.exit(1);
      }
      
      logger.success('Configuration check passed!');
      
    } catch (error) {
      logger.error(`Configuration check failed: ${error.message}`);
      process.exit(1);
    }
  });

configCommand
  .command('show')
  .description('Show current configuration (hides sensitive values)')
  .action(async () => {
    try {
      const config = new ConfigManager();
      
      if (!(await config.exists())) {
        logger.error('Configuration not found');
        logger.info('Run "anitorrent config init" or "anitorrent config setup" first');
        process.exit(1);
      }
      
      logger.info('Current Configuration:');
      logger.separator();
      logger.info(`Config file: ${config.getConfigPath()}`);
      logger.separator();
      
      const configData = config.showConfig(true);
      Object.entries(configData)
        .filter(([key]) => key.startsWith('R2_') || key.startsWith('PEERTUBE_') || key.startsWith('DEFAULT_') || key.startsWith('CLAUDE_') || key.startsWith('ANITORRENT_'))
        .forEach(([key, value]) => {
          logger.info(`${key}: ${value}`, 1);
        });
      
    } catch (error) {
      logger.error(`Failed to show configuration: ${error.message}`);
      process.exit(1);
    }
  });

configCommand
  .command('test')
  .description('Test connections to services')
  .action(async () => {
    try {
      const config = new ConfigManager();
      config.validateRequired();
      
      logger.header('Testing Service Connections');
      
      const systemCheck = new SystemCheck();
      const depsSpinner = ora('Checking system dependencies...').start();
      
      try {
        const dependencies = await systemCheck.checkAllDependencies();
        
        if (dependencies.allAvailable) {
          depsSpinner.succeed('All system dependencies are available');
        } else {
          depsSpinner.warn('Some system dependencies are missing');
          
          const report = systemCheck.generateInstallationReport(dependencies);
          
          for (const item of report) {
            logger.warning(`${item.tool} is not fully installed`);
            if (item.missing.length > 0) {
              logger.info(`Missing commands: ${item.missing.join(', ')}`, 1);
            }
            logger.info(`Install command: ${item.installCommand}`, 1);
            logger.separator();
          }
        }
      } catch (error) {
        depsSpinner.fail(`Dependency check failed: ${error.message}`);
      }
      
      const spinner = ora('Testing R2 connection...').start();
      try {
        const S3Service = require('../services/s3-service');
        const s3Service = new S3Service(config.getR2Config());
        spinner.succeed('R2 connection successful');
      } catch (error) {
        spinner.fail(`R2 connection failed: ${error.message}`);
      }
      
      const peertubeSpinner = ora('Testing PeerTube connection...').start();
      try {
        const peertubeService = new PeerTubeService(config.getPeerTubeConfig());
        await peertubeService.getValidAccessToken();
        peertubeSpinner.succeed('PeerTube connection successful');
      } catch (error) {
        peertubeSpinner.fail(`PeerTube connection failed: ${error.message}`);
      }

      const translationConfig = config.getTranslationConfig();
      if (translationConfig.apiKey && translationConfig.apiKey !== 'your_claude_api_key') {
        const claudeSpinner = ora('Testing Claude API connection...').start();
        try {
          const TranslationService = require('../services/translation-service');
          const translationService = new TranslationService(translationConfig);
          claudeSpinner.succeed('Claude API key configured');
        } catch (error) {
          claudeSpinner.fail(`Claude API test failed: ${error.message}`);
        }
      } else {
        logger.info('Claude API key not configured (translation features disabled)');
      }

      const anitorrentConfig = config.getAniTorrentConfig();
      if (anitorrentConfig.apiKey && anitorrentConfig.apiKey !== 'your_anitorrent_api_key') {
        const anitorrentSpinner = ora('Testing AniTorrent API connection...').start();
        try {
          const AniTorrentService = require('../services/anitorrent-service');
          const anitorrentService = new AniTorrentService(config);
          const testResult = await anitorrentService.testConnection();
          
          if (testResult.success) {
            anitorrentSpinner.succeed('AniTorrent API connection successful');
          } else {
            anitorrentSpinner.fail(`AniTorrent API connection failed: ${testResult.message}`);
          }
        } catch (error) {
          anitorrentSpinner.fail(`AniTorrent API test failed: ${error.message}`);
        }
      } else {
        logger.info('AniTorrent API key not configured');
      }
      
    } catch (error) {
      logger.error(`Connection test failed: ${error.message}`);
      process.exit(1);
    }
  });

configCommand
  .command('reset')
  .description('Reset configuration')
  .action(async () => {
    try {
      const config = new ConfigManager();
      
      const { confirm } = await inquirer.prompt([{
        type: 'confirm',
        name: 'confirm',
        message: 'Are you sure you want to reset the configuration? This will delete all saved settings.',
        default: false
      }]);
      
      if (!confirm) {
        logger.info('Operation cancelled');
        return;
      }
      
      const fs = require('fs').promises;
      try {
        await fs.unlink(config.getConfigPath());
        try {
          await fs.unlink(config.tokenFile);
        } catch (error) {
          // Token file might not exist, ignore
        }
        logger.success('Configuration reset successfully');
      } catch (error) {
        if (error.code === 'ENOENT') {
          logger.info('No configuration found to reset');
        } else {
          throw error;
        }
      }
      
    } catch (error) {
      logger.error(`Reset failed: ${error.message}`);
      process.exit(1);
    }
  });

configCommand
  .command('system-check')
  .description('Check system dependencies and compatibility')
  .action(async () => {
    try {
      const SystemCheck = require('../utils/system-check');
      const systemCheck = new SystemCheck();
      
      logger.header('System Compatibility Check');
      
      logger.info(`Platform: ${systemCheck.platform}`);
      if (systemCheck.isLinux) {
        const distro = systemCheck.getDistribution();
        logger.info(`Distribution: ${distro}`);
      }
      logger.separator();
      
      const spinner = ora('Checking system dependencies...').start();
      
      try {
        const dependencies = await systemCheck.checkAllDependencies();
        
        if (dependencies.allAvailable) {
          spinner.succeed('All system dependencies are available');
          logger.success('Your system is ready to use AniTorrent CLI!');
        } else {
          spinner.warn('Some system dependencies are missing');
          
          const report = systemCheck.generateInstallationReport(dependencies);
          
          logger.warning('Missing Dependencies:');
          logger.separator();
          
          for (const item of report) {
            logger.error(`❌ ${item.tool}`);
            if (item.missing.length > 0) {
              logger.info(`   Missing: ${item.missing.join(', ')}`, 1);
            }
            logger.info(`   Install: ${item.installCommand}`, 1);
            logger.separator();
          }
          
          logger.info('Please install the missing dependencies and run this command again.');
        }
        
        logger.separator();
        logger.info('Detailed dependency status:');
        logger.info(`FFmpeg: ${dependencies.ffmpeg.ffmpeg ? '✅' : '❌'} ffmpeg, ${dependencies.ffmpeg.ffprobe ? '✅' : '❌'} ffprobe`);
        logger.info(`MKVToolNix: ${dependencies.mkvtoolnix.mkvmerge ? '✅' : '❌'} mkvmerge, ${dependencies.mkvtoolnix.mkvextract ? '✅' : '❌'} mkvextract`);
        
      } catch (error) {
        spinner.fail(`Dependency check failed: ${error.message}`);
        logger.error('Unable to check system dependencies. Please ensure you have proper permissions.');
      }
      
    } catch (error) {
      logger.error(`System check failed: ${error.message}`);
      process.exit(1);
    }
  });

module.exports = configCommand; 