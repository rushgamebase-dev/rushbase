'use client';

import { useRef, useState } from 'react';
import type { UserProfileFull, ProfileUpdatePayload } from '../../types/profile';
import { useHandleAvailability } from '../../hooks/useHandleAvailability';
import { uploadFile } from '../../lib/api';
import { getDefaultAvatar } from '../../lib/avatar';

interface ProfileEditorProps { profile: UserProfileFull; onSave: (updates: ProfileUpdatePayload) => Promise<void>; isSaving: boolean; }

const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export function ProfileEditor({ profile, onSave, isSaving }: ProfileEditorProps) {
  const [handle, setHandle] = useState(profile.profile?.handle || '');
  const [displayName, setDisplayName] = useState(profile.profile?.displayName || '');
  const [bio, setBio] = useState(profile.profile?.bio || '');
  const [avatarUrl, setAvatarUrl] = useState(profile.profile?.avatarUrl || '');
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { isAvailable, isChecking } = useHandleAvailability(handle !== (profile.profile?.handle || '') ? handle : '');

  const handleFile = async (file: File) => {
    setError(null);
    if (file.size > MAX_BYTES) { setError('Image too large (max 2 MB)'); return; }
    if (!ALLOWED.includes(file.type)) { setError(`Unsupported type: ${file.type}`); return; }
    try {
      setUploading(true);
      const res = await uploadFile<{ avatarUrl: string }>('/users/me/avatar', file);
      setAvatarUrl(res.avatarUrl);
    } catch (err: any) {
      setError(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null);
    const updates: ProfileUpdatePayload = {};
    if (handle !== (profile.profile?.handle || '')) updates.handle = handle;
    if (displayName !== (profile.profile?.displayName || '')) updates.displayName = displayName;
    if (bio !== (profile.profile?.bio || '')) updates.bio = bio;
    if (avatarUrl !== (profile.profile?.avatarUrl || '')) updates.avatarUrl = avatarUrl;
    if (Object.keys(updates).length === 0) return;
    try { await onSave(updates); } catch (err: any) { setError(err.message || 'Failed to save'); }
  };

  const isHandleValid = handle.length >= 3 && /^[a-zA-Z0-9_]+$/.test(handle);
  const isHandleChanged = handle !== (profile.profile?.handle || '');
  const handleStatus = !isHandleChanged ? null : !isHandleValid ? 'invalid' : isChecking ? 'checking' : isAvailable ? 'available' : 'taken';

  const hasCustom = !!avatarUrl;
  const preview = avatarUrl || getDefaultAvatar(profile.wallet);
  const [showUrlField, setShowUrlField] = useState(false);

  return (
    <form onSubmit={handleSubmit} className="max-w-lg mx-auto space-y-6">
      <div>
        <label className="block text-xs font-mono uppercase tracking-wider text-[#666666] mb-3">Avatar</label>
        <div className="flex items-start gap-5">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="group relative shrink-0 disabled:cursor-wait"
            title="Click to upload"
          >
            <div
              className="w-24 h-24 rounded-full overflow-hidden bg-[#0a0a0a] ring-2 ring-[#1a1a1a] group-hover:ring-[#00ff88]/60 transition-all"
              style={{
                backgroundImage: `url(${preview})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }}
            />
            <div className="absolute inset-0 rounded-full bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <span className="text-[9px] font-mono font-bold uppercase tracking-[0.15em] text-[#00ff88]">
                {uploading ? '…' : 'Change'}
              </span>
            </div>
          </button>
          <div className="flex-1 min-w-0 pt-1">
            <input
              ref={fileRef}
              type="file"
              accept={ALLOWED.join(',')}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
                if (fileRef.current) fileRef.current.value = '';
              }}
              className="hidden"
            />
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
                className="text-xs font-mono font-bold uppercase tracking-[0.1em] px-3.5 py-2 bg-[#00ff88]/10 border border-[#00ff88]/40 hover:bg-[#00ff88]/20 hover:border-[#00ff88] rounded-md text-[#00ff88] disabled:opacity-50 transition-colors"
              >
                {uploading ? 'Uploading…' : 'Upload'}
              </button>
              {hasCustom && (
                <button
                  type="button"
                  onClick={() => setAvatarUrl('')}
                  className="text-[11px] font-mono text-[#666] hover:text-[#ff4444] transition-colors"
                >
                  Remove
                </button>
              )}
            </div>
            <p className="text-[10px] font-mono text-[#555] mt-2 leading-tight">
              PNG · JPG · WebP · GIF<br />up to 2 MB
            </p>
            {!showUrlField ? (
              <button
                type="button"
                onClick={() => setShowUrlField(true)}
                className="text-[10px] font-mono text-[#555] hover:text-[#888] mt-2 transition-colors"
              >
                or paste a URL →
              </button>
            ) : (
              <input
                type="url"
                value={avatarUrl}
                autoFocus
                onChange={(e) => setAvatarUrl(e.target.value.slice(0, 500))}
                placeholder="https://…"
                className="w-full mt-2 bg-[#0a0a0a] border border-[#1a1a1a] rounded px-2 py-1.5 text-[11px] font-mono text-[#e0e0e0] placeholder:text-[#444] focus:border-[#00ff88]/50 focus:outline-none transition-colors"
              />
            )}
          </div>
        </div>
      </div>
      <div>
        <label className="block text-xs font-mono uppercase tracking-wider text-[#666666] mb-1">Username</label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#666666] font-mono">@</span>
          <input type="text" value={handle} onChange={(e) => setHandle(e.target.value.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20))} placeholder="your_handle"
            className="w-full bg-[#111111] border border-[#1a1a1a] rounded-lg pl-7 pr-10 py-2 text-sm font-mono text-[#e0e0e0] placeholder:text-[#666666] focus:border-[#00ff88]/50 focus:outline-none transition-colors" />
          {handleStatus && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm">
              {handleStatus === 'checking' && '⏳'}
              {handleStatus === 'available' && <span className="text-[#00ff88]">✓</span>}
              {handleStatus === 'taken' && <span className="text-[#ff4444]">✗</span>}
              {handleStatus === 'invalid' && <span className="text-[#ff4444]">!</span>}
            </span>
          )}
        </div>
        {handleStatus === 'taken' && <p className="text-[10px] font-mono text-[#ff4444] mt-1">Handle already taken</p>}
        {handleStatus === 'invalid' && handle.length > 0 && <p className="text-[10px] font-mono text-[#ff4444] mt-1">3-20 chars, letters, numbers, underscores</p>}
      </div>
      <div>
        <label className="block text-xs font-mono uppercase tracking-wider text-[#666666] mb-1">Display Name</label>
        <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value.slice(0, 40))} placeholder="Your Name"
          className="w-full bg-[#111111] border border-[#1a1a1a] rounded-lg px-3 py-2 text-sm font-mono text-[#e0e0e0] placeholder:text-[#666666] focus:border-[#00ff88]/50 focus:outline-none transition-colors" />
      </div>
      <div>
        <label className="block text-xs font-mono uppercase tracking-wider text-[#666666] mb-1">Bio</label>
        <textarea value={bio} onChange={(e) => setBio(e.target.value.slice(0, 160))} placeholder="Tell the world about yourself..." rows={3}
          className="w-full bg-[#111111] border border-[#1a1a1a] rounded-lg px-3 py-2 text-sm font-mono text-[#e0e0e0] placeholder:text-[#666666] focus:border-[#00ff88]/50 focus:outline-none transition-colors resize-none" />
        <div className="text-right text-[10px] font-mono text-[#666666] mt-0.5">{bio.length}/160</div>
      </div>
      {error && <div className="text-sm font-mono text-[#ff4444] bg-[#ff4444]/10 border border-[#ff4444]/20 rounded-lg px-3 py-2">{error}</div>}
      <button type="submit" disabled={isSaving || handleStatus === 'taken' || handleStatus === 'checking' || uploading}
        className="w-full bg-[#00ff88] text-black font-mono font-bold py-3 px-6 rounded-lg hover:bg-[#00ff88]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
        {isSaving ? 'Saving...' : 'Save Profile'}
      </button>
    </form>
  );
}
