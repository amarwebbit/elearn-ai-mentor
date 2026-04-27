import { Navbar } from "@/components/layout/Navbar";
import { Hero } from "@/components/layout/Hero";
import { SocialProof } from "@/components/layout/SocialProof";
import { Features } from "@/components/layout/Features";
import { HowItWorks } from "@/components/layout/HowItWorks";
import { Pricing } from "@/components/layout/Pricing";
import { Testimonials } from "@/components/layout/Testimonials";
import { FAQ } from "@/components/layout/FAQ";
import { Footer } from "@/components/layout/Footer";

export default function Home() {
  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col font-body">
      <Navbar />
      <main className="flex-1">
        <Hero />
        <SocialProof />
        <Features />
        <HowItWorks />
        <Pricing />
        <Testimonials />
        <FAQ />
      </main>
      <Footer />
    </div>
  );
}
