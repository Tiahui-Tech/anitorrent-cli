const { spawn } = require('child_process');
const os = require('os');

class SystemCheck {
    constructor() {
        this.platform = os.platform();
        this.isWindows = this.platform === 'win32';
        this.isLinux = this.platform === 'linux';
        this.isMacOS = this.platform === 'darwin';
    }

    async checkCommand(command) {
        return new Promise((resolve) => {
            const child = spawn(command, ['--version'], { 
                stdio: 'pipe',
                shell: true
            });
            
            let hasOutput = false;
            child.stdout.on('data', () => {
                hasOutput = true;
            });
            
            child.on('close', (code) => {
                resolve(hasOutput && code === 0);
            });
            
            child.on('error', () => {
                resolve(false);
            });
        });
    }

    async checkFFmpeg() {
        const ffmpegAvailable = await this.checkCommand('ffmpeg');
        const ffprobeAvailable = await this.checkCommand('ffprobe');
        
        return {
            available: ffmpegAvailable && ffprobeAvailable,
            ffmpeg: ffmpegAvailable,
            ffprobe: ffprobeAvailable
        };
    }

    async checkMKVToolNix() {
        const mkvmergeAvailable = await this.checkCommand('mkvmerge');
        const mkvextractAvailable = await this.checkCommand('mkvextract');
        
        return {
            available: mkvmergeAvailable && mkvextractAvailable,
            mkvmerge: mkvmergeAvailable,
            mkvextract: mkvextractAvailable
        };
    }

    getInstallationInstructions() {
        const instructions = {
            ffmpeg: {
                ubuntu: 'sudo apt update && sudo apt install ffmpeg',
                debian: 'sudo apt update && sudo apt install ffmpeg',
                fedora: 'sudo dnf install ffmpeg',
                centos: 'sudo yum install epel-release && sudo yum install ffmpeg',
                arch: 'sudo pacman -S ffmpeg',
                macos: 'brew install ffmpeg',
                windows: 'Download from https://ffmpeg.org/download.html and add to PATH'
            },
            mkvtoolnix: {
                ubuntu: 'sudo apt update && sudo apt install mkvtoolnix',
                debian: 'sudo apt update && sudo apt install mkvtoolnix',
                fedora: 'sudo dnf install mkvtoolnix',
                centos: 'sudo yum install epel-release && sudo yum install mkvtoolnix',
                arch: 'sudo pacman -S mkvtoolnix-cli',
                macos: 'brew install mkvtoolnix',
                windows: 'Download from https://mkvtoolnix.download/ and add to PATH'
            }
        };

        return instructions;
    }

    getDistribution() {
        if (!this.isLinux) return null;
        
        try {
            const fs = require('fs');
            if (fs.existsSync('/etc/os-release')) {
                const osRelease = fs.readFileSync('/etc/os-release', 'utf8');
                if (osRelease.includes('Ubuntu')) return 'ubuntu';
                if (osRelease.includes('Debian')) return 'debian';
                if (osRelease.includes('Fedora')) return 'fedora';
                if (osRelease.includes('CentOS')) return 'centos';
                if (osRelease.includes('Arch')) return 'arch';
            }
        } catch (error) {
            // Fallback detection
        }
        
        return 'ubuntu'; // Default to Ubuntu for most common case
    }

    getInstallCommand(tool) {
        const instructions = this.getInstallationInstructions();
        
        if (this.isWindows) {
            return instructions[tool].windows;
        } else if (this.isMacOS) {
            return instructions[tool].macos;
        } else if (this.isLinux) {
            const distro = this.getDistribution();
            return instructions[tool][distro] || instructions[tool].ubuntu;
        }
        
        return `Please install ${tool} for your system`;
    }

    async checkAllDependencies() {
        const ffmpegCheck = await this.checkFFmpeg();
        const mkvtoolnixCheck = await this.checkMKVToolNix();
        
        return {
            ffmpeg: ffmpegCheck,
            mkvtoolnix: mkvtoolnixCheck,
            allAvailable: ffmpegCheck.available && mkvtoolnixCheck.available
        };
    }

    generateInstallationReport(dependencies) {
        const report = [];
        
        if (!dependencies.ffmpeg.available) {
            const missing = [];
            if (!dependencies.ffmpeg.ffmpeg) missing.push('ffmpeg');
            if (!dependencies.ffmpeg.ffprobe) missing.push('ffprobe');
            
            report.push({
                tool: 'FFmpeg',
                missing,
                installCommand: this.getInstallCommand('ffmpeg')
            });
        }
        
        if (!dependencies.mkvtoolnix.available) {
            const missing = [];
            if (!dependencies.mkvtoolnix.mkvmerge) missing.push('mkvmerge');
            if (!dependencies.mkvtoolnix.mkvextract) missing.push('mkvextract');
            
            report.push({
                tool: 'MKVToolNix',
                missing,
                installCommand: this.getInstallCommand('mkvtoolnix')
            });
        }
        
        return report;
    }
}

module.exports = SystemCheck; 