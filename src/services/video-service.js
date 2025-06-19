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

  async getDetailedVideoInfo(videoPath) {
    return new Promise((resolve, reject) => {
      const args = [
        '-i', videoPath,
        '-hide_banner'
      ];

      const ffprobe = spawn('ffprobe', args);
      let stderr = '';

      ffprobe.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ffprobe.on('close', () => {
        try {
          const streamMatch = stderr.match(/Stream #\d+:\d+.*?: Video: (.+)/);
          if (!streamMatch) {
            throw new Error('No video stream found');
          }

          const videoStream = streamMatch[1];
          const codecMatch = videoStream.match(/^(\w+)/);
          const resolutionMatch = videoStream.match(/(\d{3,4}x\d{3,4})/);
          const fpsMatch = videoStream.match(/(\d+(?:\.\d+)?)\s*fps/);
          const pixelFormatMatch = videoStream.match(/(\w+),\s*\d{3,4}x\d{3,4}/);

          const info = {
            codec: codecMatch ? codecMatch[1] : 'unknown',
            resolution: resolutionMatch ? resolutionMatch[1] : 'unknown',
            fps: fpsMatch ? parseFloat(fpsMatch[1]) : 30,
            pixelFormat: pixelFormatMatch ? pixelFormatMatch[1] : 'yuv420p'
          };

          resolve(info);
        } catch (error) {
          reject(new Error(`Failed to parse detailed video info: ${error.message}`));
        }
      });

      ffprobe.on('error', (error) => {
        reject(new Error(`FFprobe process error: ${error.message}`));
      });
    });
  }

  async mergeVideos(introPath, inputVideoPath, outputPath) {
    const AudioService = require('./audio-service');
    const SubtitleService = require('./subtitle-service');
    
    const audioService = new AudioService();
    const subtitleService = new SubtitleService();
    const tempDir = path.join(path.dirname(outputPath), `temp_merge_${Date.now()}`);
    
    try {
      this.logger.verbose('Starting advanced video merge with track preservation');
      
      await fs.mkdir(tempDir, { recursive: true });
      
      const inputVideoInfo = await this.getDetailedVideoInfo(inputVideoPath);
      const introDuration = await this.getVideoDuration(introPath);
      
      this.logger.verbose(`Input video specs: ${inputVideoInfo.fps}fps, ${inputVideoInfo.resolution}, ${inputVideoInfo.codec}`);
      this.logger.verbose(`Intro duration: ${introDuration}s`);
      
      const tempIntroPath = path.join(tempDir, 'intro_converted.mp4');
      const tempVideoOnlyPath = path.join(tempDir, 'video_only.mp4');
      const tempMergedVideoPath = path.join(tempDir, 'merged_video.mp4');
      
      this.logger.verbose('Step 1: Converting intro to match input specifications');
      await this.convertIntroToMatchInput(introPath, tempIntroPath, inputVideoInfo);
      
      this.logger.verbose('Step 2: Extracting video stream only from input');
      await this.extractVideoStreamOnly(inputVideoPath, tempVideoOnlyPath);
      
      this.logger.verbose('Step 3: Concatenating video streams');
      await this.concatenateVideosOnly(tempIntroPath, tempVideoOnlyPath, tempMergedVideoPath);
      
      this.logger.verbose('Step 4: Extracting audio tracks from input');
      const audioTracks = await audioService.listAudioTracks(inputVideoPath);
      const extractedAudio = [];
      
      for (let i = 0; i < audioTracks.length; i++) {
        const audioPath = path.join(tempDir, `audio_${i}.aac`);
        await this.extractAudioTrack(inputVideoPath, audioPath, i);
        extractedAudio.push({
          path: audioPath,
          track: audioTracks[i],
          index: i
        });
      }
      
      this.logger.verbose('Step 5: Extracting subtitle tracks from input');
      const subtitleTracks = await subtitleService.listSubtitleTracks(inputVideoPath);
      const extractedSubtitles = [];
      
      for (let i = 0; i < subtitleTracks.length; i++) {
        const subtitlePath = path.join(tempDir, `subtitle_${i}.ass`);
        const result = await subtitleService.extractSubtitles(inputVideoPath, path.basename(subtitlePath), i, tempDir);
        if (result.success) {
          extractedSubtitles.push({
            path: result.outputPath,
            track: subtitleTracks[i],
            index: i
          });
        }
      }
      
      this.logger.verbose('Step 6: Merging all streams with proper timing');
      await this.mergeAllStreams(
        tempMergedVideoPath,
        extractedAudio,
        extractedSubtitles,
        introDuration,
        outputPath
      );
      
      this.logger.verbose('Step 7: Cleaning up temporary files');
      await this.cleanupTempDirectory(tempDir);
      
      this.logger.verbose('Video merge with track preservation completed successfully');
      return { success: true, outputPath };

    } catch (error) {
      this.logger.verbose(`Merge operation failed: ${error.message}`);
      await this.cleanupTempDirectory(tempDir);
      throw error;
    }
  }

  async convertIntroToMatchInput(introPath, outputPath, targetSpecs) {
    return new Promise((resolve, reject) => {
      const args = [
        '-i', introPath,
        '-r', targetSpecs.fps.toString(),
        '-s', targetSpecs.resolution,
        '-c:v', this.getOptimalVideoCodec(targetSpecs.codec),
        '-c:a', 'aac',
        '-b:a', '128k',
        '-pix_fmt', targetSpecs.pixelFormat,
        '-vsync', 'cfr',
        '-preset', 'medium',
        '-crf', '18',
        '-movflags', '+faststart',
        '-y',
        outputPath
      ];

      this.logger.verbose(`Converting intro with args: ${args.join(' ')}`);

      const ffmpeg = spawn('ffmpeg', args);
      let stderr = '';

      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ffmpeg.on('close', (code) => {
        if (code === 0) {
          this.logger.verbose('Intro conversion completed');
          resolve();
        } else {
          reject(new Error(`Intro conversion failed with code ${code}: ${stderr}`));
        }
      });

      ffmpeg.on('error', (error) => {
        reject(new Error(`FFmpeg conversion process error: ${error.message}`));
      });
    });
  }

  async concatenateVideos(introPath, inputVideoPath, outputPath) {
    const listFilePath = path.join(path.dirname(outputPath), `concat_list_${Date.now()}.txt`);
    
    try {
      const listContent = `file '${introPath.replace(/\\/g, '/')}'
file '${inputVideoPath.replace(/\\/g, '/')}'`;
      
      await fs.writeFile(listFilePath, listContent, 'utf8');

      return new Promise((resolve, reject) => {
        const args = [
          '-f', 'concat',
          '-safe', '0',
          '-i', listFilePath,
          '-c', 'copy',
          '-avoid_negative_ts', 'make_zero',
          '-fflags', '+genpts',
          '-y',
          outputPath
        ];

        this.logger.verbose(`Concatenating videos with args: ${args.join(' ')}`);

        const ffmpeg = spawn('ffmpeg', args);
        let stderr = '';

        ffmpeg.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        ffmpeg.on('close', (code) => {
          this.cleanupTempFile(listFilePath);
          
          if (code === 0) {
            this.logger.verbose('Video concatenation completed');
            resolve();
          } else {
            reject(new Error(`Concatenation failed with code ${code}: ${stderr}`));
          }
        });

        ffmpeg.on('error', (error) => {
          this.cleanupTempFile(listFilePath);
          reject(new Error(`FFmpeg concatenation process error: ${error.message}`));
        });
      });
    } catch (error) {
      await this.cleanupTempFile(listFilePath);
      throw error;
    }
  }

  getOptimalVideoCodec(inputCodec) {
    const codecMap = {
      'h264': 'libx264',
      'h265': 'libx265',
      'hevc': 'libx265',
      'vp9': 'libvpx-vp9',
      'vp8': 'libvpx',
      'av1': 'libaom-av1'
    };

    return codecMap[inputCodec.toLowerCase()] || 'libx264';
  }

  async getVideoDuration(videoPath) {
    return new Promise((resolve, reject) => {
      const args = [
        '-v', 'quiet',
        '-show_entries', 'format=duration',
        '-of', 'csv=p=0',
        videoPath
      ];

      const ffprobe = spawn('ffprobe', args);
      let stdout = '';

      ffprobe.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      ffprobe.on('close', (code) => {
        if (code === 0) {
          const duration = parseFloat(stdout.trim());
          resolve(duration);
        } else {
          reject(new Error(`Failed to get video duration with code ${code}`));
        }
      });

      ffprobe.on('error', (error) => {
        reject(new Error(`FFprobe process error: ${error.message}`));
      });
    });
  }

  async extractVideoStreamOnly(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
      const args = [
        '-i', inputPath,
        '-c:v', 'copy',
        '-an',
        '-sn',
        '-y',
        outputPath
      ];

      const ffmpeg = spawn('ffmpeg', args);
      let stderr = '';

      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ffmpeg.on('close', (code) => {
        if (code === 0) {
          this.logger.verbose('Video stream extracted successfully');
          resolve();
        } else {
          reject(new Error(`Video extraction failed with code ${code}: ${stderr}`));
        }
      });

      ffmpeg.on('error', (error) => {
        reject(new Error(`FFmpeg video extraction error: ${error.message}`));
      });
    });
  }

  async concatenateVideosOnly(introPath, inputVideoPath, outputPath) {
    const listFilePath = path.join(path.dirname(outputPath), `video_concat_list_${Date.now()}.txt`);
    
    try {
      const listContent = `file '${introPath.replace(/\\/g, '/')}'
file '${inputVideoPath.replace(/\\/g, '/')}'`;
      
      await fs.writeFile(listFilePath, listContent, 'utf8');

      return new Promise((resolve, reject) => {
        const args = [
          '-f', 'concat',
          '-safe', '0',
          '-i', listFilePath,
          '-c', 'copy',
          '-avoid_negative_ts', 'make_zero',
          '-fflags', '+genpts',
          '-y',
          outputPath
        ];

        const ffmpeg = spawn('ffmpeg', args);
        let stderr = '';

        ffmpeg.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        ffmpeg.on('close', (code) => {
          this.cleanupTempFile(listFilePath);
          
          if (code === 0) {
            this.logger.verbose('Video concatenation completed');
            resolve();
          } else {
            reject(new Error(`Video concatenation failed with code ${code}: ${stderr}`));
          }
        });

        ffmpeg.on('error', (error) => {
          this.cleanupTempFile(listFilePath);
          reject(new Error(`FFmpeg video concatenation error: ${error.message}`));
        });
      });
    } catch (error) {
      await this.cleanupTempFile(listFilePath);
      throw error;
    }
  }

  async extractAudioTrack(inputPath, outputPath, trackIndex) {
    return new Promise((resolve, reject) => {
      const args = [
        '-i', inputPath,
        '-map', `0:a:${trackIndex}`,
        '-c:a', 'aac',
        '-b:a', '192k',
        '-y',
        outputPath
      ];

      const ffmpeg = spawn('ffmpeg', args);
      let stderr = '';

      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ffmpeg.on('close', (code) => {
        if (code === 0) {
          this.logger.verbose(`Audio track ${trackIndex} extracted successfully`);
          resolve();
        } else {
          reject(new Error(`Audio extraction failed for track ${trackIndex} with code ${code}: ${stderr}`));
        }
      });

      ffmpeg.on('error', (error) => {
        reject(new Error(`FFmpeg audio extraction error: ${error.message}`));
      });
    });
  }

  async mergeAllStreams(videoPath, audioTracks, subtitleTracks, introDuration, outputPath) {
    return new Promise((resolve, reject) => {
      const args = ['-i', videoPath];
      
      for (const audio of audioTracks) {
        args.push('-itsoffset', introDuration.toString(), '-i', audio.path);
      }
      
      args.push('-map', '0:v:0');
      
      for (let i = 0; i < audioTracks.length; i++) {
        args.push('-map', `${i + 1}:a:0`);
      }
      
      args.push('-c:v', 'copy');
      
      for (let i = 0; i < audioTracks.length; i++) {
        args.push('-c:a:' + i, 'aac');
        args.push('-b:a:' + i, '192k');
      }
      
      for (let i = 0; i < audioTracks.length; i++) {
        const track = audioTracks[i].track;
        if (track.language && track.language !== 'unknown') {
          args.push(`-metadata:s:a:${i}`, `language=${track.language}`);
        }
        if (track.title) {
          args.push(`-metadata:s:a:${i}`, `title=${track.title}`);
        }
      }
      
      args.push('-avoid_negative_ts', 'make_zero');
      args.push('-y', outputPath);

      this.logger.verbose(`Merging video and audio streams with command: ffmpeg ${args.join(' ')}`);

      const ffmpeg = spawn('ffmpeg', args);
      let stderr = '';

      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ffmpeg.on('close', async (code) => {
        if (code === 0) {
          this.logger.verbose('Video and audio streams merged successfully');
          
          if (subtitleTracks.length > 0) {
            await this.addSubtitlesWithOffset(outputPath, subtitleTracks, introDuration);
          }
          
          resolve();
        } else {
          reject(new Error(`Stream merging failed with code ${code}: ${stderr}`));
        }
      });

      ffmpeg.on('error', (error) => {
        reject(new Error(`FFmpeg stream merging error: ${error.message}`));
      });
    });
  }

  async addSubtitlesWithOffset(videoPath, subtitleTracks, introDuration) {
    if (subtitleTracks.length === 0) {
      this.logger.verbose('No subtitles to add, skipping subtitle processing');
      return;
    }

    const tempVideoPath = videoPath + '.temp.mp4';
    const tempDir = path.dirname(subtitleTracks[0].path);
    
    try {
      this.logger.verbose('Processing subtitles with offset');
      const offsetSubtitles = [];
      
      for (let i = 0; i < subtitleTracks.length; i++) {
        const subtitle = subtitleTracks[i];
        const offsetSubPath = path.join(tempDir, `subtitle_offset_${i}.ass`);
        
        await this.offsetSubtitleFile(subtitle.path, offsetSubPath, introDuration);
        offsetSubtitles.push({
          ...subtitle,
          path: offsetSubPath
        });
      }
      
      return new Promise((resolve, reject) => {
        const args = ['-i', videoPath];
        
        for (const subtitle of offsetSubtitles) {
          args.push('-i', subtitle.path);
        }
        
        args.push('-map', '0');
        
        for (let i = 0; i < offsetSubtitles.length; i++) {
          args.push('-map', `${i + 1}:s:0`);
        }
        
        args.push('-c:v', 'copy');
        args.push('-c:a', 'copy');
        
        for (let i = 0; i < offsetSubtitles.length; i++) {
          args.push('-c:s:' + i, 'mov_text');
        }
        
        for (let i = 0; i < offsetSubtitles.length; i++) {
          const track = offsetSubtitles[i].track;
          if (track.language && track.language !== 'unknown') {
            args.push(`-metadata:s:s:${i}`, `language=${track.language}`);
          }
          if (track.title) {
            args.push(`-metadata:s:s:${i}`, `title=${track.title}`);
          }
          if (track.forced) {
            args.push(`-disposition:s:${i}`, 'forced');
          }
          if (track.default) {
            args.push(`-disposition:s:${i}`, 'default');
          }
        }
        
        args.push('-avoid_negative_ts', 'make_zero');
        args.push('-y', tempVideoPath);

        this.logger.verbose(`Adding subtitles: ffmpeg ${args.join(' ')}`);

        const ffmpeg = spawn('ffmpeg', args);
        let stderr = '';

        ffmpeg.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        ffmpeg.on('close', async (code) => {
          if (code === 0) {
            try {
              await fs.rename(tempVideoPath, videoPath);
              this.logger.verbose('Subtitles added successfully');
              resolve();
            } catch (error) {
              reject(new Error(`Failed to replace video file: ${error.message}`));
            }
          } else {
            await this.cleanupTempFile(tempVideoPath);
            reject(new Error(`Adding subtitles failed with code ${code}: ${stderr}`));
          }
        });

        ffmpeg.on('error', (error) => {
          this.cleanupTempFile(tempVideoPath);
          reject(new Error(`FFmpeg subtitle adding error: ${error.message}`));
        });
      });
      
    } catch (error) {
      throw new Error(`Subtitle offset processing failed: ${error.message}`);
    }
  }

  async offsetSubtitleFile(inputPath, outputPath, offsetSeconds) {
    try {
      const content = await fs.readFile(inputPath, 'utf8');
      
      const timeRegex = /(\d{1,2}):(\d{2}):(\d{2})\.(\d{2})/g;
      
      const offsetContent = content.replace(timeRegex, (match, hours, minutes, seconds, centiseconds) => {
        const totalMs = (parseInt(hours) * 3600 + parseInt(minutes) * 60 + parseInt(seconds)) * 1000 + parseInt(centiseconds) * 10;
        const offsetMs = totalMs + (offsetSeconds * 1000);
        
        const newHours = Math.floor(offsetMs / 3600000);
        const newMinutes = Math.floor((offsetMs % 3600000) / 60000);
        const newSeconds = Math.floor((offsetMs % 60000) / 1000);
        const newCentiseconds = Math.floor((offsetMs % 1000) / 10);
        
        return `${newHours.toString().padStart(1, '0')}:${newMinutes.toString().padStart(2, '0')}:${newSeconds.toString().padStart(2, '0')}.${newCentiseconds.toString().padStart(2, '0')}`;
      });
      
      await fs.writeFile(outputPath, offsetContent, 'utf8');
      this.logger.verbose(`Subtitle offset applied: ${path.basename(inputPath)} -> ${path.basename(outputPath)}`);
      
    } catch (error) {
      throw new Error(`Failed to offset subtitle file ${inputPath}: ${error.message}`);
    }
  }

  async cleanupTempDirectory(dirPath) {
    try {
      const files = await fs.readdir(dirPath);
      for (const file of files) {
        await fs.unlink(path.join(dirPath, file));
      }
      await fs.rmdir(dirPath);
      this.logger.verbose(`Cleaned up temp directory: ${dirPath}`);
    } catch (error) {
      this.logger.verbose(`Failed to cleanup temp directory ${dirPath}: ${error.message}`);
    }
  }

  async cleanupTempFile(filePath) {
    try {
      await fs.unlink(filePath);
      this.logger.verbose(`Cleaned up temp file: ${filePath}`);
    } catch (error) {
      this.logger.verbose(`Failed to cleanup temp file ${filePath}: ${error.message}`);
    }
  }
}

module.exports = VideoService; 