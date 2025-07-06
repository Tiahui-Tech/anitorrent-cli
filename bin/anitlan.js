#!/usr/bin/env node

process.env.AWS_SDK_JS_SUPPRESS_MAINTENANCE_MODE_MESSAGE = '1';

const { Command } = require('commander');
const chalk = require('chalk');
const packageJson = require('../package.json');

const configCommand = require('../src/commands/config');
const subtitlesCommand = require('../src/commands/subtitle');
const audioCommand = require('../src/commands/audio');
const uploadCommand = require('../src/commands/upload');
const peertubeCommand = require('../src/commands/peertube');
const videoCommand = require('../src/commands/video');
const filesCommand = require('../src/commands/files');
const rssCommand = require('../src/commands/rss');

const program = new Command();

program
  .name('anitlan')
  .description(packageJson.description)
  .version(packageJson.version);

program
  .option('--quiet, -q', 'quiet mode')
  .option('--config <file>', 'custom config file');

program.addCommand(configCommand);
program.addCommand(subtitlesCommand);
program.addCommand(audioCommand);
program.addCommand(uploadCommand);
program.addCommand(peertubeCommand);
program.addCommand(videoCommand);
program.addCommand(filesCommand);
program.addCommand(rssCommand);

program.on('command:*', () => {
  console.error(chalk.red(`Invalid command: ${program.args.join(' ')}`));
  console.log(chalk.yellow('See --help for a list of available commands.'));
  process.exit(1);
});

if (process.argv.length === 2) {
  program.outputHelp();
}

program.parse(process.argv); 