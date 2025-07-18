const anitomy = require('anitomyscript');
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

class SubtitleService {
    constructor() {
        this.subtitlesFolderName = 'subtitles';
    }

    async getVideoInfo(videoFile) {
        const command = `ffprobe -v quiet -print_format json -show_streams -show_format "${videoFile}"`;
        
        try {
            const { stdout } = await execAsync(command);
            const data = JSON.parse(stdout);
            return data;
        } catch (error) {
            throw new Error(`Error getting video info: ${error.message}`);
        }
    }

    async getMkvInfo(videoFile) {
        const command = `mkvmerge -J "${videoFile}"`;
        
        try {
            const { stdout } = await execAsync(command);
            const data = JSON.parse(stdout);
            return data;
        } catch (error) {
            throw new Error(`Error getting MKV info with mkvmerge: ${error.message}`);
        }
    }

    async listSubtitleTracks(videoFile) {
        try {
            // Try mkvmerge first for all video files, fallback to ffprobe
            try {
                return await this.listSubtitleTracksWithMkv(videoFile);
            } catch (mkvError) {
                // mkvmerge failed, fallback to ffprobe
                return await this.listSubtitleTracksWithFfprobe(videoFile);
            }
        } catch (error) {
            throw new Error(`Error listing subtitle tracks: ${error.message}`);
        }
    }

    async listSubtitleTracksWithMkv(videoFile) {
        const mkvData = await this.getMkvInfo(videoFile);
        
        const tracks = mkvData.tracks || [];
        const subtitleTracks = tracks.filter(track => track.type === 'subtitles');
        
        return subtitleTracks.map((track, index) => {
            const props = track.properties || {};
            const langCode = props.language || 'und';
            const trackName = props.track_name || '';
            const codec = track.codec || '';
            
            const languageInfo = this.parseMkvLanguageInfo(langCode, trackName, index, tracks);
            
            return {
                index: track.id,
                trackNumber: index,
                mkvTrackId: track.id,
                codec: codec,
                language: languageInfo.language,
                languageDetail: languageInfo.detail,
                title: trackName || languageInfo.title || `Subtitle Track ${index}`,
                forced: props.forced_track === true,
                default: props.default_track === true,
                properties: props,
                originalTrackName: trackName,
                source: 'mkvmerge'
            };
        });
    }

    async listSubtitleTracksWithFfprobe(videoFile) {
        const data = await this.getVideoInfo(videoFile);
        const subtitleStreams = data.streams.filter(stream => stream.codec_type === 'subtitle');
        
        return subtitleStreams.map((stream, index) => {
            const languageInfo = this.parseLanguageInfo(stream, index);
            
            return {
                index: stream.index,
                trackNumber: index,
                streamIndex: stream.index,
                codec: stream.codec_name,
                language: languageInfo.language,
                languageDetail: languageInfo.detail,
                title: stream.tags?.title || languageInfo.title || `Subtitle Track ${index}`,
                forced: stream.disposition?.forced === 1,
                default: stream.disposition?.default === 1,
                disposition: stream.disposition,
                allTags: stream.tags,
                source: 'ffprobe'
            };
        });
    }

