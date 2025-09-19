const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

class AudioService {
    constructor() {
        this.audioFolderName = 'audio';
        this.defaultBitrate = '192k';
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
            return JSON.parse(stdout);
        } catch (error) {
            throw new Error(`Error getting MKV info: ${error.message}`);
        }
    }

    parseMkvLanguageInfo(langCode, trackName, index, allTracks) {
        const language = langCode || 'unknown';
        const name = trackName.toLowerCase();
        
        let detail = '';
        let displayTitle = trackName;
        
        if (language === 'spa' || language === 'es') {
            if (name.includes('es-419') || name.includes('latino') || name.includes('latin_america') || name.includes('latin america')) {
                detail = 'Latino (es-419)';
                displayTitle = displayTitle || 'Español (Latino)';
            } else if (name.includes('es-es') || name.includes('españa') || name.includes('spain') || name.includes('castilian')) {
                detail = 'España (es-ES)';
                displayTitle = displayTitle || 'Español (España)';
            } else {
                const spanishTracks = allTracks.filter(t => 
                    (t.properties?.language === 'spa' || t.properties?.language === 'es') && 
                    t.type === 'audio'
                );
                
                const hasLatinoTrack = spanishTracks.some(t => {
                    const tName = (t.properties?.track_name || '').toLowerCase();
                    return tName.includes('es-419') || tName.includes('latino') || 
                           tName.includes('latin_america') || tName.includes('latin america');
                });
                
                const hasEspañaTrack = spanishTracks.some(t => {
                    const tName = (t.properties?.track_name || '').toLowerCase();
                    return tName.includes('es-es') || tName.includes('españa') || 
                           tName.includes('spain') || tName.includes('castilian');
                });
                
                if (hasLatinoTrack && !hasEspañaTrack && name === 'cr_spanish') {
                    detail = 'España (inferred)';
                } else if (!hasLatinoTrack && !hasEspañaTrack) {
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

    sanitizeFilename(name) {
        if (!name || typeof name !== 'string') return '';
        
        return name
            .replace(/[<>:"/\\|?*]/g, '_')
            .replace(/\s+/g, '_')
            .replace(/_{2,}/g, '_')
            .replace(/^_+|_+$/g, '')
            .substring(0, 50);
    }

    generateAudioTrackName(track, audioIndex, existingNames = []) {
        const props = track.properties || {};
        const langCode = (props.language || 'und').toLowerCase();
        const trackName = props.track_name || '';
        
        let displayName = '';
        
        if (trackName.trim()) {
            const safeName = this.sanitizeFilename(trackName);
            
            if (safeName) {
                displayName = langCode !== 'und' ? `${langCode}_${safeName}` : safeName;
            } else {
                displayName = langCode !== 'und' ? langCode : `audio_${audioIndex}`;
            }
        } else {
            const languageMap = {
                'jpn': 'jpn', 'ja': 'jpn', 'jp': 'jpn',
                'spa': 'spa', 'es': 'spa',
                'eng': 'eng', 'en': 'eng',
                'por': 'por', 'pt': 'por'
            };
            
            displayName = languageMap[langCode] || (langCode !== 'und' ? langCode : `audio_${audioIndex}`);
        }
        
        let finalName = displayName;
        let counter = 1;
        
        while (existingNames.includes(finalName)) {
            finalName = `${displayName}_${counter}`;
            counter++;
        }
        
        return finalName;
    }

    async listAudioTracks(videoFile) {
        try {
            try {
                return await this.listAudioTracksWithMkv(videoFile);
            } catch (mkvError) {
                return await this.listAudioTracksWithFfprobe(videoFile);
            }
        } catch (error) {
            throw new Error(`Error listing audio tracks: ${error.message}`);
        }
    }

    async listAudioTracksWithMkv(videoFile) {
        const mkvData = await this.getMkvInfo(videoFile);
        
        const tracks = mkvData.tracks || [];
        const audioTracks = tracks.filter(track => track.type === 'audio');
        
        return audioTracks.map((track, index) => {
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
                title: trackName || languageInfo.title || `Audio Track ${index}`,
                channels: props.audio_channels,
                sampleRate: props.audio_sampling_frequency,
                bitrate: props.audio_bits_per_sample,
                properties: props,
                originalTrackName: trackName,
                source: 'mkvmerge'
            };
        });
    }

    async listAudioTracksWithFfprobe(videoFile) {
        const data = await this.getVideoInfo(videoFile);
        const audioStreams = data.streams.filter(stream => stream.codec_type === 'audio');
        
        return audioStreams.map((stream, index) => {
            const languageInfo = this.parseLanguageInfo(stream, index);
            
            return {
                index: stream.index,
                trackNumber: index,
                codec: stream.codec_name,
                language: languageInfo.language,
                languageDetail: languageInfo.detail,
                title: stream.tags?.title || languageInfo.title || `Audio Track ${index}`,
                channels: stream.channels,
                sampleRate: stream.sample_rate,
                bitrate: stream.bit_rate,
                allTags: stream.tags,
                source: 'ffprobe'
            };
        });
    }

    getLanguageSuffix(track, allTracks = [], audioLatinoTrack = null) {
        const language = track.language;
        const detail = track.languageDetail || '';
        
        // Japanese is the default with no suffix
        if (language === 'jpn' || language === 'ja') {
            return null; // No suffix for Japanese
        }
        // For Spanish, use specific suffixes
        else if (language === 'spa' || language === 'es') {
            // If user explicitly specified a Latino track, use that
            if (audioLatinoTrack !== null) {
                if (track.trackNumber === audioLatinoTrack) {
                    return 'lat';
                } else {
                    // All other Spanish tracks are assumed to be España
                    return 'spa';
                }
            }
            
            // If there's explicit detail about Latino or es-419, use 'lat' suffix
            if (detail.includes('Latino') || detail.includes('es-419')) {
                return 'lat';
            }
            // If there's explicit detail about España or es-ES, use 'spa' suffix
            else if (detail.includes('España') || detail.includes('es-ES')) {
                return 'spa';
            }
            // Multiple Spanish tracks - use track order to decide
            else {
                const spanishTracks = allTracks.filter(t => t.language === 'spa' || t.language === 'es');
                if (spanishTracks.length === 1) {
                    return 'lat'; // Single Spanish track is Latino
                }
                return track.trackNumber === 0 ? 'spa' : 'lat'; // First is España, others are Latino
            }
        }
        // For other languages, use the 3-letter language code
        else {
            return language !== 'unknown' && language !== 'und' ? language : 'unk';
        }
    }

    findDefaultJapaneseTrack(tracks) {
        const japaneseTracks = tracks.filter(t => t.language === 'jpn' || t.language === 'ja');
        
        if (japaneseTracks.length === 0) {
            return -1; // No Japanese tracks found
        }
        
        // Return the first Japanese track found
        return japaneseTracks[0].trackNumber;
    }
    
    findDefaultSpanishTrack(tracks) {
        const spanishTracks = tracks.filter(t => t.language === 'spa' || t.language === 'es');
        
        if (spanishTracks.length === 0) {
            return -1;
        }
        
        if (spanishTracks.length === 1) {
            return spanishTracks[0].trackNumber;
        }
        
        for (const track of spanishTracks) {
            const detail = track.languageDetail || '';
            const title = track.title || '';
            
            if (detail.includes('Latino') || detail.includes('es-419') || 
                title.toLowerCase().includes('latin') || title.toLowerCase().includes('419')) {
                return track.trackNumber;
            }
        }
        
        for (const track of spanishTracks) {
            const detail = track.languageDetail || '';
            const title = track.title || '';
            
            if (detail.includes('España') || detail.includes('es-ES') || 
                title.toLowerCase().includes('spain') || title.toLowerCase().includes('es-es')) {
                continue;
            }
            
            return track.trackNumber;
        }
        
        return spanishTracks[0].trackNumber;
    }

    async getLocalVideoFiles(directory = '.') {
        try {
            const files = await fs.readdir(directory);
            return files.filter(file => 
                file.endsWith('.mp4') || 
                file.endsWith('.mkv') || 
                file.endsWith('.avi') || 
                file.endsWith('.mov')
            ).map(file => path.join(directory, file));
        } catch (error) {
            throw new Error(`Error reading directory: ${error.message}`);
        }
    }

    async ensureAudioDirectory(directory = '.') {
        const audioDir = path.join(directory, this.audioFolderName);
        try {
            await fs.access(audioDir);
        } catch {
            await fs.mkdir(audioDir, { recursive: true });
        }
        return audioDir;
    }

    async extractAudio(videoFile, outputFile, audioTrack = 0, directory = '.', format = 'mp3', bitrate = null) {
        const audioDir = await this.ensureAudioDirectory(directory);
        const audioPath = path.join(audioDir, outputFile);
        const actualBitrate = bitrate || this.defaultBitrate;
        
        const command = `ffmpeg -y -i "${videoFile}" -map 0:a:${audioTrack} -c:a ${this.getAudioCodec(format)} -b:a ${actualBitrate} "${audioPath}"`;
        
        try {
            const { stdout, stderr } = await execAsync(command);
            return { 
                success: true, 
                outputPath: audioPath,
                command,
                stdout: stdout?.substring(0, 200),
                stderr: stderr?.substring(0, 200)
            };
        } catch (error) {
            return { 
                success: false, 
                error: error.message,
                command,
                outputPath: audioPath
            };
        }
    }

    async extractAllAudioTracksAdvanced(videoFile, directory = '.', format = 'aac', bitrate = null, namePrefix = null) {
        console.log('\n🎵 Starting advanced audio extraction...');
        console.log('='.repeat(60));
        
        try {
            const audioTracks = await this.listAudioTracks(videoFile);
            
            if (audioTracks.length === 0) {
                throw new Error('No audio tracks found in the video file');
            }
            
            const nameWithoutExt = namePrefix || path.parse(videoFile).name;
            const actualBitrate = bitrate || this.defaultBitrate;
            const spanishTracks = audioTracks.filter(t => t.language === 'spa' || t.language === 'es');
            
            console.log(`📊 Detected ${audioTracks.length} audio tracks for extraction`);
            console.log('-'.repeat(60));
            
            const results = [];
            const existingNames = [];
            
            for (let audioIdx = 0; audioIdx < audioTracks.length; audioIdx++) {
                const track = audioTracks[audioIdx];
                const langCode = track.language || 'und';
                const trackName = track.title || '';
                
                const langSuffix = this.getLanguageSuffix(track, audioTracks);
                let displayName = langSuffix;
                
                let baseName = displayName;
                let counter = 1;
                while (existingNames.includes(baseName)) {
                    baseName = `${displayName}_${counter}`;
                    counter++;
                }
                displayName = baseName;
                
                existingNames.push(displayName);
                
                const outputFile = `${nameWithoutExt}_${displayName}.${format}`;
                
                console.log(`🎧 Extracting track ${audioIdx + 1}/${audioTracks.length}: ${displayName}`);
                console.log(`   Language: ${langCode}`);
                console.log(`   Title: ${trackName || 'N/A'}`);
                console.log(`   Codec: ${track.codec || 'unknown'}`);
                
                const command = `ffmpeg -y -i "${videoFile}" -map 0:a:${audioIdx} -c:a ${this.getAudioCodec(format)} -b:a ${actualBitrate} "${path.join(await this.ensureAudioDirectory(directory), outputFile)}"`;
                
                try {
                    const { stdout, stderr } = await execAsync(command);
                    
                    const trackResult = {
                        trackIndex: audioIdx,
                        trackInfo: {
                            language: langCode,
                            title: trackName,
                            codec: track.codec,
                            languageDetail: track.languageDetail
                        },
                        trackName: displayName,
                        outputFile,
                        success: true,
                        outputPath: path.join(await this.ensureAudioDirectory(directory), outputFile),
                        command
                    };
                    
                    results.push(trackResult);
                    console.log(`   ✅ Successfully extracted to: ${outputFile}`);
                    
                } catch (error) {
                    const trackResult = {
                        trackIndex: audioIdx,
                        trackInfo: {
                            language: langCode,
                            title: trackName,
                            codec: track.codec,
                            languageDetail: track.languageDetail
                        },
                        trackName: displayName,
                        outputFile,
                        success: false,
                        error: error.message,
                        command
                    };
                    
                    results.push(trackResult);
                    console.log(`   ❌ Failed to extract: ${error.message}`);
                }
                
                console.log();
            }
            
            const successCount = results.filter(r => r.success).length;
            console.log('='.repeat(60));
            console.log(`🎉 Extraction completed: ${successCount}/${audioTracks.length} tracks extracted successfully`);
            
            return results;
            
        } catch (error) {
            console.log(`❌ Error reading audio tracks with mkvmerge: ${error.message}`);
            throw error;
        }
    }

    getAudioCodec(format) {
        const codecs = {
            'mp3': 'libmp3lame',
            'aac': 'aac',
            'flac': 'flac',
            'wav': 'pcm_s16le',
            'ogg': 'libvorbis'
        };
        return codecs[format] || 'aac';
    }

    async extractAllAudio(audioTrack = null, directory = '.', format = 'mp3') {
        const localFiles = await this.getLocalVideoFiles(directory);
        
        if (localFiles.length === 0) {
            throw new Error(`No video files found in directory: ${directory}`);
        }
        
        const results = [];
        for (const filePath of localFiles) {
            const nameWithoutExt = path.parse(filePath).name;
            
            const tracks = await this.listAudioTracks(filePath);
            const spanishTracks = tracks.filter(t => t.language === 'spa' || t.language === 'es');
            
            let targetTrack = audioTrack;
            
            if (targetTrack === null) {
                targetTrack = this.findDefaultJapaneseTrack(tracks);
                if (targetTrack === -1) {
                    targetTrack = 0;
                }
            }
            
            if (targetTrack >= tracks.length) {
                results.push({
                    filename: filePath,
                    outputFile: `${nameWithoutExt}.${format}`,
                    success: false,
                    error: `Track ${targetTrack} not found`
                });
                continue;
            }
            
            let outputFile;
            if (spanishTracks.length === 1 && targetTrack < tracks.length && 
                (tracks[targetTrack].language === 'spa' || tracks[targetTrack].language === 'es')) {
                outputFile = `${nameWithoutExt}_lat.${format}`;
            } else if (targetTrack < tracks.length) {
                const track = tracks[targetTrack];
                const langSuffix = this.getLanguageSuffix(track, tracks);
                outputFile = langSuffix ? `${nameWithoutExt}_${langSuffix}.${format}` : `${nameWithoutExt}.${format}`;
            } else {
                outputFile = `${nameWithoutExt}.${format}`;
            }
            
            const result = await this.extractAudio(filePath, outputFile, targetTrack, directory, format);
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

    async extractAllAudioTracks(videoFile, directory = '.', format = 'mp3', namePrefix = null) {
        const audioTracks = await this.listAudioTracks(videoFile);
        const nameWithoutExt = namePrefix || path.parse(videoFile).name;
        
        if (audioTracks.length === 0) {
            throw new Error('No audio tracks found in the video file');
        }
        
        const results = [];
        const spanishTracks = audioTracks.filter(t => t.language === 'spa' || t.language === 'es');
        
        for (const track of audioTracks) {
            const langSuffix = this.getLanguageSuffix(track, audioTracks);
            const outputFile = langSuffix ? `${nameWithoutExt}_${langSuffix}.${format}` : `${nameWithoutExt}.${format}`;
            
            const result = await this.extractAudio(videoFile, outputFile, track.trackNumber, directory, format);
            results.push({
                track,
                outputFile,
                ...result
            });
        }
        
        return results;
    }
}

module.exports = AudioService; 