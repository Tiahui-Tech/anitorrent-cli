const fs = require('fs').promises;
const path = require('path');
const { Anthropic } = require('@anthropic-ai/sdk');

class TranslationService {
    constructor(config) {
        this.apiKey = config?.apiKey || process.env.CLAUDE_API_KEY;
        if (!this.apiKey) {
            throw new Error('Claude API key is required. Set CLAUDE_API_KEY environment variable or pass it in config.');
        }
        
        this.claude = new Anthropic({
            apiKey: this.apiKey
        });
        
        this.defaultPromptPath = path.join(__dirname, '..', '..', 'data', 'translate-prompt.xml');
        this.systemPrompt = null;
    }

    async loadSystemPrompt(customPromptPath = null) {
        if (this.systemPrompt) {
            return this.systemPrompt;
        }

        const promptPath = customPromptPath || this.defaultPromptPath;
        
        try {
            this.systemPrompt = await fs.readFile(promptPath, 'utf-8');
            return this.systemPrompt;
        } catch (error) {
            throw new Error(`Failed to load system prompt from ${promptPath}: ${error.message}`);
        }
    }



    parseTimestamp(ts) {
        const [h, m, sms] = ts.split(/[:.]/);
        return (h * 3600 + m * 60 + parseFloat(sms)) * 1000;
    }

    groupDialogLines(dialogues, maxGroupSize = 8, maxGap = 8500) {
        const groups = [];
        let currentGroup = [];
        let previousEnd = 0;

        for (const dialogue of dialogues) {
            const parts = dialogue.split(',');
            const start = this.parseTimestamp(parts[1]);
            const end = this.parseTimestamp(parts[2]);

            if (
                currentGroup.length > 0 &&
                (start - previousEnd > maxGap || currentGroup.length >= maxGroupSize)
            ) {
                groups.push(currentGroup);
                currentGroup = [];
            }

            currentGroup.push({ parts, start, end, original: dialogue });
            previousEnd = end;
        }

        if (currentGroup.length > 0) groups.push(currentGroup);
        return groups;
    }

    async translateGroup(group, context, onProgress, customPromptPath = null) {
        try {
            const systemPrompt = await this.loadSystemPrompt(customPromptPath);
            
            const response = await this.claude.messages.create({
                model: 'claude-3-7-sonnet-latest',
                max_tokens: 1000,
                temperature: 0.7,
                system: systemPrompt,
                messages: [
                    {
                        role: 'user',
                        content: JSON.stringify(context),
                    },
                ],
            });

            const responseText = response.content[0].text.trim();
            
            if (!responseText.includes('Dialogue:')) {
                return this.reconstructDialogueLines(group, responseText);
            }

            return this.processTranslatedBlock(group, responseText);

        } catch (error) {
            if (onProgress) {
                onProgress({ type: 'error', message: `Translation error: ${error.message}` });
            }
            return group.map(dialog => dialog.original);
        }
    }

