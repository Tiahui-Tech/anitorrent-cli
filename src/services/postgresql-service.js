const { Pool } = require('pg');
const { logger } = require('../utils/logger');

class PostgreSQLService {
    constructor(config) {
        this.config = config;
        this.pool = new Pool({
            host: config.host,
            port: config.port || 5432,
            database: config.database,
            user: config.user,
            password: config.password,
            ssl: config.ssl || false,
            max: 20,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 2000,
        });

        this.pool.on('error', (err) => {
            logger.error('Unexpected error on idle client', err);
        });
    }

    async testConnection() {
        try {
            const client = await this.pool.connect();
            await client.query('SELECT NOW()');
            client.release();
            return { success: true, message: 'Database connection successful' };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    async getEpisodeByNumber(anilistId, episodeNumber) {
        const query = `
            SELECT 
                id,
                "idAnilist",
                "episodeNumber",
                "peertubeId",
                uuid,
                "shortUUID",
                password,
                title,
                "embedUrl",
                "thumbnailUrl",
                description,
                duration,
                "isReady",
                "createdAt",
                "updatedAt"
            FROM peertube_episode 
            WHERE "idAnilist" = $1 AND "episodeNumber" = $2
        `;

        try {
            const result = await this.pool.query(query, [anilistId, episodeNumber]);
            return result.rows.length > 0 ? result.rows[0] : null;
        } catch (error) {
            throw new Error(`Database query failed: ${error.message}`);
        }
    }

    async getAnimeEpisodes(anilistId) {
        const query = `
            SELECT 
                id,
                "idAnilist",
                "episodeNumber",
                "peertubeId",
                uuid,
                "shortUUID",
                password,
                title,
                "embedUrl",
                "thumbnailUrl",
                description,
                duration,
                "isReady",
                "createdAt",
                "updatedAt"
            FROM peertube_episode 
            WHERE "idAnilist" = $1
            ORDER BY "episodeNumber" ASC
        `;

        try {
            const result = await this.pool.query(query, [anilistId]);
            return result.rows;
        } catch (error) {
            throw new Error(`Database query failed: ${error.message}`);
        }
    }

    async insertEpisode(episodeData) {
        const {
            idAnilist,
            episodeNumber,
            peertubeId,
            uuid,
            shortUUID,
            password,
            title,
            embedUrl,
            thumbnailUrl,
            description,
            duration,
            isReady = false
        } = episodeData;

        const query = `
            INSERT INTO peertube_episode (
                "idAnilist", "episodeNumber", "peertubeId", uuid, "shortUUID",
                password, title, "embedUrl", "thumbnailUrl", description,
                duration, "isReady", "createdAt", "updatedAt"
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
            RETURNING *
        `;

        try {
            const result = await this.pool.query(query, [
                idAnilist, episodeNumber, peertubeId, uuid, shortUUID,
                password, title, embedUrl, thumbnailUrl, description,
                duration, isReady
            ]);
            return result.rows[0];
        } catch (error) {
            throw new Error(`Database insert failed: ${error.message}`);
        }
    }

    async updateEpisode(id, episodeData) {
        const fields = [];
        const values = [];
        let parameterIndex = 1;

        Object.entries(episodeData).forEach(([key, value]) => {
            if (value !== undefined) {
                fields.push(`"${key}" = $${parameterIndex}`);
                values.push(value);
                parameterIndex++;
            }
        });

        if (fields.length === 0) {
            throw new Error('No fields to update');
        }

        fields.push(`"updatedAt" = NOW()`);

        const query = `
            UPDATE peertube_episode 
            SET ${fields.join(', ')}
            WHERE id = $${parameterIndex}
            RETURNING *
        `;

        values.push(id);

        try {
            const result = await this.pool.query(query, values);
            return result.rows.length > 0 ? result.rows[0] : null;
        } catch (error) {
            throw new Error(`Database update failed: ${error.message}`);
        }
    }

    async getAnimeById(anilistId) {
        const query = `
            SELECT 
                id,
                "idAnilist",
                "idMal",
                title,
                description,
                "descriptionTranslated",
                season,
                "seasonYear",
                format,
                status,
                episodes,
                duration,
                genres,
                "coverImage",
                "bannerImage",
                synonyms,
                "nextAiringEpisode",
                "startDate",
                trailer
            FROM anime 
            WHERE "idAnilist" = $1
        `;

        try {
            const result = await this.pool.query(query, [anilistId]);
            return result.rows.length > 0 ? result.rows[0] : null;
        } catch (error) {
            throw new Error(`Database query failed: ${error.message}`);
        }
    }

    async getLatestEpisodes(limit = 100) {
        const query = `
            SELECT 
                pe.id,
                pe."idAnilist",
                pe."episodeNumber",
                pe."peertubeId",
                pe.uuid,
                pe."shortUUID",
                pe.password,
                pe.title,
                pe."embedUrl",
                pe."thumbnailUrl",
                pe.description,
                pe.duration,
                pe."isReady",
                pe."createdAt",
                pe."updatedAt",
                a.title as "animeTitle"
            FROM peertube_episode pe
            LEFT JOIN anime a ON pe."idAnilist" = a."idAnilist"
            ORDER BY pe."createdAt" DESC
            LIMIT $1
        `;

        try {
            const result = await this.pool.query(query, [limit]);
            return result.rows;
        } catch (error) {
            throw new Error(`Database query failed: ${error.message}`);
        }
    }

    async getEpisodesForThumbnailUpdate(limit = 50) {
        const query = `
            SELECT 
                id,
                "idAnilist",
                "episodeNumber",
                "thumbnailUrl"
            FROM peertube_episode 
            ORDER BY "updatedAt" DESC
            LIMIT $1
        `;

        try {
            const result = await this.pool.query(query, [limit]);
            
            const episodesByAnilist = {};
            result.rows.forEach(episode => {
                if (!episodesByAnilist[episode.idAnilist]) {
                    episodesByAnilist[episode.idAnilist] = [];
                }
                episodesByAnilist[episode.idAnilist].push(episode);
            });

            return episodesByAnilist;
        } catch (error) {
            throw new Error(`Database query failed: ${error.message}`);
        }
    }

    async close() {
        await this.pool.end();
    }
}

module.exports = PostgreSQLService;