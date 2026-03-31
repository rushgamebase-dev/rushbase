'use client';

import { useState, useEffect } from 'react';
import type { UserProfileFull, ProfileUpdatePayload, Address } from '../../types/profile';
import { AvatarUpload } from './AvatarUpload';
import { useHandleAvailability } from '../../hooks/useHandleAvailability';

interface ProfileEditorProps {
  profile: UserProfileFull;
  onSave: (updates: ProfileUpdatePayload) => Promise<void>;
  isSaving: boolean;
}

export function ProfileEditor({ profile, onSave, isSaving }: ProfileEditorProps) {
  const [handle, setHandle] = useState(profile.profile?.handle || '');
  const [displayName, setDisplayName] = useState(profile.profile?.displayName || '');
  const [bio, setBio] = useState(profile.profile?.bio || '');
  const [avatarUrl, setAvatarUrl] = useState(profile.profile?.avatarUrl || '');
  const [error, setError] = useState<string | null>(null);

  const { isAvailable, isChecking } = useHandleAvailability(
    handle !== (profile.profile?.handle || '') ? handle : '',
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const updates: ProfileUpdatePayload = {};
    if (handle !== (profile.profile?.handle || '')) updates.handle = handle;
    if (displayName !== (profile.profile?.displayName || '')) updates.displayName = displayName;
    if (bio !== (profile.profile?.bio || '')) updates.bio = bio;
    if (avatarUrl !== (profile.profile?.avatarUrl || '')) updates.avatarUrl = avatarUrl;

    if (Object.keys(updates).length === 0) return;

    try {
      await onSave(updates);
    } catch (err: any) {
      setError(err.message || 'Failed to save');
    }
  };

  const isHandleValid = handle.length >= 3 && /^[a-zA-Z0-9_]+$/.test(handle);
  const isHandleChanged = handle !== (profile.profile?.handle || '');
  const handleStatus = !isHandleChanged
    ? null
    : !isHandleValid
      ? 'invalid'
      : isChecking
        ? 'checking'
        : isAvailable
          ? 'available'
          : 'taken';

  return (
    <form onSubmit={handleSubmit} className="max-w-lg mx-auto space-y-6">
      {/* Avatar */}
      <AvatarUpload
        currentAvatarUrl={profile.profile?.avatarUrl || null}
        walletAddress={profile.wallet as Address}
        onUpload={(url) => setAvatarUrl(url)}
      />

      {/* Handle */}
      <div>
        <label className="block text-xs font-mono uppercase tracking-wider text-[#666666] mb-1">
          Username
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#666666] font-mono">@</span>
          <input
            type="text"
            value={handle}
            onChange={(e) => setHandle(e.target.value.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20))}
            placeholder="your_handle"
            className="w-full bg-[#111111] border border-[#1a1a1a] rounded-lg pl-7 pr-10 py-2 text-sm font-mono text-[#e0e0e0] placeholder:text-[#666666] focus:border-[#00ff88]/50 focus:outline-none transition-colors"
          />
          {handleStatus && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm">
              {handleStatus === 'checking' && '⏳'}
              {handleStatus === 'available' && <span className="text-[#00ff88]">✓</span>}
              {handleStatus === 'taken' && <span className="text-[#ff4444]">✗</span>}
              {handleStatus === 'invalid' && <span className="text-[#ff4444]">!</span>}
            </span>
          )}
        </div>
        {handleStatus === 'taken' && (
          <p className="text-[10px] font-mono text-[#ff4444] mt-1">Handle already taken</p>
        )}
        {handleStatus === 'invalid' && handle.length > 0 && (
          <p className="text-[10px] font-mono text-[#ff4444] mt-1">3-20 chars, letters, numbers, underscores</p>
        )}
      </div>

      {/* Display Name */}
      <div>
        <label className="block text-xs font-mono uppercase tracking-wider text-[#666666] mb-1">
          Display Name
        </label>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value.slice(0, 40))}
          placeholder="Your Name"
          className="w-full bg-[#111111] border border-[#1a1a1a] rounded-lg px-3 py-2 text-sm font-mono text-[#e0e0e0] placeholder:text-[#666666] focus:border-[#00ff88]/50 focus:outline-none transition-colors"
        />
      </div>

      {/* Bio */}
      <div>
        <label className="block text-xs font-mono uppercase tracking-wider text-[#666666] mb-1">
          Bio
        </label>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value.slice(0, 160))}
          placeholder="Tell the world about yourself..."
          rows={3}
          className="w-full bg-[#111111] border border-[#1a1a1a] rounded-lg px-3 py-2 text-sm font-mono text-[#e0e0e0] placeholder:text-[#666666] focus:border-[#00ff88]/50 focus:outline-none transition-colors resize-none"
        />
        <div className="text-right text-[10px] font-mono text-[#666666] mt-0.5">
          {bio.length}/160
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="text-sm font-mono text-[#ff4444] bg-[#ff4444]/10 border border-[#ff4444]/20 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {/* Save */}
      <button
        type="submit"
        disabled={isSaving || handleStatus === 'taken' || handleStatus === 'checking'}
        className="w-full bg-[#00ff88] text-black font-mono font-bold py-3 px-6 rounded-lg hover:bg-[#00ff88]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isSaving ? 'Saving...' : 'Save Profile'}
      </button>
    </form>
  );
}
