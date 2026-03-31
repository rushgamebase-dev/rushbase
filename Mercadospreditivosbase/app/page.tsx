import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { LiveMarketCard } from "@/components/home/LiveMarketCard";
import { FeaturedMarketHero } from "@/components/home/FeaturedMarketHero";
import { FeaturedMarkets } from "@/components/home/FeaturedMarkets";
import { HowItWorks } from "@/components/home/HowItWorks";
import { WhyRush } from "@/components/home/WhyRush";
import { SocialProof } from "@/components/home/SocialProof";
import { CTASection } from "@/components/home/CTASection";

export default function Home() {
  return (
    <div className="min-h-screen" style={{ background: "var(--background)", color: "var(--text)" }}>
      <Header />
      <main>
        <LiveMarketCard />
        <FeaturedMarketHero />
        <FeaturedMarkets />
        <HowItWorks />
        <WhyRush />
        <SocialProof />
        <CTASection />
      </main>
      <Footer />
    </div>
  );
}