    reconstructDialogueLines(group, translatedText) {
        return group.map(dialog => {
            const originalParts = dialog.original.split(',');
            const textPart = originalParts.slice(9).join(',').trim();
            
            let finalTranslatedText = translatedText;
            
            if (textPart.includes('(') && textPart.includes(')')) {
                const match = textPart.match(/\([^)]+\)/);
                if (match) {
                    finalTranslatedText = match[0] + ' ' + translatedText;
                }
            }
            
            return [...originalParts.slice(0, 9), finalTranslatedText].join(',');
        });
    }

    processTranslatedBlock(group, responseText) {
        const translatedBlock = responseText
            .replace(/\\\\/g, '\\')
            .replace(/\\N/g, '<<SPECIAL_N>>')
            .replace(/\n/g, '\\N')
            .replace(/<<SPECIAL_N>>/g, '\\N')
            .split(/(?=Dialogue:)/g)
            .map(line => line.trim())
            .filter(line => line.startsWith('Dialogue:'));

        if (translatedBlock.length !== group.length) {
            return this.handleMismatchedLines(group, translatedBlock, responseText);
        }

        return group.map((dialog, i) => {
            try {
                const translatedParts = translatedBlock[i].split(/,(?![^{}]*})/);
                dialog.parts.splice(
                    9,
                    dialog.parts.length - 9,
                    translatedParts.slice(9).join(',')
                );
                return dialog.parts.join(',');
            } catch (error) {
                return dialog.original;
            }
        });
    }

    handleMismatchedLines(group, translatedBlock, responseText) {
        const results = [];
        
        for (let i = 0; i < group.length; i++) {
            const dialog = group[i];
            
            if (i < translatedBlock.length) {
                try {
                    const translatedParts = translatedBlock[i].split(/,(?![^{}]*})/);
                    dialog.parts.splice(
                        9,
                        dialog.parts.length - 9,
                        translatedParts.slice(9).join(',')
                    );
                    results.push(dialog.parts.join(','));
                } catch (error) {
                    results.push(dialog.original);
                }
            } else {
                if (responseText.length > 0) {
                    const originalParts = dialog.original.split(',');
                    originalParts[9] = responseText;
                    results.push(originalParts.join(','));
                } else {
                    results.push(dialog.original);
                }
            }
        }
        
        return results;
    }

    async translateSubtitles(filePath, options = {}) {
        const {
            maxDialogs = Infinity,
            outputPath = null,
            onProgress = null,
            customPromptPath = null
        } = options;



        const fileContent = await fs.readFile(filePath, 'utf-8');
        const lines = fileContent.split('\n');
        const translatedLines = [];
        const dialogLines = lines.filter(line => line.startsWith('Dialogue:'));

        if (dialogLines.length === 0) {
            throw new Error('No dialogue lines found in subtitle file');
        }

        const dialogGroups = this.groupDialogLines(dialogLines.slice(0, maxDialogs));
        
        if (onProgress) {
            onProgress({ 
                type: 'start', 
                totalGroups: dialogGroups.length,
                totalDialogs: Math.min(dialogLines.length, maxDialogs)
            });
        }

        for (const [index, group] of dialogGroups.entries()) {
            if (onProgress) {
                onProgress({ 
                    type: 'progress', 
                    currentGroup: index + 1, 
                    totalGroups: dialogGroups.length 
                });
            }
            
            const context = {
                previous: dialogGroups[index - 1]?.map(g => g.original).join('\n') || '',
                current: group.map(g => g.original).join('\n'),
                next: dialogGroups[index + 1]?.map(g => g.original).join('\n') || '',
            };

            const translatedGroup = await this.translateGroup(group, context, onProgress, customPromptPath);
            translatedLines.push(...translatedGroup);

            const delay = index % 5 === 0 ? 500 : 200;
            await new Promise(resolve => setTimeout(resolve, delay));
        }

        const finalOutputPath = outputPath || filePath.replace('.ass', '_translated.ass');
        const finalContent = lines
            .filter(line => !line.startsWith('Dialogue:'))
            .concat(translatedLines)
            .join('\n');

        await fs.writeFile(finalOutputPath, finalContent);

        if (onProgress) {
            onProgress({ 
                type: 'complete', 
                outputPath: finalOutputPath,
                translatedCount: translatedLines.length
            });
        }

        return {
            success: true,
            outputPath: finalOutputPath,
            translatedCount: translatedLines.length,
            originalCount: dialogLines.length
        };
    }

    async translateSubtitlesFromBuffer(content, options = {}) {
        const tempPath = path.join(require('os').tmpdir(), `temp_subtitle_${Date.now()}.ass`);
        
        try {
            await fs.writeFile(tempPath, content);
            const result = await this.translateSubtitles(tempPath, options);
            
            const translatedContent = await fs.readFile(result.outputPath, 'utf-8');
            await fs.unlink(tempPath);
            await fs.unlink(result.outputPath);
            
            return {
                success: true,
                content: translatedContent,
                translatedCount: result.translatedCount,
                originalCount: result.originalCount
            };
        } catch (error) {
            try {
                await fs.unlink(tempPath);
            } catch {}
            throw error;
        }
    }
}

module.exports = TranslationService; 