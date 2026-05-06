"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { User, Bell, Vibrate, Volume2, Moon, LogOut, Shield } from "lucide-react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { useAuth } from "@/stores";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface SettingToggleProps {
  label: string;
  description: string;
  icon: React.ReactNode;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}

function SettingToggle({ label, description, icon, enabled, onChange }: SettingToggleProps) {
  return (
    <div className="flex items-center justify-between py-4 border-b border-border last:border-0">
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 rounded-lg bg-background-secondary flex items-center justify-center text-text-secondary">
          {icon}
        </div>
        <div>
          <p className="font-medium text-text-primary">{label}</p>
          <p className="text-sm text-text-muted">{description}</p>
        </div>
      </div>
      <button
        onClick={() => onChange(!enabled)}
        className={`relative w-12 h-6 rounded-full transition-colors ${
          enabled ? "bg-primary-500" : "bg-background-elevated"
        }`}
      >
        <motion.div
          animate={{ x: enabled ? 24 : 2 }}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
          className="absolute top-1 w-4 h-4 bg-white rounded-full"
        />
      </button>
    </div>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const { user, logout } = useAuth();

  const [settings, setSettings] = useState({
    notifications: true,
    haptics: true,
    sounds: true,
    darkMode: true,
  });

  const updateSetting = (key: keyof typeof settings, value: boolean) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    toast.success("Setting updated");
  };

  const handleLogout = async () => {
    await logout();
    toast.success("Logged out successfully");
    router.push("/login");
  };

  return (
    <div className="container mx-auto px-4 py-6 max-w-2xl">
      <h1 className="text-2xl font-bold text-text-primary mb-6">Settings</h1>

      {/* Profile Section */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0 }}
      >
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="w-5 h-5" />
              Profile
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary-400 to-accent-purple flex items-center justify-center text-2xl font-bold text-white">
                {user?.username?.charAt(0).toUpperCase() || "U"}
              </div>
              <div>
                <p className="font-semibold text-lg text-text-primary">{user?.username || "User"}</p>
                <p className="text-text-secondary">{user?.email || "user@example.com"}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Preferences */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Preferences</CardTitle>
          </CardHeader>
          <CardContent>
            <SettingToggle
              label="Push Notifications"
              description="Get alerts for price movements and trades"
              icon={<Bell className="w-5 h-5" />}
              enabled={settings.notifications}
              onChange={(v) => updateSetting("notifications", v)}
            />
            <SettingToggle
              label="Haptic Feedback"
              description="Vibrate on button taps and events"
              icon={<Vibrate className="w-5 h-5" />}
              enabled={settings.haptics}
              onChange={(v) => updateSetting("haptics", v)}
            />
            <SettingToggle
              label="Sound Effects"
              description="Play sounds for wins and losses"
              icon={<Volume2 className="w-5 h-5" />}
              enabled={settings.sounds}
              onChange={(v) => updateSetting("sounds", v)}
            />
            <SettingToggle
              label="Dark Mode"
              description="Use dark theme"
              icon={<Moon className="w-5 h-5" />}
              enabled={settings.darkMode}
              onChange={(v) => updateSetting("darkMode", v)}
            />
          </CardContent>
        </Card>
      </motion.div>

      {/* Security */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5" />
              Security
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Button variant="outline" className="w-full mb-3">
              Change Password
            </Button>
            <Button variant="outline" className="w-full">
              Enable 2FA
            </Button>
          </CardContent>
        </Card>
      </motion.div>

      {/* Logout */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
      >
        <Button
          variant="danger"
          size="lg"
          className="w-full"
          onClick={handleLogout}
        >
          <LogOut className="w-5 h-5 mr-2" />
          Log Out
        </Button>
      </motion.div>

      {/* Version */}
      <p className="text-center text-text-muted text-sm mt-8">
        TapTrading v1.0.0 • Demo Mode
      </p>
    </div>
  );
}
