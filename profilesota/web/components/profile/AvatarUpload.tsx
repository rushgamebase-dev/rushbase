'use client';

import { useRef, useState } from 'react';
import { Avatar } from './Avatar';
import { useAvatarUpload } from '../../hooks/useAvatarUpload';
import type { Address } from '../../types/profile';

interface AvatarUploadProps { currentAvatarUrl: string | null; walletAddress: Address; onUpload: (url: string) => void; }

export function AvatarUpload({ currentAvatarUrl, walletAddress, onUpload }: AvatarUploadProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const { upload, isUploading, progress } = useAvatarUpload();
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    try { const url = await upload(file); setPreview(url); onUpload(url); }
    catch (err: any) { setError(err.message || 'Upload failed'); }
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleRemove = () => { setPreview(null); onUpload(''); };
  const displayUrl = preview || currentAvatarUrl;

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative">
        <Avatar address={walletAddress} avatarUrl={displayUrl} size={96} className="ring-2 ring-[#1a1a1a]" />
        {isUploading && (
          <div className="absolute inset-0 rounded-full bg-black/60 flex items-center justify-center">
            <span className="text-xs font-mono text-[#00ff88]">{progress}%</span>
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => fileRef.current?.click()} disabled={isUploading}
          className="text-xs font-mono text-[#00ff88] border border-[#00ff88]/30 rounded px-3 py-1.5 hover:bg-[#00ff88]/10 transition-colors disabled:opacity-50">
          {isUploading ? 'Uploading...' : 'Upload'}
        </button>
        {displayUrl && (
          <button type="button" onClick={handleRemove} disabled={isUploading}
            className="text-xs font-mono text-[#ff4444] border border-[#ff4444]/30 rounded px-3 py-1.5 hover:bg-[#ff4444]/10 transition-colors disabled:opacity-50">Remove</button>
        )}
      </div>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={handleFileChange} className="hidden" />
      {error && <p className="text-[10px] font-mono text-[#ff4444]">{error}</p>}
      <p className="text-[10px] font-mono text-[#666666]">PNG, JPG or WebP. Max 2MB.</p>
    </div>
  );
}