    parseMkvLanguageInfo(langCode, trackName, index, allTracks) {
        const language = langCode || 'unknown';
        const name = trackName.toLowerCase();
        
        let detail = '';
        let displayTitle = trackName;
        
        if (language === 'spa' || language === 'es') {
            if (name.includes('es-419') || name.includes('latin')) {
                detail = 'Latino (es-419)';
                displayTitle = displayTitle || 'Español (Latino)';
            } else if (name.includes('es-es') || name.includes('españa') || name.includes('spain') || name.includes('castilian')) {
                detail = 'España (es-ES)';
                displayTitle = displayTitle || 'Español (España)';
            } else if (name.includes('forced')) {
                detail = 'Forced';
                displayTitle = displayTitle || 'Español (Forced)';
            } else {
                // Smart detection: check if there's already a Latino track
                const spanishTracks = allTracks.filter(t => 
                    (t.properties?.language === 'spa' || t.properties?.language === 'es') && 
                    t.type === 'subtitles'
                );
                
                const hasLatinoTrack = spanishTracks.some(t => {
                    const tName = (t.properties?.track_name || '').toLowerCase();
                    return tName.includes('es-419') || tName.includes('latin');
                });
                
                const hasEspañaTrack = spanishTracks.some(t => {
                    const tName = (t.properties?.track_name || '').toLowerCase();
                    return tName.includes('es-es') || tName.includes('españa') || 
                           tName.includes('spain') || tName.includes('castilian');
                });
                
                // If there's already a Latino track and this is just "Spanish", assume it's España
                if (hasLatinoTrack && !hasEspañaTrack && name === 'cr_spanish') {
                    detail = 'España (inferred)';
                } else if (!hasLatinoTrack && !hasEspañaTrack) {
                    // If no specific variants, use order
                    detail = index === 0 ? 'España (by order)' : 'Latino (by order)';
                } else {
                    detail = 'Unknown variant';
                }
                displayTitle = displayTitle || `Español (${detail})`;
            }
        } else if (language === 'por' || language === 'pt') {
            if (name.includes('pt-br') || name.includes('brasil') || name.includes('brazil')) {
                detail = 'Brasil (pt-BR)';
                displayTitle = displayTitle || 'Português (Brasil)';
            } else {
                detail = 'Portugal';
                displayTitle = displayTitle || 'Português';
            }
        } else if (language === 'eng' || language === 'en') {
            if (name.includes('en-us') || name.includes('american')) {
                detail = 'US (en-US)';
                displayTitle = displayTitle || 'English (US)';
            } else {
                detail = 'English';
                displayTitle = displayTitle || 'English';
            }
        }
        
        return {
            language,
            detail,
            title: displayTitle
        };
    }

    parseLanguageInfo(stream, index) {
        const tags = stream.tags || {};
        const language = tags.language || 'unknown';
        const title = tags.title || tags.handler_name || '';
        
        let detail = '';
        let displayTitle = title;
        
        if (language === 'spa' || language === 'es') {
            if (title.toLowerCase().includes('latin') || title.toLowerCase().includes('latino')) {
                detail = 'Latino';
                displayTitle = displayTitle || 'Español (Latino)';
            } else if (title.toLowerCase().includes('spain') || title.toLowerCase().includes('españa') || title.toLowerCase().includes('castilian')) {
                detail = 'España';
                displayTitle = displayTitle || 'Español (España)';
            } else if (title.toLowerCase().includes('forced') || stream.disposition?.forced === 1) {
                detail = 'Forced';
                displayTitle = displayTitle || 'Español (Forced)';
            } else {
                detail = index === 0 ? 'España (assumed)' : 'Latino (assumed)';
                displayTitle = displayTitle || `Español (${detail})`;
            }
        }
        
        return {
            language,
            detail,
            title: displayTitle
        };
    }

