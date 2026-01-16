import React from 'react';
import { motion } from 'framer-motion';

interface Props {
    progress: number; // 0-100
    speed: number; // MB/s
    eta: number; // seconds
}

export const ProgressBar: React.FC<Props> = ({ progress, speed, eta }) => {
    return (
        <div className="w-full max-w-2xl bg-gray-800 rounded-lg p-4 shadow-lg border border-gray-700">
            <div className="flex justify-between mb-2 text-sm text-gray-300">
                <span>Upload Progress</span>
                <span>{progress.toFixed(1)}%</span>
            </div>
            <div className="h-4 bg-gray-700 rounded-full overflow-hidden">
                <motion.div
                    className="h-full bg-blue-500"
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    transition={{ duration: 0.5 }}
                />
            </div>
            <div className="flex justify-between mt-2 text-xs text-gray-400">
                <span>Speed: {speed.toFixed(2)} MB/s</span>
                <span>ETA: {eta.toFixed(0)}s</span>
            </div>
        </div>
    );
};
