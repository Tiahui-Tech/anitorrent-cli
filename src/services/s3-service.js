const AWS = require('aws-sdk');
const fs = require('fs').promises;

class S3Service {
    constructor(config) {
        this.s3 = new AWS.S3({
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
            endpoint: config.endpoint,
            s3ForcePathStyle: true,
            signatureVersion: 'v4',
            httpOptions: { timeout: 0 },
        });
        this.bucketName = config.bucketName;
        this.publicDomain = config.publicDomain || 'https://cdn.anitorrent.com';
    }

    async uploadFile(filePath, fileName, silent = false) {
        try {
            const fileBuffer = await fs.readFile(filePath);
            
            const params = {
                Bucket: this.bucketName,
                Key: fileName,
                Body: fileBuffer,
                ACL: 'public-read',
            };

            if (!silent) {
                console.log(`Uploading ${fileName} to R2...`);
            }
            const uploadResult = await this.s3.upload(params).promise();
            const publicUrl = this.getPublicUrl(fileName);

            return { ...uploadResult, publicUrl };
        } catch (error) {
            throw new Error(`Error uploading file: ${error.message}`);
        }
    }

    getPublicUrl(fileName) {
        return `${this.publicDomain}/${fileName}`;
    }

    async getFile(fileName) {
        const params = {
            Bucket: this.bucketName,
            Key: fileName
        };

        try {
            const data = await this.s3.getObject(params).promise();
            return data.Body;
        } catch (error) {
            throw new Error(`Error getting file from R2: ${error.message}`);
        }
    }

    async getSignedUrl(fileName, expirationInSeconds = 3600) {
        const params = {
            Bucket: this.bucketName,
            Key: fileName,
            Expires: expirationInSeconds
        };

        return this.s3.getSignedUrlPromise('getObject', params);
    }

    async deleteFile(fileName, silent = false) {
        const params = {
            Bucket: this.bucketName,
            Key: fileName
        };

        try {
            await this.s3.deleteObject(params).promise();
            if (!silent) {
                console.log(`File ${fileName} deleted successfully`);
            }
            return true;
        } catch (error) {
            throw new Error(`Error deleting file: ${error.message}`);
        }
    }
}

module.exports = S3Service; 