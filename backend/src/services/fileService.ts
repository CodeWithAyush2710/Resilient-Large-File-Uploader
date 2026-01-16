import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import yauzl from 'yauzl';

const UPLOAD_DIR = path.join(__dirname, '../../uploads');

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

export const getFilePath = (uploadId: string) => path.join(UPLOAD_DIR, `${uploadId}.bin`);

export const writeChunk = async (uploadId: string, index: number, buffer: Buffer, offset: number) => {
    const filePath = getFilePath(uploadId);

    // Create file if it doesn't exist (essentially "touch" it or start writing)
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, '');
    }

    const fileHandle = await fs.promises.open(filePath, 'r+');
    try {
        const { bytesWritten } = await fileHandle.write(buffer, 0, buffer.length, offset);
        console.log(`Written ${bytesWritten} bytes to ${filePath} at offset ${offset}`);
        return bytesWritten;
    } finally {
        await fileHandle.close();
    }
};

export const assembleFile = async (uploadId: string, finalFilename: string) => {

    // We will verify the file size.
    const tempPath = getFilePath(uploadId);
    const finalPath = path.join(UPLOAD_DIR, `${uploadId}_${finalFilename}`);

    await fs.promises.rename(tempPath, finalPath);
    return finalPath;
};

export const peekZip = (filePath: string): Promise<string[]> => {
    return new Promise((resolve, reject) => {
        const filenames: string[] = [];
        yauzl.open(filePath, { lazyEntries: true }, (err, zipfile) => {
            if (err) return reject(err);

            zipfile.readEntry();
            zipfile.on('entry', (entry) => {
                if (!/\/$/.test(entry.fileName)) { // Skip directories if you only want files
                    filenames.push(entry.fileName);
                }
                // Limit to first 10 files to avoid huge lists
                if (filenames.length < 10) {
                    zipfile.readEntry();
                } else {
                    zipfile.close();
                    resolve(filenames);
                }
            });

            zipfile.on('end', () => {
                resolve(filenames);
            });

            zipfile.on('error', (err) => {
                reject(err);
            });
        });
    });
};
