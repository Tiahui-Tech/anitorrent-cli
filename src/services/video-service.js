const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const { Logger } = require('../utils/logger');

class VideoService {
  constructor(options = {}) {
    this.logger = new Logger(options);
  }

  async checkFFmpegInstalled() {
    return new Promise((resolve) => {
      const ffmpeg = spawn('ffmpeg', ['-version']);
      
      ffmpeg.on('error', () => {
        resolve(false);
      });
      
      ffmpeg.on('close', (code) => {
        resolve(code === 0);
      });
    });
  }

  async mergeVideos(introPath, inputVideoPath, outputPath) {
    const ffmpegInstalled = await this.checkFFmpegInstalled();
    
    if (!ffmpegInstalled) {
      throw new Error('FFmpeg is not installed or not available in PATH');
    }

    const introExists = await this.fileExists(introPath);
    const inputExists = await this.fileExists(inputVideoPath);

    if (!introExists) {
      throw new Error(`Intro file not found: ${introPath}`);
    }

    if (!inputExists) {
      throw new Error(`Input video file not found: ${inputVideoPath}`);
    }

    return new Promise((resolve, reject) => {
      const args = [
        '-i', introPath,
        '-i', inputVideoPath,
        '-filter_complex', '[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[outv][outa]',
        '-map', '[outv]',
        '-map', '[outa]',
        '-c:v', 'libx264',
        '-c:a', 'aac',
        '-preset', 'medium',
        '-crf', '23',
        '-y',
        outputPath
      ];

      this.logger.verbose(`FFmpeg command: ffmpeg ${args.join(' ')}`);

      const ffmpeg = spawn('ffmpeg', args);
      
      let stderr = '';
      
      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
        const lines = data.toString().split('\n');
        for (const line of lines) {
          if (line.includes('time=')) {
            const timeMatch = line.match(/time=(\d{2}:\d{2}:\d{2}\.\d{2})/);
            if (timeMatch) {
              this.logger.verbose(`Processing: ${timeMatch[1]}`);
            }
          }
        }
      });

      ffmpeg.on('error', (error) => {
        reject(new Error(`FFmpeg process error: ${error.message}`));
      });

      ffmpeg.on('close', (code) => {
        if (code === 0) {
          resolve({
            success: true,
            outputPath: outputPath,
            message: 'Videos merged successfully'
          });
        } else {
          reject(new Error(`FFmpeg process exited with code ${code}. Error: ${stderr}`));
        }
      });
    });
  }

  async getVideoInfo(videoPath) {
    const ffmpegInstalled = await this.checkFFmpegInstalled();
    
    if (!ffmpegInstalled) {
      throw new Error('FFmpeg is not installed or not available in PATH');
    }

    const exists = await this.fileExists(videoPath);
    if (!exists) {
      throw new Error(`Video file not found: ${videoPath}`);
    }

    return new Promise((resolve, reject) => {
      const args = [
        '-i', videoPath,
        '-f', 'null',
        '-'
      ];

      const ffmpeg = spawn('ffmpeg', args);
      let stderr = '';

      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ffmpeg.on('close', () => {
        try {
          const durationMatch = stderr.match(/Duration: (\d{2}:\d{2}:\d{2}\.\d{2})/);
          const resolutionMatch = stderr.match(/(\d{3,4}x\d{3,4})/);
          const bitrateMatch = stderr.match(/bitrate: (\d+) kb\/s/);
          const fpsMatch = stderr.match(/(\d+(?:\.\d+)?) fps/);

          const info = {
            duration: durationMatch ? durationMatch[1] : 'Unknown',
            resolution: resolutionMatch ? resolutionMatch[1] : 'Unknown',
            bitrate: bitrateMatch ? `${bitrateMatch[1]} kb/s` : 'Unknown',
            fps: fpsMatch ? `${fpsMatch[1]} fps` : 'Unknown'
          };

          resolve(info);
        } catch (error) {
          reject(new Error(`Failed to parse video info: ${error.message}`));
        }
      });

      ffmpeg.on('error', (error) => {
        reject(new Error(`FFmpeg process error: ${error.message}`));
      });
    });
  }

  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  generateOutputFileName(inputPath, suffix = '_with_intro') {
    const ext = path.extname(inputPath);
    const nameWithoutExt = path.basename(inputPath, ext);
    const dir = path.dirname(inputPath);
    
    return path.join(dir, `${nameWithoutExt}${suffix}${ext}`);
  }

  async getFileSize(filePath) {
    try {
      const stats = await fs.stat(filePath);
      return this.formatFileSize(stats.size);
    } catch (error) {
      return 'Unknown';
    }
  }

  formatFileSize(bytes) {
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0) return '0 Bytes';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  }
}

module.exports = VideoService; 