const fs = require('fs').promises;
const path = require('path');
const anitomy = require('anitomyscript');

class FileService {
  constructor(options = {}) {
    this.verbose = options.verbose || false;
    this.quiet = options.quiet || false;
  }

  async scanDirectory(dirPath) {
    try {
      const items = await fs.readdir(dirPath, { withFileTypes: true });
      const directories = [];

      for (const item of items) {
        if (item.isDirectory()) {
          const fullPath = path.join(dirPath, item.name);
          const files = await this.getFilesInDirectory(fullPath);

          if (files.length > 0) {
            directories.push({
              name: item.name,
              path: fullPath,
              files: files,
            });
          }
        }
      }

      return directories.sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true })
      );
    } catch (error) {
      throw new Error(`Failed to scan directory: ${error.message}`);
    }
  }

  async getFilesInDirectory(dirPath) {
    try {
      const items = await fs.readdir(dirPath);
      const fileExtensions = [
        '.mp4',
        '.mkv',
        '.avi',
        '.mov',
        '.wmv',
        '.flv',
        '.webm',
        '.m4v',
        '.ass',
        '.srt',
        '.vtt',
        '.sub',
        '.mp3',
        '.aac',
      ];

      return items
        .filter((item) => {
          const ext = path.extname(item).toLowerCase();
          return fileExtensions.includes(ext);
        })
        .map((item) => ({
          name: item,
          path: path.join(dirPath, item),
        }));
    } catch (error) {
      return [];
    }
  }

  async parseEpisodeInfo(filename) {
    try {
      const parsed = await anitomy(filename);
      
      // Debug logging
      if (this.verbose) {
        console.log('Anitomy parsed:', filename, '→', parsed);
      }
      
      return {
        anime_title: parsed.anime_title || '',
        anime_season: parsed.anime_season || '',
        episode_number: parsed.episode_number || '',
        episode_title: parsed.episode_title || '',
        file_extension: parsed.file_extension || '',
        release_group: parsed.release_group || '',
        video_resolution: parsed.video_resolution || '',
        audio_term: parsed.audio_term || '',
        source: parsed.source || '',
        other: parsed.other || [],
      };
    } catch (error) {
      if (this.verbose) {
        console.log('Anitomy parse error:', filename, '→', error.message);
      }
      return {
        anime_title: '',
        anime_season: '',
        episode_number: '',
        episode_title: '',
        file_extension: '',
        release_group: '',
        video_resolution: '',
        audio_term: '',
        source: '',
        other: [],
      };
    }
  }

  generateNewFilename(originalFilename, originalInfo, newEpisodeNumber) {
    // Debug logging
    if (this.verbose) {
      console.log('generateNewFilename input:', {
        originalFilename,
        originalInfo,
        newEpisodeNumber
      });
    }
    
    if (!originalInfo.episode_number || !originalInfo.anime_title) {
      if (this.verbose) {
        console.log('Missing episode_number or anime_title, returning original filename');
      }
      return originalFilename;
    }

    const ext = require('path').extname(originalFilename);
    const animeTitle = originalInfo.anime_title.replace(/\s+/g, '_');
    const seasonNumber = parseInt(originalInfo.anime_season) || 1;
    const episodeNumber = newEpisodeNumber;
    
    const seasonStr = seasonNumber < 10 ? `0${seasonNumber}` : seasonNumber.toString();
    const episodeStr = episodeNumber < 10 ? `0${episodeNumber}` : episodeNumber.toString();
    
    const newFilename = `${animeTitle}_S${seasonStr}E${episodeStr}${ext}`;
    
    if (this.verbose) {
      console.log('Generated new filename:', newFilename);
    }
    
    return newFilename;
  }

  generateNewFolderName(newEpisodeNumber) {
    return `E${newEpisodeNumber.toString().padStart(2, '0')}`;
  }

  async renameFile(oldPath, newPath) {
    try {
      await fs.rename(oldPath, newPath);
      return true;
    } catch (error) {
      throw new Error(`Failed to rename file: ${error.message}`);
    }
  }

  async renameFolder(oldPath, newPath) {
    try {
      await fs.rename(oldPath, newPath);
      return true;
    } catch (error) {
      throw new Error(`Failed to rename folder: ${error.message}`);
    }
  }

  async createRenamePreview(directories, startEpisode = 1) {
    const preview = [];
    let episodeCounter = startEpisode;

    for (const dir of directories) {
      const dirPreview = {
        originalFolder: dir.name,
        newFolder: this.generateNewFolderName(episodeCounter),
        files: [],
      };

      for (const file of dir.files) {
        const episodeInfo = await this.parseEpisodeInfo(file.name);
        const newFilename = this.generateNewFilename(
          file.name,
          episodeInfo,
          episodeCounter
        );

        dirPreview.files.push({
          originalFile: file.name,
          newFile: newFilename,
          episodeInfo: episodeInfo,
        });
      }

      preview.push(dirPreview);
      episodeCounter++;
    }

    return preview;
  }

  async executeRename(directories, preview) {
    const results = {
      success: [],
      errors: [],
    };

    for (let i = 0; i < directories.length; i++) {
      const dir = directories[i];
      const previewItem = preview[i];

      try {
        for (let j = 0; j < dir.files.length; j++) {
          const file = dir.files[j];
          const newFileName = previewItem.files[j].newFile;
          const newFilePath = path.join(dir.path, newFileName);

          await this.renameFile(file.path, newFilePath);
          results.success.push({
            type: 'file',
            old: file.name,
            new: newFileName,
            folder: dir.name,
          });
        }

        const newFolderPath = path.join(
          path.dirname(dir.path),
          previewItem.newFolder
        );
        await this.renameFolder(dir.path, newFolderPath);
        results.success.push({
          type: 'folder',
          old: dir.name,
          new: previewItem.newFolder,
        });
      } catch (error) {
        results.errors.push({
          folder: dir.name,
          error: error.message,
        });
      }
    }

    return results;
  }
}

module.exports = FileService;
