'use client';

import { useMyProfile } from '../hooks/useMyProfile';
import { ProfileEditor } from '../components/profile/ProfileEditor';
import { useAuth } from '../hooks/useAuth';

export function SettingsPage() {
  const { isAuthenticated } = useAuth();
  const { profile, isLoading, updateProfile } = useMyProfile();

  if (!isAuthenticated) {
    return (
      <div className="max-w-lg mx-auto p-6 text-center">
        <div className="text-lg font-mono text-[#666666] py-12">
          Sign in to edit your profile
        </div>
      </div>
    );
  }

  if (isLoading || !profile) {
    return (
      <div className="max-w-lg mx-auto p-6 space-y-4">
        <div className="h-24 bg-[#111111] border border-[#1a1a1a] rounded-full w-24 mx-auto animate-pulse" />
        <div className="h-10 bg-[#111111] border border-[#1a1a1a] rounded-lg animate-pulse" />
        <div className="h-10 bg-[#111111] border border-[#1a1a1a] rounded-lg animate-pulse" />
        <div className="h-20 bg-[#111111] border border-[#1a1a1a] rounded-lg animate-pulse" />
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto p-6">
      <h1 className="text-xl font-mono font-bold text-[#e0e0e0] mb-6">
        Edit Profile
      </h1>

      <ProfileEditor
        profile={profile}
        onSave={async (updates) => {
          await updateProfile.mutateAsync(updates);
        }}
        isSaving={updateProfile.isPending}
      />
    </div>
  );
}
