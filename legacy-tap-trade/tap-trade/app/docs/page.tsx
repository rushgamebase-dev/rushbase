"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Zap,
  BookOpen,
  Gamepad2,
  Target,
  Trophy,
  Flame,
  Award,
  TrendingUp,
  TrendingDown,
  HelpCircle,
  ChevronRight,
  ArrowLeft,
  Play,
  Settings,
  Users,
  Shield,
  Calculator,
  Clock,
  Star,
} from "lucide-react";

// =============================================================================
// DOCUMENTATION PAGE
// =============================================================================

const sections = [
  { id: "getting-started", label: "Getting Started", icon: Play },
  { id: "gameplay", label: "Gameplay Guide", icon: Gamepad2 },
  { id: "predictions", label: "Making Predictions", icon: Target },
  { id: "multipliers", label: "Multipliers & Payouts", icon: Calculator },
  { id: "streaks", label: "Win Streaks", icon: Flame },
  { id: "achievements", label: "Achievements", icon: Award },
  { id: "leaderboards", label: "Leaderboards", icon: Trophy },
  { id: "account", label: "Account & Settings", icon: Settings },
  { id: "fairness", label: "Fairness & Security", icon: Shield },
  { id: "glossary", label: "Glossary", icon: BookOpen },
];

export default function DocsPage() {
  const [activeSection, setActiveSection] = useState("getting-started");

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <header className="border-b border-gray-800 bg-black/90 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <Link href="/" className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                  <Zap className="w-4 h-4 text-white" />
                </div>
                <span className="font-black text-white">TAP TRADE</span>
              </Link>
              <span className="text-gray-500">/</span>
              <span className="text-gray-400">Documentation</span>
            </div>
            <Link
              href="/trade"
              className="px-4 py-2 rounded-lg bg-purple-500 text-white text-sm font-bold hover:bg-purple-600 transition-colors"
            >
              Play Now
            </Link>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex gap-8">
          {/* Sidebar */}
          <aside className="hidden lg:block w-64 flex-shrink-0">
            <nav className="sticky top-24 space-y-1">
              {sections.map((section) => (
                <a
                  key={section.id}
                  href={`#${section.id}`}
                  onClick={() => setActiveSection(section.id)}
                  className={`flex items-center gap-3 px-4 py-2.5 rounded-lg transition-colors ${
                    activeSection === section.id
                      ? "bg-purple-500/20 text-purple-400"
                      : "text-gray-400 hover:text-white hover:bg-gray-800/50"
                  }`}
                >
                  <section.icon className="w-4 h-4" />
                  <span className="text-sm font-medium">{section.label}</span>
                </a>
              ))}
            </nav>
          </aside>

          {/* Content */}
          <main className="flex-1 min-w-0">
            {/* Getting Started */}
            <section id="getting-started" className="mb-16">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 rounded-xl bg-purple-500/20 flex items-center justify-center">
                    <Play className="w-5 h-5 text-purple-400" />
                  </div>
                  <h1 className="text-3xl font-black">Getting Started</h1>
                </div>

                <div className="prose prose-invert max-w-none">
                  <p className="text-lg text-gray-300 mb-6">
                    Welcome to Tap Trade! This guide will help you understand how to play
                    and maximize your winnings.
                  </p>

                  <div className="bg-gray-900/50 border border-gray-800 rounded-2xl p-6 mb-6">
                    <h3 className="text-xl font-bold text-white mb-4">Quick Start</h3>
                    <ol className="space-y-3 text-gray-300">
                      <li className="flex items-start gap-3">
                        <span className="w-6 h-6 rounded-full bg-purple-500/20 flex items-center justify-center flex-shrink-0 text-sm font-bold text-purple-400">1</span>
                        <span>Open the game - no account required to start playing</span>
                      </li>
                      <li className="flex items-start gap-3">
                        <span className="w-6 h-6 rounded-full bg-purple-500/20 flex items-center justify-center flex-shrink-0 text-sm font-bold text-purple-400">2</span>
                        <span>You start with 10,000 virtual credits</span>
                      </li>
                      <li className="flex items-start gap-3">
                        <span className="w-6 h-6 rounded-full bg-purple-500/20 flex items-center justify-center flex-shrink-0 text-sm font-bold text-purple-400">3</span>
                        <span>Watch the price chart moving from left to right</span>
                      </li>
                      <li className="flex items-start gap-3">
                        <span className="w-6 h-6 rounded-full bg-purple-500/20 flex items-center justify-center flex-shrink-0 text-sm font-bold text-purple-400">4</span>
                        <span>Tap on a cell where you predict the price will be</span>
                      </li>
                      <li className="flex items-start gap-3">
                        <span className="w-6 h-6 rounded-full bg-purple-500/20 flex items-center justify-center flex-shrink-0 text-sm font-bold text-purple-400">5</span>
                        <span>Win if the price reaches your cell when the time arrives!</span>
                      </li>
                    </ol>
                  </div>

                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="bg-green-900/20 border border-green-800/50 rounded-xl p-4">
                      <h4 className="font-bold text-green-400 mb-2">What You Can Win</h4>
                      <p className="text-sm text-gray-300">
                        Multipliers range from 1.1x to 10x+ depending on how bold your prediction is.
                      </p>
                    </div>
                    <div className="bg-yellow-900/20 border border-yellow-800/50 rounded-xl p-4">
                      <h4 className="font-bold text-yellow-400 mb-2">Risk Free</h4>
                      <p className="text-sm text-gray-300">
                        You&apos;re playing with virtual credits. No real money is involved.
                      </p>
                    </div>
                  </div>
                </div>
              </motion.div>
            </section>

            {/* Gameplay Guide */}
            <section id="gameplay" className="mb-16">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-cyan-500/20 flex items-center justify-center">
                  <Gamepad2 className="w-5 h-5 text-cyan-400" />
                </div>
                <h2 className="text-3xl font-black">Gameplay Guide</h2>
              </div>

              <div className="space-y-6">
                <div className="bg-gray-900/50 border border-gray-800 rounded-2xl p-6">
                  <h3 className="text-xl font-bold text-white mb-4">Understanding the Grid</h3>
                  <p className="text-gray-300 mb-4">
                    The game displays a grid where the X-axis represents time (future columns to the right)
                    and the Y-axis represents price levels (higher rows = higher prices).
                  </p>
                  <ul className="space-y-2 text-gray-300">
                    <li className="flex items-center gap-2">
                      <div className="w-4 h-4 rounded bg-pink-500"></div>
                      <span>Pink Line - The current price moving through time</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <div className="w-4 h-4 rounded bg-yellow-400"></div>
                      <span>Yellow Cells - Your active predictions</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <div className="w-4 h-4 rounded bg-green-500"></div>
                      <span>Green Cells - Winning predictions</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <div className="w-4 h-4 rounded bg-red-500"></div>
                      <span>Red Cells - Lost predictions</span>
                    </li>
                  </ul>
                </div>

                <div className="bg-gray-900/50 border border-gray-800 rounded-2xl p-6">
                  <h3 className="text-xl font-bold text-white mb-4">The Future Zone</h3>
                  <p className="text-gray-300">
                    You can only place predictions in columns to the right of the current price line.
                    This is called the &quot;future zone&quot;. The further right you tap, the more time
                    until your prediction is resolved - and potentially higher multipliers.
                  </p>
                </div>
              </div>
            </section>

            {/* Making Predictions */}
            <section id="predictions" className="mb-16">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-pink-500/20 flex items-center justify-center">
                  <Target className="w-5 h-5 text-pink-400" />
                </div>
                <h2 className="text-3xl font-black">Making Predictions</h2>
              </div>

              <div className="space-y-6">
                <div className="bg-gray-900/50 border border-gray-800 rounded-2xl p-6">
                  <h3 className="text-xl font-bold text-white mb-4">How to Place a Prediction</h3>
                  <ol className="space-y-4 text-gray-300">
                    <li>
                      <strong className="text-white">1. Set Your Stake</strong>
                      <p className="text-sm mt-1">Use the stake selector at the bottom to choose how much to risk (default $5).</p>
                    </li>
                    <li>
                      <strong className="text-white">2. Analyze the Chart</strong>
                      <p className="text-sm mt-1">Watch the price movement and try to predict where it&apos;s heading.</p>
                    </li>
                    <li>
                      <strong className="text-white">3. Tap to Predict</strong>
                      <p className="text-sm mt-1">Tap on any cell in the future zone. Higher rows = UP prediction, lower rows = DOWN.</p>
                    </li>
                    <li>
                      <strong className="text-white">4. Wait for Resolution</strong>
                      <p className="text-sm mt-1">When the timeline reaches your column, you win if the price is at your row!</p>
                    </li>
                  </ol>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <TrendingUp className="w-5 h-5 text-green-400" />
                      <h4 className="font-bold text-white">Bullish (UP) Prediction</h4>
                    </div>
                    <p className="text-sm text-gray-300">
                      Tap on rows ABOVE the current price. You&apos;re betting the price will rise.
                    </p>
                  </div>
                  <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <TrendingDown className="w-5 h-5 text-red-400" />
                      <h4 className="font-bold text-white">Bearish (DOWN) Prediction</h4>
                    </div>
                    <p className="text-sm text-gray-300">
                      Tap on rows BELOW the current price. You&apos;re betting the price will fall.
                    </p>
                  </div>
                </div>
              </div>
            </section>

            {/* Multipliers */}
            <section id="multipliers" className="mb-16">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-yellow-500/20 flex items-center justify-center">
                  <Calculator className="w-5 h-5 text-yellow-400" />
                </div>
                <h2 className="text-3xl font-black">Multipliers & Payouts</h2>
              </div>

              <div className="space-y-6">
                <div className="bg-gray-900/50 border border-gray-800 rounded-2xl p-6">
                  <h3 className="text-xl font-bold text-white mb-4">How Multipliers Work</h3>
                  <p className="text-gray-300 mb-4">
                    Your potential payout depends on how &quot;risky&quot; your prediction is.
                    Two factors determine the multiplier:
                  </p>
                  <div className="space-y-4">
                    <div className="flex items-start gap-4">
                      <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center flex-shrink-0">
                        <TrendingUp className="w-4 h-4 text-purple-400" />
                      </div>
                      <div>
                        <h4 className="font-bold text-white">Price Distance</h4>
                        <p className="text-sm text-gray-400">
                          How far your prediction is from the current price. Predicting a bigger move = higher multiplier.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-4">
                      <div className="w-8 h-8 rounded-lg bg-cyan-500/20 flex items-center justify-center flex-shrink-0">
                        <Clock className="w-4 h-4 text-cyan-400" />
                      </div>
                      <div>
                        <h4 className="font-bold text-white">Time Distance</h4>
                        <p className="text-sm text-gray-400">
                          How many columns ahead you&apos;re predicting. Further future = slightly higher multiplier.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-gray-900/50 border border-gray-800 rounded-2xl p-6">
                  <h3 className="text-xl font-bold text-white mb-4">Multiplier Examples</h3>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between py-2 border-b border-gray-800">
                      <span className="text-gray-300">Same row (current price)</span>
                      <span className="text-yellow-400 font-bold">~1.1x</span>
                    </div>
                    <div className="flex items-center justify-between py-2 border-b border-gray-800">
                      <span className="text-gray-300">1-2 rows away</span>
                      <span className="text-yellow-400 font-bold">1.5x - 2x</span>
                    </div>
                    <div className="flex items-center justify-between py-2 border-b border-gray-800">
                      <span className="text-gray-300">3-4 rows away</span>
                      <span className="text-orange-400 font-bold">3x - 5x</span>
                    </div>
                    <div className="flex items-center justify-between py-2">
                      <span className="text-gray-300">5+ rows away</span>
                      <span className="text-red-400 font-bold">6x - 10x+</span>
                    </div>
                  </div>
                </div>

                <div className="bg-purple-900/20 border border-purple-800/50 rounded-xl p-4">
                  <h4 className="font-bold text-purple-400 mb-2">Payout Formula</h4>
                  <p className="text-sm text-gray-300">
                    <code className="bg-black/50 px-2 py-1 rounded">Payout = Stake × Multiplier</code>
                    <br /><br />
                    Example: $10 stake × 3.5x multiplier = $35 payout ($25 profit)
                  </p>
                </div>
              </div>
            </section>

            {/* Win Streaks */}
            <section id="streaks" className="mb-16">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-orange-500/20 flex items-center justify-center">
                  <Flame className="w-5 h-5 text-orange-400" />
                </div>
                <h2 className="text-3xl font-black">Win Streaks</h2>
              </div>

              <div className="space-y-6">
                <div className="bg-gray-900/50 border border-gray-800 rounded-2xl p-6">
                  <h3 className="text-xl font-bold text-white mb-4">Streak Bonuses</h3>
                  <p className="text-gray-300 mb-4">
                    Win consecutive predictions to build a streak and earn bonus multipliers on your payouts!
                  </p>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between py-2 border-b border-gray-800">
                      <div className="flex items-center gap-2">
                        <span className="text-white">2 Wins</span>
                      </div>
                      <span className="text-green-400 font-bold">1.1x bonus</span>
                    </div>
                    <div className="flex items-center justify-between py-2 border-b border-gray-800">
                      <div className="flex items-center gap-2">
                        <span className="text-white">3 Wins</span>
                        <Flame className="w-4 h-4 text-orange-400" />
                        <span className="text-xs text-orange-400">ON FIRE</span>
                      </div>
                      <span className="text-green-400 font-bold">1.2x bonus</span>
                    </div>
                    <div className="flex items-center justify-between py-2 border-b border-gray-800">
                      <div className="flex items-center gap-2">
                        <span className="text-white">5 Wins</span>
                        <Flame className="w-4 h-4 text-red-400" />
                        <span className="text-xs text-red-400">UNSTOPPABLE</span>
                      </div>
                      <span className="text-green-400 font-bold">1.5x bonus</span>
                    </div>
                    <div className="flex items-center justify-between py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-white">10+ Wins</span>
                        <Flame className="w-4 h-4 text-purple-400" />
                        <span className="text-xs text-purple-400">LEGENDARY</span>
                      </div>
                      <span className="text-green-400 font-bold">2.0x bonus (MAX)</span>
                    </div>
                  </div>
                </div>

                <div className="bg-red-900/20 border border-red-800/50 rounded-xl p-4">
                  <h4 className="font-bold text-red-400 mb-2">Warning</h4>
                  <p className="text-sm text-gray-300">
                    Your streak resets to 0 when you lose a prediction. The bonus multiplier is applied
                    on top of your base multiplier.
                  </p>
                </div>
              </div>
            </section>

            {/* Achievements */}
            <section id="achievements" className="mb-16">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                  <Award className="w-5 h-5 text-emerald-400" />
                </div>
                <h2 className="text-3xl font-black">Achievements</h2>
              </div>

              <div className="space-y-6">
                <p className="text-gray-300">
                  Unlock achievements by completing challenges and hitting milestones.
                  Each achievement awards XP that contributes to your level.
                </p>

                <div className="grid md:grid-cols-2 gap-4">
                  <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-3 h-3 rounded-full bg-gray-400"></div>
                      <span className="font-bold text-gray-400">Common</span>
                      <span className="text-xs text-gray-500">10-30 XP</span>
                    </div>
                    <ul className="text-sm text-gray-400 space-y-1">
                      <li>First Blood - Win your first trade</li>
                      <li>On Fire - 3 win streak</li>
                      <li>Getting Started - 10 total wins</li>
                    </ul>
                  </div>
                  <div className="bg-gray-900/50 border border-blue-800/30 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-3 h-3 rounded-full bg-blue-400"></div>
                      <span className="font-bold text-blue-400">Rare</span>
                      <span className="text-xs text-gray-500">50-100 XP</span>
                    </div>
                    <ul className="text-sm text-gray-400 space-y-1">
                      <li>Unstoppable - 5 win streak</li>
                      <li>Consistent Winner - 50 total wins</li>
                      <li>Big Baller - Win $100+ on one trade</li>
                    </ul>
                  </div>
                  <div className="bg-gray-900/50 border border-purple-800/30 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-3 h-3 rounded-full bg-purple-400"></div>
                      <span className="font-bold text-purple-400">Epic</span>
                      <span className="text-xs text-gray-500">150-300 XP</span>
                    </div>
                    <ul className="text-sm text-gray-400 space-y-1">
                      <li>Legendary Streak - 10 win streak</li>
                      <li>Century Club - 100 total wins</li>
                      <li>Whale Alert - Win $500+ on one trade</li>
                    </ul>
                  </div>
                  <div className="bg-gray-900/50 border border-yellow-800/30 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
                      <span className="font-bold text-yellow-400">Legendary</span>
                      <span className="text-xs text-gray-500">500+ XP</span>
                    </div>
                    <ul className="text-sm text-gray-400 space-y-1">
                      <li>Sniper - Win on 10x+ multiplier</li>
                      <li>And many more...</li>
                    </ul>
                  </div>
                </div>
              </div>
            </section>

            {/* Leaderboards */}
            <section id="leaderboards" className="mb-16">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center">
                  <Trophy className="w-5 h-5 text-amber-400" />
                </div>
                <h2 className="text-3xl font-black">Leaderboards</h2>
              </div>

              <div className="space-y-6">
                <p className="text-gray-300">
                  Compete with players worldwide and climb the rankings!
                </p>

                <div className="bg-gray-900/50 border border-gray-800 rounded-2xl p-6">
                  <h3 className="text-xl font-bold text-white mb-4">Leaderboard Types</h3>
                  <div className="space-y-4">
                    <div className="flex items-start gap-4">
                      <div className="w-8 h-8 rounded-lg bg-green-500/20 flex items-center justify-center flex-shrink-0">
                        <Clock className="w-4 h-4 text-green-400" />
                      </div>
                      <div>
                        <h4 className="font-bold text-white">Daily</h4>
                        <p className="text-sm text-gray-400">Resets every 24 hours at midnight UTC</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-4">
                      <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                        <Star className="w-4 h-4 text-blue-400" />
                      </div>
                      <div>
                        <h4 className="font-bold text-white">Weekly</h4>
                        <p className="text-sm text-gray-400">Resets every Monday at midnight UTC</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-4">
                      <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center flex-shrink-0">
                        <Trophy className="w-4 h-4 text-purple-400" />
                      </div>
                      <div>
                        <h4 className="font-bold text-white">All-Time</h4>
                        <p className="text-sm text-gray-400">Cumulative rankings since launch</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Account */}
            <section id="account" className="mb-16">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-slate-500/20 flex items-center justify-center">
                  <Settings className="w-5 h-5 text-slate-400" />
                </div>
                <h2 className="text-3xl font-black">Account & Settings</h2>
              </div>

              <div className="space-y-6">
                <div className="bg-gray-900/50 border border-gray-800 rounded-2xl p-6">
                  <h3 className="text-xl font-bold text-white mb-4">Account Features</h3>
                  <ul className="space-y-3 text-gray-300">
                    <li className="flex items-center gap-2">
                      <ChevronRight className="w-4 h-4 text-purple-400" />
                      Save your progress and stats across devices
                    </li>
                    <li className="flex items-center gap-2">
                      <ChevronRight className="w-4 h-4 text-purple-400" />
                      Appear on public leaderboards
                    </li>
                    <li className="flex items-center gap-2">
                      <ChevronRight className="w-4 h-4 text-purple-400" />
                      Unlock exclusive achievements
                    </li>
                    <li className="flex items-center gap-2">
                      <ChevronRight className="w-4 h-4 text-purple-400" />
                      Customize your profile and display name
                    </li>
                  </ul>
                </div>

                <div className="bg-gray-900/50 border border-gray-800 rounded-2xl p-6">
                  <h3 className="text-xl font-bold text-white mb-4">Settings</h3>
                  <ul className="space-y-3 text-gray-300">
                    <li className="flex items-center gap-2">
                      <ChevronRight className="w-4 h-4 text-purple-400" />
                      Sound effects - Toggle on/off
                    </li>
                    <li className="flex items-center gap-2">
                      <ChevronRight className="w-4 h-4 text-purple-400" />
                      Haptic feedback - Enable vibration on mobile
                    </li>
                    <li className="flex items-center gap-2">
                      <ChevronRight className="w-4 h-4 text-purple-400" />
                      Default stake amount
                    </li>
                  </ul>
                </div>
              </div>
            </section>

            {/* Fairness */}
            <section id="fairness" className="mb-16">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-green-500/20 flex items-center justify-center">
                  <Shield className="w-5 h-5 text-green-400" />
                </div>
                <h2 className="text-3xl font-black">Fairness & Security</h2>
              </div>

              <div className="space-y-6">
                <div className="bg-gray-900/50 border border-gray-800 rounded-2xl p-6">
                  <h3 className="text-xl font-bold text-white mb-4">Our Commitment</h3>
                  <ul className="space-y-4 text-gray-300">
                    <li>
                      <strong className="text-white">Real Price Data</strong>
                      <p className="text-sm text-gray-400 mt-1">
                        Price data is sourced from Binance in real-time. We don&apos;t manipulate prices.
                      </p>
                    </li>
                    <li>
                      <strong className="text-white">Transparent Multipliers</strong>
                      <p className="text-sm text-gray-400 mt-1">
                        Multipliers are calculated using a fixed formula visible before you place any prediction.
                      </p>
                    </li>
                    <li>
                      <strong className="text-white">No Hidden Fees</strong>
                      <p className="text-sm text-gray-400 mt-1">
                        What you see is what you get. No spreads, no commissions, no hidden charges.
                      </p>
                    </li>
                    <li>
                      <strong className="text-white">Virtual Credits Only</strong>
                      <p className="text-sm text-gray-400 mt-1">
                        This is a game for entertainment. No real money is at risk.
                      </p>
                    </li>
                  </ul>
                </div>
              </div>
            </section>

            {/* Glossary */}
            <section id="glossary" className="mb-16">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center">
                  <BookOpen className="w-5 h-5 text-indigo-400" />
                </div>
                <h2 className="text-3xl font-black">Glossary</h2>
              </div>

              <div className="space-y-4">
                {[
                  { term: "Stake", def: "The amount you risk on a prediction" },
                  { term: "Multiplier", def: "The factor that determines your potential payout" },
                  { term: "Payout", def: "The total amount you receive if you win (stake × multiplier)" },
                  { term: "Streak", def: "Consecutive winning predictions" },
                  { term: "Future Zone", def: "Columns to the right where you can place predictions" },
                  { term: "Resolution", def: "When the timeline reaches your column and your prediction is judged" },
                  { term: "XP", def: "Experience points earned from playing and achievements" },
                  { term: "Level", def: "Your rank based on total XP earned" },
                  { term: "PnL", def: "Profit and Loss - your net earnings" },
                ].map((item, i) => (
                  <div key={i} className="bg-gray-900/50 border border-gray-800 rounded-xl p-4">
                    <dt className="font-bold text-white">{item.term}</dt>
                    <dd className="text-sm text-gray-400 mt-1">{item.def}</dd>
                  </div>
                ))}
              </div>
            </section>

            {/* Need Help */}
            <section className="bg-purple-900/20 border border-purple-800/50 rounded-2xl p-8 text-center">
              <HelpCircle className="w-12 h-12 text-purple-400 mx-auto mb-4" />
              <h3 className="text-2xl font-bold text-white mb-2">Still Have Questions?</h3>
              <p className="text-gray-400 mb-6">
                Can&apos;t find what you&apos;re looking for? We&apos;re here to help.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Link
                  href="/#faq"
                  className="px-6 py-3 rounded-xl bg-purple-500 text-white font-bold hover:bg-purple-600 transition-colors"
                >
                  View FAQ
                </Link>
                <a
                  href="mailto:support@taptrade.app"
                  className="px-6 py-3 rounded-xl border border-purple-500/50 text-white font-medium hover:bg-purple-500/10 transition-colors"
                >
                  Contact Support
                </a>
              </div>
            </section>
          </main>
        </div>
      </div>
    </div>
  );
}
