import axios from 'axios';

const API_URL = 'http://localhost:3001/api/upload';
const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB
const CONCURRENCY = 3;

export interface UploadStatus {
    total: number;
    uploaded: number;
    chunks: ChunkStatus[];
    status: 'IDLE' | 'UPLOADING' | 'COMPLETED' | 'ERROR';
    speed: number; // MB/s
    eta: number; // seconds
}

export interface ChunkStatus {
    index: number;
    status: 'PENDING' | 'UPLOADING' | 'SUCCESS' | 'ERROR';
    attempts: number;
}

export class Uploader {
    private file: File;
    private uploadId: string | null = null;
    private chunks: ChunkStatus[] = [];
    private onProgress: (status: UploadStatus) => void;
    private activeRequestCount = 0;
    private queue: number[] = [];
    private aborted = false;
    private startTime = 0;
    private loadedBytes = 0;

    constructor(file: File, onProgress: (status: UploadStatus) => void) {
        this.file = file;
        this.onProgress = onProgress;

        // Initialize chunks
        const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
        for (let i = 0; i < totalChunks; i++) {
            this.chunks.push({ index: i, status: 'PENDING', attempts: 0 });
        }
    }

    public async start() {
        this.startTime = Date.now();
        try {
            // 1. Handshake
            await this.handshake();

            // 2. Queue all non-success chunks
            this.queue = this.chunks
                .filter(c => c.status !== 'SUCCESS')
                .map(c => c.index);

            // 3. Process Queue
            await this.processQueue();

            // 4. Finalize
            if (!this.aborted && this.chunks.every(c => c.status === 'SUCCESS')) {
                await this.finalize();
            }
        } catch (err) {
            console.error('Upload failed', err);
            this.updateStatus('ERROR');
        }
    }

    private async handshake() {
        const { data } = await axios.post(`${API_URL}/init`, {
            filename: this.file.name,
            totalSize: this.file.size,
            totalChunks: this.chunks.length
        });

        this.uploadId = data.uploadId;

        // Mark existing chunks as success
        if (data.existingChunks) {
            data.existingChunks.forEach((index: number) => {
                if (this.chunks[index]) {
                    this.chunks[index].status = 'SUCCESS';
                    this.loadedBytes += this.getChunkSize(index);
                }
            });
        }

        this.updateStatus('UPLOADING');
    }

    private async processQueue() {
        // Use a semaphore-like pattern with Promise.race or recursion
        // A simple way to maintaining CONCURRENCY is to start N workers.

        const workers = [];
        for (let i = 0; i < CONCURRENCY; i++) {
            workers.push(this.worker());
        }
        await Promise.all(workers);
    }

    private async worker() {
        while (!this.aborted && this.queue.length > 0) {
            const index = this.queue.shift();
            if (index === undefined) break;

            await this.uploadChunk(index);
        }
    }

    private async uploadChunk(index: number) {
        this.activeRequestCount++;
        this.chunks[index].status = 'UPLOADING';
        this.updateStatus('UPLOADING');

        try {
            const chunk = this.getChunk(index);
            const base64 = await this.blobToBase64(chunk);

            // Retry 10 times to survive "30% failure rate"
            // Probability of 10 consecutive failures at 30% rate = 0.3^10 (negligible)
            await this.axiosRetry(() => axios.post(`${API_URL}/chunk`, {
                data: base64
            }, {
                params: { uploadId: this.uploadId, chunkIndex: index }
            }), 10, 1000);

            this.chunks[index].status = 'SUCCESS';
            this.loadedBytes += chunk.size;
        } catch (err) {
            console.error(`Chunk ${index} failed after multiple retries`, err);
            this.chunks[index].status = 'ERROR';
            this.aborted = true; // Stop other workers
            // If we want to allow "Resume" after this error, the user effectively has to click "Upload" again (re-init uploader).
            // That works fine with the architecture.
        } finally {
            this.activeRequestCount--;
            this.updateStatus('UPLOADING');
        }
    }

    private getChunk(index: number) {
        const start = index * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, this.file.size);
        return this.file.slice(start, end);
    }

    private getChunkSize(index: number) {
        const start = index * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, this.file.size);
        return end - start;
    }

    private blobToBase64(blob: Blob): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const res = reader.result as string;
                // remove data:application/octet-stream;base64, prefix
                resolve(res.split(',')[1]);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    private async axiosRetry<T>(fn: () => Promise<T>, retries = 10, delay = 1000): Promise<T> {
        try {
            return await fn();
        } catch (err) {
            if (retries > 0) {
                // Exponential backoff
                const nextDelay = delay * 2;
                console.warn(`Retrying... attempts left: ${retries}, waiting ${delay}ms`);
                await new Promise(r => setTimeout(r, delay));
                return this.axiosRetry(fn, retries - 1, nextDelay);
            }
            throw err;
        }
    }

    private async finalize() {
        const { data } = await axios.post(`${API_URL}/finalize`, {
            uploadId: this.uploadId
        });
        console.log('Finalized', data);
        this.updateStatus('COMPLETED');
    }

    private updateStatus(status: UploadStatus['status']) {
        const timeElapsed = (Date.now() - this.startTime) / 1000;
        const speed = timeElapsed > 0 ? (this.loadedBytes / 1024 / 1024) / timeElapsed : 0;
        const remainingBytes = this.file.size - this.loadedBytes;
        const eta = speed > 0 ? remainingBytes / 1024 / 1024 / speed : 0;

        this.onProgress({
            total: this.file.size,
            uploaded: this.loadedBytes,
            chunks: [...this.chunks],
            status,
            speed,
            eta
        });
    }
}
