# Resilient Large File Uploader - Technical Documentation
![Resilient Large File Uploader Demo](assets/file_uploader.png)
This project implements a robust, resumable file upload system designed to handle large files (ZIP archives) with resilience against network interruptions.

## 1. File Integrity & Validation

Ensuring the uploaded file is identical to the source is critical. We approached this using a multi-layered strategy:

### A. Size Verification
The primary integrity check relies on strict size accounting.
- **Total Size Enforcement:** When an upload is initialized (`/init`), the `totalSize` is stored in the database.
- **Chunk Accounting:** During the `finalize` phase, we query the `Chunk` table to count the number of successfully uploaded chunks. We verify that `count matches totalChunks`.
- **Atomic Writes:** We use Node.js `fs` module to write buffers to specific **offsets**. This ensures that even if chunks arrive out of order, they are placed correctly in the file.

### B. Structure Verification (ZIP)
Since the specific requirement was for ZIP files, we implemented a structural check using `yauzl` (Yet Another Unzip Library).
- Before marking an upload as `COMPLETED`, the server performs a "peek" operation (`peekZip` in `fileService.ts`).
- It attempts to read the ZIP Central Directory. If this fails, it indicates the file is corrupted or incomplete, and the upload is marked as `FAILED`.

### C. Hashing Architecture
The database schema (`Upload` model) includes a `finalHash` field.
- **Current State:** The system is architected to store a cryptographic hash (e.g., SHA-256) of the final file.
- **Implementation Note:** In the current version, integrity is primarily guaranteed by the TCP protocol, exact chunk offsets, and ZIP structure validation. The `finalHash` logic serves as a placeholder for a future comprehensive cryptographic verification step (see *Future Enhancements*).

## 2. Pause / Resume Logic

The core feature of this system is its ability to recover from interruptions without restarting the upload from 0%. This is achieved via a **Handshake Protocol**:

### Step 1: Initialization / Handshake (`POST /init`)
When the client starts an upload, it sends the `filename` and `totalSize`.
- The server queries the database for an existing record matching these parameters with a status of `UPLOADING`.
- **Response:** The server returns an `uploadId` and a list of `existingChunks` (indices of chunks already successfully saved).

### Step 2: Client-Side Deduping
- The client receives the list of `existingChunks`.
- It filters its own queue, removing these chunks from the "to-do" list.
- It only begins uploading the *missing* chunks.

### Step 3: Idempotent Chunk Upload (`POST /chunk`)
- If a network error occurs mid-chunk, the client might retry sending it.
- **Resilience:** The frontend implements an **exponential backoff strategy with up to 10 retries**. This ensures the system stays robust even under high failure rates (e.g., 30% simulated packet loss).
- The server uses `prisma.chunk.upsert`. If the chunk record already exists, it updates it (idempotency); if not, it creates it.
- This ensures that duplicate chunk submissions do not corrupt the file or database state.

### Step 4: Atomic Finalization (`POST /finalize`)
- **Concurrency Control:** To handle the specific "Double-Finalize" edge case (two requests arriving simultaneously), we use an **Optimistic Locking** strategy via the database.
- The server performs an atomic `updateMany` filtering by `{ id, status: 'UPLOADING' }`. Only the request that successfully changes the status to `PROCESSING` is allowed to proceed with assembly.
- Any subsequent requests receive a status message indicating the process is already complete or in progress.

## 3. Known Trade-offs

During development, several engineering trade-offs were made to balance complexity, performance, and time constraints:

- **Base64 Encoding vs. Binary Streaming:**
  - **Decision:** We used JSON bodies with Base64 encoded strings for chunk transmission.
  - **Trade-off:** This introduces a ~33% overhead in data size and higher CPU usage for encoding/decoding.
  - **Reasoning:** It simplifies the API contract and debugging (easier to inspect JSON payloads) compared to handling multipart/form-data or raw binary streams directly in Express headers.

- **Local Filesystem Storage:**
  - **Decision:** Files are stored directly on the server's local disk (`/uploads`).
  - **Trade-off:** This makes the backend "stateful" regarding disk storage, making it harder to scale horizontally (add more servers) without a shared network drive.
  - **Reasoning:** It simplifies the implementation of "write-at-offset" logic needed for out-of-order chunk assembly. Cloud storage (S3) generally requires uploading parts and then making a separate API call to combine them, which is a different architectural pattern.

- **Synchronous Chunk Processing:**
  - **Decision:** `fs.promises.open` and `handle.write` are used for each chunk request.
  - **Trade-off:** While Node.js handles I/O asynchronously, opening and closing file handles for thousands of small chunks can be IOPS intensive.
  - **Reasoning:** It ensures data safety. If the server crashes, written bytes are persisted on disk immediately.

## 4. Future Enhancements

To take this project to a production-ready enterprise level, the following improvements are recommended:

1.  **Streaming Hash Calculation:** Implement an incremental hash (e.g., using `crypto.createHash`) that updates as each chunk is written, rather than reading the whole file at the end.
2.  **S3 / Object Storage Integration:** Replace the local filesystem with AWS S3 Multipart Uploads. This would allow the backend to be stateless and scalable.
3.  **Expiration Policies:** Enhance the cleanup job to notify users before their incomplete uploads are deleted, or archive them to cheaper cold storage.
4.  **Binary Transport:** Switch from Base64 JSON to raw binary `application/octet-stream` for chunk uploads to reduce bandwidth usage and latency.
5.  **Access Control:** Add authentication (JWT) to ensure users can only resume and view their own files.
