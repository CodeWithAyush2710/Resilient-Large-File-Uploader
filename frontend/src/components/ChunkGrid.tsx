import React from 'react';
import type { ChunkStatus } from '../utils/uploader';
import clsx from 'clsx';

interface Props {
    chunks: ChunkStatus[];
}

export const ChunkGrid: React.FC<Props> = ({ chunks }) => {
    return (
        <div className="mt-8 max-w-4xl">
            <h3 className="text-gray-200 mb-4 font-semibold">Chunk Status</h3>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(20px,1fr))] gap-1 max-h-60 overflow-y-auto p-2 bg-gray-900 rounded border border-gray-800">
                {chunks.map((chunk) => {
                    let color = 'bg-gray-700'; // Pending
                    if (chunk.status === 'UPLOADING') color = 'bg-blue-500 animate-pulse';
                    if (chunk.status === 'SUCCESS') color = 'bg-green-500';
                    if (chunk.status === 'ERROR') color = 'bg-red-500';

                    return (
                        <div
                            key={chunk.index}
                            className={clsx("h-5 w-5 rounded-sm", color)}
                            title={`Chunk ${chunk.index}: ${chunk.status}`}
                        />
                    );
                })}
            </div>
            <div className="flex gap-4 mt-2 text-xs text-gray-400">
                <div className="flex items-center gap-1"><div className="w-3 h-3 bg-gray-700 rounded-sm"></div> Pending</div>
                <div className="flex items-center gap-1"><div className="w-3 h-3 bg-blue-500 rounded-sm"></div> Uploading</div>
                <div className="flex items-center gap-1"><div className="w-3 h-3 bg-green-500 rounded-sm"></div> Success</div>
                <div className="flex items-center gap-1"><div className="w-3 h-3 bg-red-500 rounded-sm"></div> Error</div>
            </div>
        </div>
    );
};
