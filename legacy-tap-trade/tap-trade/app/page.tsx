"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  Zap,
  TrendingUp,
  Trophy,
  Shield,
  Smartphone,
  Gamepad2,
  ChevronDown,
  ChevronRight,
  Star,
  Play,
  ArrowRight,
  Check,
  Flame,
  Target,
  Clock,
  Users,
  Award,
  HelpCircle,
  BookOpen,
  MessageCircle,
  Twitter,
  Github,
  Menu,
  X,
} from "lucide-react";

// =============================================================================
// NAVBAR
// =============================================================================
function Navbar() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 50);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const navLinks = [
    { href: "#features", label: "Features" },
    { href: "#how-it-works", label: "How It Works" },
    { href: "#testimonials", label: "Reviews" },
    { href: "#faq", label: "FAQ" },
    { href: "/docs", label: "Docs" },
  ];

  return (
    <motion.nav
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        isScrolled
          ? "bg-black/90 backdrop-blur-xl border-b border-purple-900/50"
          : "bg-transparent"
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 sm:h-20">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
              <Zap className="w-6 h-6 text-white" />
            </div>
            <span className="text-xl font-black bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
              TAP TRADE
            </span>
          </Link>

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center gap-8">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-gray-300 hover:text-white transition-colors text-sm font-medium"
              >
                {link.label}
              </a>
            ))}
          </div>

          {/* CTA Buttons */}
          <div className="hidden md:flex items-center gap-4">
            <Link
              href="/login"
              className="text-gray-300 hover:text-white transition-colors text-sm font-medium"
            >
              Sign In
            </Link>
            <Link
              href="/trade"
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 text-white font-bold text-sm hover:opacity-90 transition-opacity"
            >
              Play Now
            </Link>
          </div>

          {/* Mobile Menu Button */}
          <button
            className="md:hidden p-2"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? (
              <X className="w-6 h-6 text-white" />
            ) : (
              <Menu className="w-6 h-6 text-white" />
            )}
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="md:hidden bg-black/95 backdrop-blur-xl border-b border-purple-900/50"
          >
            <div className="px-4 py-4 space-y-3">
              {navLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="block text-gray-300 hover:text-white py-2"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {link.label}
                </a>
              ))}
              <div className="pt-4 border-t border-purple-900/50 space-y-3">
                <Link
                  href="/login"
                  className="block text-center py-3 rounded-xl border border-purple-500/50 text-white font-medium"
                >
                  Sign In
                </Link>
                <Link
                  href="/trade"
                  className="block text-center py-3 rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 text-white font-bold"
                >
                  Play Now
                </Link>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.nav>
  );
}

