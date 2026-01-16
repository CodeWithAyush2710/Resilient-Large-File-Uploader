import { Router, Request, Response, NextFunction } from 'express';
import fs from 'fs';
import { PrismaClient, Status } from '@prisma/client';
import { writeChunk, assembleFile, peekZip, getFilePath } from '../services/fileService';

const router = Router();
const prisma = new PrismaClient();

// Handle BigInt serialization
(BigInt.prototype as any).toJSON = function () {
    return this.toString();
};

// Helper to handle async errors
const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) => (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

// Handshake / Init
router.post('/init', asyncHandler(async (req: Request, res: Response) => {
    const { filename, totalSize, totalChunks } = req.body;

    // Simple validation
    if (!filename || !totalSize || !totalChunks) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    let upload = await prisma.upload.findFirst({
        where: {
            filename,
            totalSize: BigInt(totalSize),
            status: Status.UPLOADING
        }
    });

    if (!upload) {
        upload = await prisma.upload.create({
            data: {
                filename,
                totalSize: BigInt(totalSize),
                totalChunks
            }
        });
    }

    // Get existing uploaded chunks
    const existingChunks = await prisma.chunk.findMany({
        where: { uploadId: upload.id, status: Status.COMPLETED },
        select: { chunkIndex: true }
    });

    res.json({
        uploadId: upload.id,
        existingChunks: existingChunks.map((c: { chunkIndex: number }) => c.chunkIndex)
    });
}));

// Receive Chunk
router.post('/chunk', asyncHandler(async (req: Request, res: Response) => {
    const { uploadId, chunkIndex } = req.query; 

    if (!uploadId || !chunkIndex) {
        return res.status(400).json({ error: 'Missing metadata' });
    }

    const uId = String(uploadId);
    const cIndex = Number(chunkIndex);

    

    // Create or update chunk status
    await prisma.chunk.upsert({
        where: { uploadId_chunkIndex: { uploadId: uId, chunkIndex: cIndex } },
        create: { uploadId: uId, chunkIndex: cIndex, status: Status.UPLOADING },
        update: { status: Status.UPLOADING }
    });

    // Calculate offset. Use Prisma to get totalSize to ensure safety or just trust client?
    // Let's assume standard 5MB chunks.
    const CHUNK_SIZE = 5 * 1024 * 1024;
    const offset = cIndex * CHUNK_SIZE;


    const { data } = req.body; 
    if (!data) return res.status(400).send('No data');

    const buffer = Buffer.from(data, 'base64');

    await writeChunk(uId, cIndex, buffer, offset);

    // Mark as COMPLETED
    await prisma.chunk.update({
        where: { uploadId_chunkIndex: { uploadId: uId, chunkIndex: cIndex } },
        data: { status: Status.COMPLETED }
    });

    res.json({ status: 'ok' });
}));

// Finalize
router.post('/finalize', asyncHandler(async (req: Request, res: Response) => {
    const { uploadId } = req.body;

    // Use updateMany to atomicalliy transition from UPLOADING to PROCESSING
    // This acts as an optimistic lock. Only one concurrent request will succeed.
    const { count } = await prisma.upload.updateMany({
        where: {
            id: uploadId,
            status: Status.UPLOADING
        },
        data: { status: Status.PROCESSING }
    });

    if (count === 0) {
        // If we didn't update anything, check current status
        const upload = await prisma.upload.findUnique({ where: { id: uploadId } });
        if (!upload) return res.status(404).json({ error: 'Upload not found' });

        return res.json({ status: upload.status, message: 'Upload already finalized or processing' });
    }

    // Now we own the "PROCESSING" state.
    // Fetch upload details needed for verification
    const upload = await prisma.upload.findUnique({ where: { id: uploadId } });
    if (!upload) throw new Error('Upload disappeared'); // Should not happen

    try {
        // Verify all chunks are present
        const chunkCount = await prisma.chunk.count({
            where: { uploadId, status: Status.COMPLETED }
        });

        if (chunkCount !== upload.totalChunks) {
            // Rollback to UPLOADING so user can retry missing chunks? 
            // Or Stay in FAILED?
            throw new Error(`Missing chunks. Expected ${upload.totalChunks}, got ${chunkCount}`);
        }

        // Assemble / Verify
        const filePath = await assembleFile(uploadId, upload.filename);

        // Peek
        const files = await peekZip(filePath);

        // Calculate Hash (TODO: Stream the hash calculation)
        const finalHash = "dummy_hash"; // Implement actual hash if needed

        await prisma.upload.update({
            where: { id: uploadId },
            data: { status: Status.COMPLETED, finalHash }
        });

        res.json({ status: 'completed', files, hash: finalHash });
    } catch (err: any) {
        console.error("Finalization failed:", err);
        // Revert to UPLOADING so it can be retried, or FAILED?
        await prisma.upload.update({
            where: { id: uploadId },
            data: { status: Status.FAILED }
        });
        res.status(500).json({ error: err.message });
    }
}));

// Cleanup orphaned uploads (e.g. started > 24h ago and not completed)
router.post('/cleanup', asyncHandler(async (req: Request, res: Response) => {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago

    const orphaned = await prisma.upload.findMany({
        where: {
            status: Status.UPLOADING,
            createdAt: { lt: cutoff }
        }
    });

    for (const upload of orphaned) {
        // Delete chunks from DB
        await prisma.chunk.deleteMany({ where: { uploadId: upload.id } });

        // Delete upload record
        await prisma.upload.delete({ where: { id: upload.id } });

        // Clean up file system
        const filePath = getFilePath(upload.id);
        if (fs.existsSync(filePath)) {
            await fs.promises.unlink(filePath);
        }
        console.log(`Cleaned up orphaned upload ${upload.id}`);
    }

    res.json({ cleaned: orphaned.length });
}));

export default router;