    async fetchPlaylistVideos(playlistId, apiUrl = 'https://peertube.anitorrent.com/api/v1') {
        const url = `${apiUrl}/video-playlists/${playlistId}/videos?count=100`;
        
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            return data.data;
        } catch (error) {
            throw new Error(`Error fetching playlist: ${error.message}`);
        }
    }

    async getLocalVideoFiles(directory = '.', recursive = false) {
        const foundFiles = [];

        async function scanDir(currentDir, relativePath = '') {
            try {
                const entries = await fs.readdir(currentDir, { withFileTypes: true });
                
                for (const entry of entries) {
                    const fullPath = path.join(currentDir, entry.name);
                    const relativeFilePath = path.join(relativePath, entry.name);
                    
                    if (entry.isFile()) {
                        const ext = path.extname(entry.name).toLowerCase();
                        const videoExtensions = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.ts', '.mts'];
                        
                        if (videoExtensions.includes(ext)) {
                            foundFiles.push(fullPath);
                        }
                    } else if (entry.isDirectory() && recursive) {
                        await scanDir(fullPath, relativeFilePath);
                    }
                }
            } catch (error) {
                // Skip directories that can't be read
            }
        }

        await scanDir(directory);
        return foundFiles;
    }

    async parseVideoName(videoName) {
        try {
            if (!videoName || typeof videoName !== 'string' || videoName.trim() === '') {
                return null;
            }
            
            const trimmedName = videoName.trim();
            const result = await anitomy(trimmedName);
            
            return result;
        } catch (error) {
            return null;
        }
    }

    normalizeTitle(title) {
        return title
            .toLowerCase()
            .replace(/[^\w\s]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    matchVideos(peertubeVideos, localFiles) {
        const matches = [];
        
        for (const peertubeVideo of peertubeVideos) {
            const peertubeData = peertubeVideo.parsed;
            if (!peertubeData) continue;
            
            for (const localFile of localFiles) {
                const localData = localFile.parsed;
                if (!localData) continue;
                
                const episodeMatch = peertubeData.episode_number === localData.episode_number;
                const seasonMatch = (!peertubeData.anime_season && !localData.anime_season) ||
                    peertubeData.anime_season === localData.anime_season;
                
                if (episodeMatch && seasonMatch) {
                    matches.push({
                        peertubeVideo: peertubeVideo.original,
                        localFile: localFile.filename,
                        peertubeData,
                        localData
                    });
                    break;
                }
            }
        }
        
        return matches;
    }

    async ensureSubtitlesDirectory(directory = '.') {
        const subtitlesDir = path.join(directory, this.subtitlesFolderName);
        try {
            await fs.access(subtitlesDir);
        } catch {
            await fs.mkdir(subtitlesDir);
        }
        return subtitlesDir;
    }

    async extractSubtitles(videoFile, outputFile, subtitleTrack = 0, directory = '.') {
        const subtitlesDir = await this.ensureSubtitlesDirectory(directory);
        const subtitlesPath = path.join(subtitlesDir, outputFile);
        
        // Validate and normalize subtitleTrack parameter
        if (subtitleTrack === null || subtitleTrack === undefined) {
            subtitleTrack = 0;
        }
        
        if (typeof subtitleTrack !== 'number' || isNaN(subtitleTrack) || subtitleTrack < 0) {
            return { success: false, error: `Invalid subtitle track number: ${subtitleTrack}` };
        }
        
        try {
            const tracks = await this.listSubtitleTracks(videoFile);
            if (tracks.length === 0) {
                return { success: false, error: 'No subtitle tracks found in video file' };
            }
            
            if (subtitleTrack >= tracks.length) {
                return { success: false, error: `Subtitle track ${subtitleTrack} not found (only ${tracks.length} tracks available)` };
            }
        } catch (error) {
            return { success: false, error: `Failed to analyze video file: ${error.message}` };
        }
        
        try {
            return await this.extractSubtitlesWithFfmpeg(videoFile, subtitlesPath, subtitleTrack);
        } catch (ffmpegError) {
            try {
                return await this.extractSubtitlesWithMkv(videoFile, subtitlesPath, subtitleTrack);
            } catch (mkvError) {
                return { 
                    success: false, 
                    error: `Both ffmpeg and mkvextract failed. FFmpeg: ${ffmpegError.message}, MKV: ${mkvError.message}` 
                };
            }
        }
    }

    async extractSubtitlesWithMkv(videoFile, outputPath, subtitleTrack) {
        // Get track info to find the correct MKV track ID
        const tracks = await this.listSubtitleTracksWithMkv(videoFile);
        
        if (subtitleTrack >= tracks.length) {
            return { success: false, error: `Subtitle track ${subtitleTrack} not found` };
        }
        
        const track = tracks[subtitleTrack];
        const mkvTrackId = track.mkvTrackId;
        
        const command = `mkvextract tracks "${videoFile}" ${mkvTrackId}:"${outputPath}"`;
        
        try {
            const { stdout, stderr } = await execAsync(command);
            return { success: true, outputPath };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async extractSubtitlesWithFfmpeg(videoFile, outputPath, subtitleTrack) {
        // Validate input parameters
        if (subtitleTrack === null || subtitleTrack === undefined) {
            return { success: false, error: 'Subtitle track cannot be null or undefined' };
        }
        
        if (typeof subtitleTrack !== 'number' || isNaN(subtitleTrack) || subtitleTrack < 0) {
            return { success: false, error: `Invalid subtitle track number: ${subtitleTrack}` };
        }
        
        const tracks = await this.listSubtitleTracks(videoFile);
        
        if (subtitleTrack >= tracks.length) {
            return { success: false, error: `Subtitle track ${subtitleTrack} not found (only ${tracks.length} tracks available)` };
        }
        
        const track = tracks[subtitleTrack];
        
        if (!track) {
            return { success: false, error: `Track data not found for track ${subtitleTrack}` };
        }
        
        let streamMap;
        if (track.source === 'ffprobe' && track.streamIndex !== undefined) {
            streamMap = `0:${track.streamIndex}`;
        } else {
            streamMap = `0:s:${subtitleTrack}`;
        }
        
        const command = `ffmpeg -i "${videoFile}" -map ${streamMap} "${outputPath}" -y`;
        
        try {
            const { stdout, stderr } = await execAsync(command);
            return { success: true, outputPath };
        } catch (error) {
            return { success: false, error: `FFmpeg command failed: ${error.message}. Command: ${command}` };
        }
    }

    async extractAllLocalSubtitles(subtitleTrack = null, directory = '.', recursive = false) {
        const localFiles = await this.getLocalVideoFiles(directory, recursive);
        
        if (localFiles.length === 0) {
            throw new Error(`No video files found in directory: ${directory}`);
        }
        
        const results = [];
        for (const filePath of localFiles) {
            const nameWithoutExt = path.parse(filePath).name;
            
            const tracks = await this.listSubtitleTracks(filePath);
            const spanishTracks = tracks.filter(t => t.language === 'spa' || t.language === 'es');
            
            let targetTrack = subtitleTrack;
            
            // If no track specified, find Spanish Latino automatically
            if (targetTrack === null) {
                targetTrack = this.findDefaultSpanishTrack(tracks);
                if (targetTrack === -1) {
                    // No Spanish track found, use first available track
                    targetTrack = 0;
                }
            }
            
            // Ensure targetTrack is always a valid number
            if (targetTrack === null || targetTrack === undefined) {
                targetTrack = 0;
            }
            
            if (targetTrack >= tracks.length) {
                results.push({
                    filename: filePath,
                    outputFile: `${nameWithoutExt}.ass`,
                    success: false,
                    error: `Track ${targetTrack} not found`
                });
                continue;
            }
            
            let outputFile;
            if (targetTrack < tracks.length) {
                const track = tracks[targetTrack];
                const langSuffix = this.getLanguageSuffix(track, spanishTracks.length === 1);
                outputFile = langSuffix ? `${nameWithoutExt}_${langSuffix}.ass` : `${nameWithoutExt}.ass`;
            } else {
                outputFile = `${nameWithoutExt}.ass`;
            }
            
            const result = await this.extractSubtitles(filePath, outputFile, targetTrack, directory);
            results.push({
                filename: filePath,
                outputFile,
                trackUsed: targetTrack,
                trackInfo: tracks[targetTrack],
                ...result
            });
        }
        
        return results;
    }

    findDefaultSpanishTrack(tracks) {
        const spanishTracks = tracks.filter(t => t.language === 'spa' || t.language === 'es');
        
        if (spanishTracks.length === 0) {
            return -1; // No Spanish tracks found
        }
        
        if (spanishTracks.length === 1) {
            // Only one Spanish track, it's the default (latino)
            const trackNumber = spanishTracks[0].trackNumber;
            return (trackNumber !== null && trackNumber !== undefined) ? trackNumber : 0;
        }
        
        // Multiple Spanish tracks - find Latino
        for (const track of spanishTracks) {
            const detail = track.languageDetail || '';
            const title = track.title || '';
            
            // Look for explicit Latino indicators
            if (detail.includes('Latino') || detail.includes('es-419') || 
                title.toLowerCase().includes('latin') || title.toLowerCase().includes('419')) {
                const trackNumber = track.trackNumber;
                return (trackNumber !== null && trackNumber !== undefined) ? trackNumber : 0;
            }
        }
        
        // If no explicit Latino found, look for non-España tracks
        for (const track of spanishTracks) {
            const detail = track.languageDetail || '';
            const title = track.title || '';
            
            // Skip España tracks
            if (detail.includes('España') || detail.includes('es-ES') || 
                title.toLowerCase().includes('spain') || title.toLowerCase().includes('es-es')) {
                continue;
            }
            
            // This is likely Latino (not explicitly España)
            const trackNumber = track.trackNumber;
            return (trackNumber !== null && trackNumber !== undefined) ? trackNumber : 0;
        }
        
        // Fallback: return first Spanish track
        const trackNumber = spanishTracks[0].trackNumber;
        return (trackNumber !== null && trackNumber !== undefined) ? trackNumber : 0;
    }

    async extractAllSubtitleTracks(videoFile, directory = '.') {
        const tracks = await this.listSubtitleTracks(videoFile);
        const nameWithoutExt = path.parse(videoFile).name;
        
        if (tracks.length === 0) {
            throw new Error('No subtitle tracks found in the video file');
        }
        
        const results = [];
        const spanishTracks = tracks.filter(t => t.language === 'spa' || t.language === 'es');
        
        for (const track of tracks) {
            const langSuffix = this.getLanguageSuffix(track, spanishTracks.length === 1);
            const outputFile = langSuffix ? `${nameWithoutExt}_${langSuffix}.ass` : `${nameWithoutExt}.ass`;
            
            const result = await this.extractSubtitles(videoFile, outputFile, track.trackNumber, directory);
            results.push({
                track,
                outputFile,
                ...result
            });
        }
        
        return results;
    }

    async extractAllSubtitlesFromFolder(directory = '.', recursive = false) {
        const localFiles = await this.getLocalVideoFiles(directory, recursive);
        
        if (localFiles.length === 0) {
            throw new Error(`No video files found in directory: ${directory}`);
        }
        
        const results = [];
        for (const filePath of localFiles) {
            try {
                const fileResults = await this.extractAllSubtitleTracks(filePath, directory);
                results.push(...fileResults.map(r => ({
                    filename: filePath,
                    ...r
                })));
            } catch (error) {
                results.push({
                    filename: filePath,
                    success: false,
                    error: error.message
                });
            }
        }
        
        return results;
    }

    getLanguageSuffix(track, isSingleSpanish = false) {
        const language = track.language;
        const detail = track.languageDetail;
        
        if (language === 'spa' || language === 'es') {
            if (isSingleSpanish) {
                return 'lat';
            } else if (detail && detail.includes('Latino')) {
                return 'lat';
            } else if (detail && detail.includes('España')) {
                return 'spa';
            } else {
                return track.trackNumber === 0 ? 'spa' : 'lat';
            }
        } else if (language === 'eng' || language === 'en') {
            return 'en';
        } else if (language === 'por' || language === 'pt') {
            return 'pt';
        } else if (language === 'jpn' || language === 'ja') {
            return 'ja';
        } else if (language === 'fra' || language === 'fr') {
            return 'fr';
        } else if (language === 'deu' || language === 'de') {
            return 'de';
        } else if (language === 'ita' || language === 'it') {
            return 'it';
        } else {
            return language !== 'unknown' ? language : 'unk';
        }
    }

    async extractFromPlaylist(playlistId, subtitleTrack = 0, apiUrl = 'https://peertube.anitorrent.com/api/v1', directory = '.', offsetMs = 0, recursive = false) {
        const peertubeVideos = await this.fetchPlaylistVideos(playlistId, apiUrl);
        const localFiles = await this.getLocalVideoFiles(directory, recursive);
        
        const parsedPeertubeVideos = [];
        for (const video of peertubeVideos) {
            const parsed = await this.parseVideoName(video.video.name);
            parsedPeertubeVideos.push({
                original: video,
                parsed
            });
        }
        
        const parsedLocalFiles = [];
        for (const filePath of localFiles) {
            const nameWithoutExt = path.parse(filePath).name;
            const parsed = await this.parseVideoName(nameWithoutExt);
            parsedLocalFiles.push({
                filename: filePath,
                parsed
            });
        }
        
        const matches = this.matchVideos(parsedPeertubeVideos, parsedLocalFiles);
        
        if (matches.length === 0) {
            throw new Error('No matches found between PeerTube playlist and local files');
        }
        
        const results = [];
        for (const match of matches) {
            const outputFile = `${match.peertubeVideo.video.shortUUID}.ass`;
            const result = await this.extractSubtitles(match.localFile, outputFile, subtitleTrack, directory);
            
            if (result.success && offsetMs && offsetMs !== 0) {
                const offsetResult = await this.adjustSubtitleTiming(result.outputPath, offsetMs, result.outputPath);
                result.offsetApplied = offsetResult.success;
                result.offsetError = offsetResult.success ? null : offsetResult.error;
            }
            
            results.push({
                match,
                outputFile,
                ...result
            });
        }
        
        return { matches, results };
    }

    async translateSubtitleFile(subtitlePath, config, onProgress = null) {
        const TranslationService = require('./translation-service');
        
        try {
            const translationService = new TranslationService(config);
            const result = await translationService.translateSubtitles(subtitlePath, {
                onProgress
            });
            
            return result;
        } catch (error) {
            throw new Error(`Translation failed: ${error.message}`);
        }
    }

    async extractAndTranslateSubtitles(videoFile, outputFile, subtitleTrack = 0, directory = '.', translationConfig = null, onProgress = null) {
        const extractResult = await this.extractSubtitles(videoFile, outputFile, subtitleTrack, directory);
        
        if (!extractResult.success) {
            return extractResult;
        }

        if (!translationConfig) {
            return extractResult;
        }

        try {
            if (onProgress) {
                onProgress({ type: 'translation_start', file: extractResult.outputPath });
            }

            const translationResult = await this.translateSubtitleFile(
                extractResult.outputPath, 
                translationConfig,
                onProgress
            );

            if (onProgress) {
                onProgress({ 
                    type: 'translation_complete', 
                    originalFile: extractResult.outputPath,
                    translatedFile: translationResult.outputPath
                });
            }

            return {
                ...extractResult,
                translationResult
            };
        } catch (error) {
            if (onProgress) {
                onProgress({ type: 'translation_error', error: error.message });
            }
            
            return {
                ...extractResult,
                translationError: error.message
            };
        }
    }

    async extractAllLocalSubtitlesWithTranslation(subtitleTrack = null, directory = '.', translationConfig = null, onProgress = null, recursive = false) {
        const localFiles = await this.getLocalVideoFiles(directory, recursive);
        
        if (localFiles.length === 0) {
            throw new Error(`No video files found in directory: ${directory}`);
        }

        const results = [];
        for (const filePath of localFiles) {
            const nameWithoutExt = path.parse(filePath).name;
            
            let targetTrack = subtitleTrack;
            if (targetTrack === null) {
                try {
                    const tracks = await this.listSubtitleTracks(filePath);
                    targetTrack = this.findDefaultSpanishTrack(tracks);
                    if (targetTrack === -1) {
                        targetTrack = 0;
                    }
                } catch (error) {
                    results.push({
                        filename: filePath,
                        success: false,
                        error: `Failed to analyze tracks: ${error.message}`
                    });
                    continue;
                }
            }

            try {
                const tracks = await this.listSubtitleTracks(filePath);
                const spanishTracks = tracks.filter(t => t.language === 'spa' || t.language === 'es');
                
                if (targetTrack >= tracks.length) {
                    results.push({
                        filename: filePath,
                        success: false,
                        error: `Track ${targetTrack} not found`
                    });
                    continue;
                }
                
                let outputFile;
                if (targetTrack < tracks.length) {
                    const track = tracks[targetTrack];
                    const langSuffix = this.getLanguageSuffix(track, spanishTracks.length === 1);
                    outputFile = langSuffix ? `${nameWithoutExt}_${langSuffix}.ass` : `${nameWithoutExt}.ass`;
                } else {
                    outputFile = `${nameWithoutExt}.ass`;
                }
                
                const result = await this.extractAndTranslateSubtitles(
                    filePath, 
                    outputFile, 
                    targetTrack, 
                    directory, 
                    translationConfig,
                    onProgress
                );
                
                results.push({
                    filename: filePath,
                    outputFile,
                    trackUsed: targetTrack,
                    trackInfo: tracks[targetTrack],
                    ...result
                });
            } catch (error) {
                results.push({
                    filename: filePath,
                    success: false,
                    error: error.message
                });
            }
        }
        
        return results;
    }

    async extractAllSubtitleTracksWithTranslation(videoFile, directory = '.', translationConfig = null, onProgress = null) {
        const tracks = await this.listSubtitleTracks(videoFile);
        const nameWithoutExt = path.parse(videoFile).name;
        
        if (tracks.length === 0) {
            throw new Error('No subtitle tracks found in the video file');
        }
        
        const results = [];
        const spanishTracks = tracks.filter(t => t.language === 'spa' || t.language === 'es');
        
        for (const track of tracks) {
            const langSuffix = this.getLanguageSuffix(track, spanishTracks.length === 1);
            const outputFile = langSuffix ? `${nameWithoutExt}_${langSuffix}.ass` : `${nameWithoutExt}.ass`;
            
            const result = await this.extractAndTranslateSubtitles(
                videoFile, 
                outputFile, 
                track.trackNumber, 
                directory, 
                translationConfig,
                onProgress
            );
            
            results.push({
                track,
                outputFile,
                ...result
            });
        }
        
        return results;
    }

    async adjustSubtitleTiming(subtitleFile, offsetMs, outputFile = null) {
        const fs = require('fs').promises;
        const path = require('path');
        
        try {
            const content = await fs.readFile(subtitleFile, 'utf8');
            
            if (!outputFile) {
                const parsed = path.parse(subtitleFile);
                const offsetStr = offsetMs >= 0 ? `+${offsetMs}ms` : `${offsetMs}ms`;
                outputFile = path.join(parsed.dir, `${parsed.name}_offset_${offsetStr}${parsed.ext}`);
            }
            
            const adjustedContent = this.adjustAssTimings(content, offsetMs);
            
            await fs.writeFile(outputFile, adjustedContent, 'utf8');
            
            return {
                success: true,
                inputFile: subtitleFile,
                outputFile,
                offsetMs,
                message: `Timing adjusted by ${offsetMs}ms`
            };
        } catch (error) {
            return {
                success: false,
                inputFile: subtitleFile,
                outputFile: outputFile || subtitleFile,
                offsetMs,
                error: error.message
            };
        }
    }

    adjustAssTimings(content, offsetMs) {
        const lines = content.split('\n');
        const adjustedLines = lines.map(line => {
            if (line.startsWith('Dialogue:') || line.startsWith('Comment:')) {
                const parts = line.split(',');
                if (parts.length >= 10) {
                    const startTime = parts[1];
                    const endTime = parts[2];
                    
                    const adjustedStartTime = this.adjustAssTime(startTime, offsetMs);
                    const adjustedEndTime = this.adjustAssTime(endTime, offsetMs);
                    
                    parts[1] = adjustedStartTime;
                    parts[2] = adjustedEndTime;
                    
                    return parts.join(',');
                }
            }
            return line;
        });
        
        return adjustedLines.join('\n');
    }

    adjustAssTime(timeStr, offsetMs) {
        const regex = /^(\d+):(\d{2}):(\d{2})\.(\d{2})$/;
        const match = timeStr.match(regex);
        
        if (!match) return timeStr;
        
        const hours = parseInt(match[1]);
        const minutes = parseInt(match[2]);
        const seconds = parseInt(match[3]);
        const centiseconds = parseInt(match[4]);
        
        const totalMs = (hours * 3600 + minutes * 60 + seconds) * 1000 + centiseconds * 10;
        const adjustedMs = Math.max(0, totalMs + offsetMs);
        
        const newHours = Math.floor(adjustedMs / 3600000);
        const newMinutes = Math.floor((adjustedMs % 3600000) / 60000);
        const newSeconds = Math.floor((adjustedMs % 60000) / 1000);
        const newCentiseconds = Math.floor((adjustedMs % 1000) / 10);
        
        return `${newHours}:${newMinutes.toString().padStart(2, '0')}:${newSeconds.toString().padStart(2, '0')}.${newCentiseconds.toString().padStart(2, '0')}`;
    }
}

module.exports = SubtitleService; 