// =============================================================================
// HERO SECTION
// =============================================================================
function HeroSection() {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-20">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-b from-purple-950/50 via-black to-black" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-purple-900/30 via-transparent to-transparent" />

      {/* Animated Grid */}
      <div className="absolute inset-0 opacity-20">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `linear-gradient(rgba(168, 85, 247, 0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(168, 85, 247, 0.3) 1px, transparent 1px)`,
            backgroundSize: "50px 50px",
          }}
        />
      </div>

      {/* Floating Elements */}
      <div className="absolute inset-0 overflow-hidden">
        {[...Array(20)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-2 h-2 rounded-full bg-purple-500/30"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
            }}
            animate={{
              y: [0, -30, 0],
              opacity: [0.3, 0.8, 0.3],
            }}
            transition={{
              duration: 3 + Math.random() * 2,
              repeat: Infinity,
              delay: Math.random() * 2,
            }}
          />
        ))}
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        {/* Badge */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-purple-500/10 border border-purple-500/30 mb-8"
        >
          <Flame className="w-4 h-4 text-orange-400" />
          <span className="text-sm text-purple-300">The #1 Prediction Trading Game</span>
        </motion.div>

        {/* Main Headline */}
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="text-4xl sm:text-6xl lg:text-7xl font-black mb-6"
        >
          <span className="text-white">Predict. Tap.</span>
          <br />
          <span className="bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent">
            Win Big.
          </span>
        </motion.h1>

        {/* Subheadline */}
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="text-lg sm:text-xl text-gray-400 max-w-2xl mx-auto mb-10"
        >
          The most addictive price prediction game. Tap where you think the market will go,
          build win streaks, and climb the leaderboard. No experience needed.
        </motion.p>

        {/* CTA Buttons */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12"
        >
          <Link
            href="/trade"
            className="group flex items-center gap-2 px-8 py-4 rounded-2xl bg-gradient-to-r from-purple-500 to-pink-500 text-white font-bold text-lg hover:opacity-90 transition-all hover:scale-105"
          >
            <Play className="w-5 h-5" />
            Start Playing Free
            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
          </Link>
          <a
            href="#how-it-works"
            className="flex items-center gap-2 px-8 py-4 rounded-2xl border border-purple-500/50 text-white font-medium hover:bg-purple-500/10 transition-all"
          >
            <Gamepad2 className="w-5 h-5" />
            See How It Works
          </a>
        </motion.div>

        {/* Stats */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="flex flex-wrap items-center justify-center gap-8 sm:gap-12"
        >
          {[
            { value: "50K+", label: "Active Players" },
            { value: "$2M+", label: "Won This Week" },
            { value: "4.9", label: "App Rating", icon: Star },
          ].map((stat, i) => (
            <div key={i} className="text-center">
              <div className="flex items-center justify-center gap-1 text-2xl sm:text-3xl font-black text-white">
                {stat.icon && <stat.icon className="w-5 h-5 text-yellow-400 fill-yellow-400" />}
                {stat.value}
              </div>
              <div className="text-sm text-gray-500">{stat.label}</div>
            </div>
          ))}
        </motion.div>

        {/* Game Preview */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.8 }}
          className="mt-16 relative"
        >
          <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent z-10 pointer-events-none" />
          <div className="relative rounded-3xl overflow-hidden border border-purple-500/30 shadow-2xl shadow-purple-500/20 max-w-4xl mx-auto">
            <div className="aspect-video bg-gradient-to-br from-gray-900 to-black flex items-center justify-center">
              <div className="text-center">
                <div className="w-20 h-20 rounded-full bg-purple-500/20 flex items-center justify-center mx-auto mb-4 cursor-pointer hover:bg-purple-500/30 transition-colors">
                  <Play className="w-8 h-8 text-purple-400 ml-1" />
                </div>
                <p className="text-gray-400">Watch Gameplay Demo</p>
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Scroll Indicator */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.5 }}
        className="absolute bottom-8 left-1/2 -translate-x-1/2"
      >
        <motion.div
          animate={{ y: [0, 10, 0] }}
          transition={{ duration: 2, repeat: Infinity }}
          className="flex flex-col items-center gap-2"
        >
          <span className="text-xs text-gray-500">Scroll to explore</span>
          <ChevronDown className="w-5 h-5 text-gray-500" />
        </motion.div>
      </motion.div>
    </section>
  );
}

