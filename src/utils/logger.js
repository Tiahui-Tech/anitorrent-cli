const chalk = require('chalk');

class Logger {
    constructor(options = {}) {
        this._verbose = Boolean(options.verbose || false);
        this._quiet = Boolean(options.quiet || false);
    }

    setVerbose(verbose) {
        this._verbose = Boolean(verbose);
    }

    setQuiet(quiet) {
        this._quiet = Boolean(quiet);
    }

    get verbose() {
        return this._verbose;
    }

    get quiet() {
        return this._quiet;
    }

    info(message, indent = 0) {
        if (this._quiet) return;
        const prefix = '  '.repeat(indent);
        console.log(`${prefix}${message}`);
    }

    verbose(message, indent = 0) {
        if (this._quiet || !this._verbose) return;
        const prefix = '  '.repeat(indent);
        console.log(chalk.gray(`${prefix}${message}`));
    }

    success(message, indent = 0) {
        if (this._quiet) return;
        const prefix = '  '.repeat(indent);
        console.log(chalk.green(`${prefix}✅ ${message}`));
    }

    warning(message, indent = 0) {
        if (this._quiet) return;
        const prefix = '  '.repeat(indent);
        console.log(chalk.yellow(`${prefix}⚠️  ${message}`));
    }

    error(message, indent = 0) {
        const prefix = '  '.repeat(indent);
        console.error(chalk.red(`${prefix}❌ ${message}`));
    }

    step(stepNumber, title) {
        if (this._quiet) return;
        console.log(chalk.cyan(`\n${stepNumber} ${title}`));
        console.log(chalk.cyan('─'.repeat(50)));
    }

    header(title) {
        if (this._quiet) return;
        console.log(chalk.blue(`\n🚀 ${title}`));
        console.log(chalk.blue('═'.repeat(50)));
    }

    separator() {
        if (this._quiet) return;
        console.log('');
    }
}

const defaultLogger = new Logger();

module.exports = { Logger, logger: defaultLogger }; 