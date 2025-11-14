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
        this.publicDomain = config.publicDomain || 'https://link.storjshare.io/raw/jwrbj2f6pcl4pkhmlag5tulgcwya/video-metadata';
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
                console.log(`Uploading ${fileName} to S3...`);
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
            throw new Error(`Error getting file from S3: ${error.message}`);
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

    async copyFile(sourceFileName, destinationFileName, silent = false) {
        const copyParams = {
            Bucket: this.bucketName,
            CopySource: `${this.bucketName}/${sourceFileName}`,
            Key: destinationFileName,
            ACL: 'public-read'
        };

        try {
            if (!silent) {
                console.log(`Copying ${sourceFileName} to ${destinationFileName}...`);
            }
            await this.s3.copyObject(copyParams).promise();
            return true;
        } catch (error) {
            throw new Error(`Error copying file: ${error.message}`);
        }
    }

    async renameFile(oldFileName, newFileName, silent = false) {
        try {
            // Copy file to new name
            await this.copyFile(oldFileName, newFileName, silent);
            
            // Delete old file
            await this.deleteFile(oldFileName, silent);
            
            if (!silent) {
                console.log(`File renamed from ${oldFileName} to ${newFileName}`);
            }
            
            const publicUrl = this.getPublicUrl(newFileName);
            return { success: true, publicUrl };
        } catch (error) {
            throw new Error(`Error renaming file: ${error.message}`);
        }
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