import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import LandingCta from "@/components/LandingCta";
import HeroDemo from "@/components/landing/HeroDemo";
import ProblemSection from "@/components/landing/ProblemSection";
import HowItWorks from "@/components/landing/HowItWorks";
import DeepDive from "@/components/landing/DeepDive";
import ProCards from "@/components/landing/ProCards";
import Faq from "@/components/landing/Faq";
import FinalCta from "@/components/landing/FinalCta";

export default function Home() {
  return (
    <div className="nocturne-scope ob-root">
      <SiteHeader />
      <main>
        <section className="ld-section ld-hero">
          <div className="ld-inner ld-center">
            <h1 className="ld-h1">
              Turn a story idea into a locked creative foundation.
            </h1>
            <p className="ld-lede">
              A guided interview with an expert development editor — one focused
              question at a time — that hardens your premise, format, theme, and
              dramatic engine into a Story Foundation Document your drafting
              depends on.
            </p>
            <LandingCta />
            <HeroDemo />
          </div>
        </section>
        <ProblemSection />
        <HowItWorks />
        <DeepDive />
        <ProCards />
        <Faq />
        <FinalCta />
      </main>
      <SiteFooter />
    </div>
  );
}
