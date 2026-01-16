import React, { useState } from 'react';
import { Uploader } from '../utils/uploader';
import type { UploadStatus } from '../utils/uploader';
import { ProgressBar } from './ProgressBar';
import { ChunkGrid } from './ChunkGrid';
import { UploadCloud, FileIcon, CheckCircle, AlertTriangle } from 'lucide-react';

export const UploadManager: React.FC = () => {
    const [file, setFile] = useState<File | null>(null);
    const [status, setStatus] = useState<UploadStatus | null>(null);
    const [uploader, setUploader] = useState<Uploader | null>(null);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const selectedFile = e.target.files[0];
            setFile(selectedFile);

            const newUploader = new Uploader(selectedFile, (s) => setStatus(s));
            setUploader(newUploader);
            setStatus(null);
        }
    };

    const startUpload = () => {
        if (uploader) {
            uploader.start();
        }
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-950 text-white p-6">
            <div className="w-full max-w-2xl bg-gray-900 border border-gray-800 rounded-xl p-8 shadow-2xl">
                <h2 className="text-2xl font-bold text-center text-blue-400 mb-6">Resilient Large File Uploader</h2>

                {!file && (
                    <label className="flex flex-col items-center justify-center h-48 border-2 border-dashed border-gray-700 rounded-lg cursor-pointer hover:border-blue-500 hover:bg-gray-800 transition-colors">
                        <UploadCloud size={48} className="text-gray-500 mb-4" />
                        <span className="text-lg text-gray-300">Choose a large file to upload</span>
                        <input type="file" className="hidden" onChange={handleFileChange} />
                    </label>
                )}

                {file && (
                    <div className="space-y-6">
                        <div className="flex items-center justify-between bg-gray-800 p-4 rounded-lg">
                            <div className="flex items-center gap-4 overflow-hidden">
                                <FileIcon size={32} className="text-blue-400 flex-shrink-0" />
                                <div className="min-w-0">
                                    <h3 className="font-medium truncate">{file.name}</h3>
                                    <p className="text-sm text-gray-400">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                                </div>
                            </div>

                            {!status && (
                                <button
                                    onClick={startUpload}
                                    className="bg-blue-600 hover:bg-blue-500 px-6 py-2 rounded-lg font-medium transition-colors flex-shrink-0"
                                >
                                    Upload
                                </button>
                            )}
                        </div>

                        {status && (
                            <>
                                <ProgressBar
                                    progress={(status.uploaded / status.total) * 100}
                                    speed={status.speed}
                                    eta={status.eta}
                                />

                                {status.status === 'COMPLETED' && (
                                    <div className="flex items-center gap-2 text-green-400 bg-green-900/20 p-4 rounded-lg border border-green-900">
                                        <CheckCircle size={20} />
                                        <span>Upload Completed Successfully!</span>
                                    </div>
                                )}

                                {status.status === 'ERROR' && (
                                    <div className="flex items-center gap-2 text-red-400 bg-red-900/20 p-4 rounded-lg border border-red-900">
                                        <AlertTriangle size={20} />
                                        <span>Upload Failed. Check console or retry.</span>
                                    </div>
                                )}

                                <ChunkGrid chunks={status.chunks} />
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