// =============================================================================
// FEATURES SECTION
// =============================================================================
function FeaturesSection() {
  const features = [
    {
      icon: Zap,
      title: "Instant Gameplay",
      description: "No downloads, no sign-ups required. Jump straight into the action and start predicting in seconds.",
      color: "from-yellow-500 to-orange-500",
    },
    {
      icon: Target,
      title: "Simple Mechanics",
      description: "Tap on the grid where you think the price will go. Higher risk = higher rewards. That's it.",
      color: "from-purple-500 to-pink-500",
    },
    {
      icon: Flame,
      title: "Win Streaks",
      description: "Build consecutive wins to unlock multiplier bonuses. Get on fire with 3+ streaks!",
      color: "from-orange-500 to-red-500",
    },
    {
      icon: Trophy,
      title: "Leaderboards",
      description: "Compete globally. Daily, weekly, and all-time rankings with real prizes for top players.",
      color: "from-cyan-500 to-blue-500",
    },
    {
      icon: Award,
      title: "Achievements",
      description: "Unlock 50+ achievements from Common to Legendary. Collect them all and show off your skills.",
      color: "from-green-500 to-emerald-500",
    },
    {
      icon: Smartphone,
      title: "Mobile First",
      description: "Designed for your phone. Haptic feedback, smooth animations, works offline.",
      color: "from-pink-500 to-rose-500",
    },
  ];

  return (
    <section id="features" className="py-24 sm:py-32 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-16">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-purple-500/10 border border-purple-500/30 mb-6"
          >
            <Gamepad2 className="w-4 h-4 text-purple-400" />
            <span className="text-sm text-purple-300">Powerful Features</span>
          </motion.div>
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="text-3xl sm:text-5xl font-black text-white mb-4"
          >
            Everything You Need to Win
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
            className="text-gray-400 max-w-2xl mx-auto"
          >
            Built from the ground up for the ultimate prediction gaming experience.
            Fast, fair, and incredibly fun.
          </motion.p>
        </div>

        {/* Features Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="group p-6 rounded-2xl bg-gray-900/50 border border-gray-800 hover:border-purple-500/50 transition-all hover:-translate-y-1"
            >
              <div
                className={`w-12 h-12 rounded-xl bg-gradient-to-br ${feature.color} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}
              >
                <feature.icon className="w-6 h-6 text-white" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">{feature.title}</h3>
              <p className="text-gray-400">{feature.description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

// =============================================================================
// HOW IT WORKS SECTION
// =============================================================================
function HowItWorksSection() {
  const steps = [
    {
      step: "01",
      title: "Watch the Chart",
      description: "See the real-time price movement on the grid. The pink line shows where the market is heading.",
      emoji: "📈",
    },
    {
      step: "02",
      title: "Tap Your Prediction",
      description: "Tap on a cell in the future zone. Higher rows = price goes up. Lower rows = price goes down.",
      emoji: "👆",
    },
    {
      step: "03",
      title: "Wait & Win",
      description: "When the timeline reaches your cell, if the price is there, you win! Build streaks for bonus multipliers.",
      emoji: "🎉",
    },
  ];

  return (
    <section id="how-it-works" className="py-24 sm:py-32 relative bg-gradient-to-b from-black via-purple-950/20 to-black">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-16">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-cyan-500/10 border border-cyan-500/30 mb-6"
          >
            <BookOpen className="w-4 h-4 text-cyan-400" />
            <span className="text-sm text-cyan-300">Simple to Learn</span>
          </motion.div>
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="text-3xl sm:text-5xl font-black text-white mb-4"
          >
            How It Works
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
            className="text-gray-400 max-w-2xl mx-auto"
          >
            Master the game in 30 seconds. It&apos;s that simple.
          </motion.p>
        </div>

        {/* Steps */}
        <div className="space-y-12 sm:space-y-24">
          {steps.map((item, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.2 }}
              className={`flex flex-col ${
                i % 2 === 0 ? "lg:flex-row" : "lg:flex-row-reverse"
              } items-center gap-8 lg:gap-16`}
            >
              {/* Content */}
              <div className="flex-1 text-center lg:text-left">
                <div className="inline-block px-4 py-1 rounded-full bg-purple-500/20 text-purple-400 font-bold text-sm mb-4">
                  Step {item.step}
                </div>
                <h3 className="text-2xl sm:text-3xl font-bold text-white mb-4">
                  {item.title}
                </h3>
                <p className="text-gray-400 text-lg">{item.description}</p>
              </div>

              {/* Visual */}
              <div className="flex-1 w-full max-w-md">
                <div className="aspect-square rounded-3xl bg-gradient-to-br from-gray-900 to-gray-800 border border-purple-500/30 flex items-center justify-center">
                  <div className="text-8xl">{item.emoji}</div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mt-16"
        >
          <Link
            href="/trade"
            className="inline-flex items-center gap-2 px-8 py-4 rounded-2xl bg-gradient-to-r from-purple-500 to-pink-500 text-white font-bold text-lg hover:opacity-90 transition-all"
          >
            Try It Now - It&apos;s Free
            <ArrowRight className="w-5 h-5" />
          </Link>
        </motion.div>
      </div>
    </section>
  );
}

// =============================================================================
// TESTIMONIALS SECTION
// =============================================================================
function TestimonialsSection() {
  const testimonials = [
    {
      name: "Alex Chen",
      handle: "@alextrader",
      avatar: "A",
      text: "I've tried every trading game out there. Tap Trade is by far the most addictive. The streak system keeps me coming back!",
      rating: 5,
    },
    {
      name: "Sarah Miller",
      handle: "@sarahm_trades",
      avatar: "S",
      text: "Finally a prediction game that's actually fun and doesn't require hours to learn. My whole office is hooked.",
      rating: 5,
    },
    {
      name: "Marcus Johnson",
      handle: "@marcusj",
      avatar: "M",
      text: "The gamification is next level. Achievements, streaks, leaderboards - it's like playing a real game while learning markets.",
      rating: 5,
    },
    {
      name: "Emma Williams",
      handle: "@emmaw",
      avatar: "E",
      text: "Started playing on my lunch break, now I can't stop. The dopamine hit from a win streak is real!",
      rating: 5,
    },
    {
      name: "David Kim",
      handle: "@davidk",
      avatar: "D",
      text: "Super clean UI, instant gameplay, no BS. This is how all trading apps should be designed.",
      rating: 5,
    },
    {
      name: "Lisa Park",
      handle: "@lisap",
      avatar: "L",
      text: "Made the leaderboard this week! The competition aspect makes it so much more engaging than solo trading.",
      rating: 5,
    },
  ];

  return (
    <section id="testimonials" className="py-24 sm:py-32 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-16">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-green-500/10 border border-green-500/30 mb-6"
          >
            <MessageCircle className="w-4 h-4 text-green-400" />
            <span className="text-sm text-green-300">Loved by Players</span>
          </motion.div>
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="text-3xl sm:text-5xl font-black text-white mb-4"
          >
            What Players Are Saying
          </motion.h2>
        </div>

        {/* Testimonials Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {testimonials.map((t, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="p-6 rounded-2xl bg-gray-900/50 border border-gray-800"
            >
              {/* Stars */}
              <div className="flex gap-1 mb-4">
                {[...Array(t.rating)].map((_, j) => (
                  <Star key={j} className="w-4 h-4 text-yellow-400 fill-yellow-400" />
                ))}
              </div>

              {/* Text */}
              <p className="text-gray-300 mb-4">&ldquo;{t.text}&rdquo;</p>

              {/* Author */}
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white font-bold">
                  {t.avatar}
                </div>
                <div>
                  <div className="font-medium text-white">{t.name}</div>
                  <div className="text-sm text-gray-500">{t.handle}</div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

// =============================================================================
// FAQ SECTION
// =============================================================================
function FAQSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const faqs = [
    {
      q: "Is Tap Trade free to play?",
      a: "Yes! Tap Trade is completely free to play. You start with 10,000 virtual credits and can play unlimited games. There are optional premium features for those who want to enhance their experience.",
    },
    {
      q: "Is this real money trading?",
      a: "No. Tap Trade is a prediction game using virtual credits. While the price data is real, you're not trading actual assets. It's a fun, risk-free way to test your market intuition.",
    },
    {
      q: "How do win streaks work?",
      a: "When you win consecutive predictions, you build a streak. 2 wins = 1.1x multiplier, 3 wins = 1.2x, and it keeps growing up to 2x at 10+ wins. Streaks reset when you lose.",
    },
    {
      q: "Can I play on mobile?",
      a: "Absolutely! Tap Trade is built mobile-first as a Progressive Web App (PWA). It works on any device with a browser - iPhone, Android, tablet, or desktop.",
    },
    {
      q: "How are multipliers calculated?",
      a: "Multipliers are based on two factors: how far your prediction is from the current price (higher risk = higher reward) and how far in the future you're predicting. The formula rewards bold predictions.",
    },
    {
      q: "Is there a leaderboard?",
      a: "Yes! We have daily, weekly, and all-time leaderboards. Compete with players globally and see how you rank. Top players win prizes and exclusive badges.",
    },
    {
      q: "Can I lose more than my stake?",
      a: "No. You can only lose the amount you stake on each prediction. There's no leverage or margin trading - it's a simple win or lose based on your prediction.",
    },
    {
      q: "How do achievements work?",
      a: "There are 50+ achievements across 4 rarity tiers: Common, Rare, Epic, and Legendary. You unlock them by hitting milestones like win streaks, total wins, big payouts, and more. Each achievement awards XP.",
    },
  ];

  return (
    <section id="faq" className="py-24 sm:py-32 relative bg-gradient-to-b from-black via-purple-950/20 to-black">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-16">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-yellow-500/10 border border-yellow-500/30 mb-6"
          >
            <HelpCircle className="w-4 h-4 text-yellow-400" />
            <span className="text-sm text-yellow-300">Got Questions?</span>
          </motion.div>
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="text-3xl sm:text-5xl font-black text-white mb-4"
          >
            Frequently Asked Questions
          </motion.h2>
        </div>

        {/* FAQ List */}
        <div className="space-y-4">
          {faqs.map((faq, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.05 }}
              className="rounded-2xl border border-gray-800 overflow-hidden"
            >
              <button
                onClick={() => setOpenIndex(openIndex === i ? null : i)}
                className="w-full flex items-center justify-between p-5 text-left bg-gray-900/50 hover:bg-gray-900/80 transition-colors"
              >
                <span className="font-medium text-white">{faq.q}</span>
                <ChevronDown
                  className={`w-5 h-5 text-gray-400 transition-transform ${
                    openIndex === i ? "rotate-180" : ""
                  }`}
                />
              </button>
              <AnimatePresence>
                {openIndex === i && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="p-5 pt-0 text-gray-400">{faq.a}</div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </div>

        {/* More Questions */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="text-center mt-12"
        >
          <p className="text-gray-400 mb-4">Still have questions?</p>
          <Link
            href="/docs"
            className="inline-flex items-center gap-2 text-purple-400 hover:text-purple-300 font-medium"
          >
            <BookOpen className="w-4 h-4" />
            Read our full documentation
            <ChevronRight className="w-4 h-4" />
          </Link>
        </motion.div>
      </div>
    </section>
  );
}

// =============================================================================
// CTA SECTION
// =============================================================================
function CTASection() {
  return (
    <section className="py-24 sm:py-32 relative">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="p-8 sm:p-12 rounded-3xl bg-gradient-to-br from-purple-900/50 to-pink-900/50 border border-purple-500/30"
        >
          <h2 className="text-3xl sm:text-4xl font-black text-white mb-4">
            Ready to Start Winning?
          </h2>
          <p className="text-gray-300 mb-8 max-w-xl mx-auto">
            Join thousands of players already competing. It&apos;s free, it&apos;s fun, and you might just discover you have a knack for predicting markets.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/trade"
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-8 py-4 rounded-2xl bg-white text-black font-bold text-lg hover:bg-gray-100 transition-all"
            >
              <Play className="w-5 h-5" />
              Play Now - Free
            </Link>
            <Link
              href="/register"
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-8 py-4 rounded-2xl border border-white/30 text-white font-medium hover:bg-white/10 transition-all"
            >
              Create Account
            </Link>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

// =============================================================================
// FOOTER
// =============================================================================
function Footer() {
  return (
    <footer className="py-12 border-t border-gray-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid md:grid-cols-4 gap-8 mb-12">
          {/* Brand */}
          <div className="md:col-span-1">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                <Zap className="w-4 h-4 text-white" />
              </div>
              <span className="text-lg font-black text-white">TAP TRADE</span>
            </div>
            <p className="text-gray-400 text-sm">
              The most addictive price prediction game. Built for traders and gamers alike.
            </p>
          </div>

          {/* Product */}
          <div>
            <h4 className="font-bold text-white mb-4">Product</h4>
            <ul className="space-y-2 text-sm">
              <li><Link href="/trade" className="text-gray-400 hover:text-white">Play Now</Link></li>
              <li><a href="#features" className="text-gray-400 hover:text-white">Features</a></li>
              <li><Link href="/leaderboard" className="text-gray-400 hover:text-white">Leaderboard</Link></li>
              <li><Link href="/docs" className="text-gray-400 hover:text-white">Documentation</Link></li>
            </ul>
          </div>

          {/* Company */}
          <div>
            <h4 className="font-bold text-white mb-4">Company</h4>
            <ul className="space-y-2 text-sm">
              <li><Link href="/about" className="text-gray-400 hover:text-white">About Us</Link></li>
              <li><Link href="/careers" className="text-gray-400 hover:text-white">Careers</Link></li>
              <li><Link href="/press" className="text-gray-400 hover:text-white">Press Kit</Link></li>
              <li><Link href="/contact" className="text-gray-400 hover:text-white">Contact</Link></li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h4 className="font-bold text-white mb-4">Legal</h4>
            <ul className="space-y-2 text-sm">
              <li><Link href="/privacy" className="text-gray-400 hover:text-white">Privacy Policy</Link></li>
              <li><Link href="/terms" className="text-gray-400 hover:text-white">Terms of Service</Link></li>
              <li><Link href="/disclaimer" className="text-gray-400 hover:text-white">Disclaimer</Link></li>
            </ul>
          </div>
        </div>

        {/* Bottom */}
        <div className="flex flex-col sm:flex-row items-center justify-between pt-8 border-t border-gray-800">
          <p className="text-gray-500 text-sm mb-4 sm:mb-0">
            &copy; {new Date().getFullYear()} Tap Trade. All rights reserved.
          </p>
          <div className="flex items-center gap-4">
            <a href="https://twitter.com" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-white">
              <Twitter className="w-5 h-5" />
            </a>
            <a href="https://github.com" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-white">
              <Github className="w-5 h-5" />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}

// =============================================================================
// MAIN PAGE
// =============================================================================
export default function HomePage() {
  return (
    <main className="min-h-screen bg-black text-white overflow-x-hidden">
      <Navbar />
      <HeroSection />
      <FeaturesSection />
      <HowItWorksSection />
      <TestimonialsSection />
      <FAQSection />
      <CTASection />
      <Footer />
    </main>
  );
}
