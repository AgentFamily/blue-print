import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { Magic } from "magic-sdk";
import { useEffect, useMemo, useState } from "react";

/**
 * Magic publishable key resolution for sandboxed/front-end environments.
 *
 * Supported sources (first match wins):
 *  1) window.__MAGIC_PUBLISHABLE_KEY__ (recommended for this sandbox)
 *  2) import.meta.env.VITE_MAGIC_PUBLISHABLE_KEY (Vite)
 *  3) fallback placeholder string
 */
export function resolveMagicPublishableKey(): string {
  // 1) Global injected config (works well in pure front-end sandboxes)
  if (typeof window !== "undefined") {
    const w = window as unknown as { __MAGIC_PUBLISHABLE_KEY__?: string };
    if (typeof w.__MAGIC_PUBLISHABLE_KEY__ === "string" && w.__MAGIC_PUBLISHABLE_KEY__.trim()) {
      return w.__MAGIC_PUBLISHABLE_KEY__.trim();
    }
  }

  // 2) Vite-style env (safe guard if import.meta exists)
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const meta: any = typeof import.meta !== "undefined" ? (import.meta as any) : undefined;
    const key = meta?.env?.VITE_MAGIC_PUBLISHABLE_KEY;
    if (typeof key === "string" && key.trim()) return key.trim();
  } catch {
    // ignore
  }

  // 3) Placeholder
  return "YOUR_MAGIC_PUBLISHABLE_KEY";
}

const FeatureIcon = ({ label, icon }: { label: string; icon: string }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    whileInView={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.5 }}
    className="flex flex-col items-center gap-3"
  >
    <div className="w-16 h-16 bg-gradient-to-br from-green-100 to-green-50 rounded-2xl flex items-center justify-center text-2xl border border-green-200">
      {icon}
    </div>
    <p className="text-sm font-medium text-slate-700 text-center">{label}</p>
  </motion.div>
);

export default function AiRealtorLanding() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const magicKey = useMemo(() => resolveMagicPublishableKey(), []);

  const magic = useMemo(() => {
    if (typeof window === "undefined") return null;
    if (!magicKey || magicKey === "YOUR_MAGIC_PUBLISHABLE_KEY") return null;
    return new Magic(magicKey);
  }, [magicKey]);

  useEffect(() => {
    if (magicKey === "YOUR_MAGIC_PUBLISHABLE_KEY") {
      setStatus(
        "Configure Magic publishable key: set window.__MAGIC_PUBLISHABLE_KEY__ (or VITE_MAGIC_PUBLISHABLE_KEY)."
      );
    } else {
      setStatus(null);
    }
  }, [magicKey]);

  const handleMagicLogin = async () => {
    if (!email.trim()) {
      setStatus("Please enter a valid email.");
      return;
    }
    if (!magic) {
      setStatus(
        "Magic Link is not configured yet. Add your publishable key (window.__MAGIC_PUBLISHABLE_KEY__)."
      );
      return;
    }

    setLoading(true);
    setStatus(null);
    try {
      await magic.auth.loginWithMagicLink({ email: email.trim() });
      setStatus("✅ Login link verified. Redirect to dashboard (wire routing next).");
      // TODO: replace alert with router push to /dashboard
      // e.g., router.push('/dashboard')
    } catch (err) {
      console.error(err);
      setStatus("Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-100 font-sans">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-sm border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="text-2xl font-bold">
            <span>Miss</span>
            <span className="text-green-600">.Lead</span>
          </div>
          <div className="hidden md:flex items-center gap-8">
            <a href="#features" className="text-slate-600 hover:text-slate-900">Features</a>
            <a href="#how-it-works" className="text-slate-600 hover:text-slate-900">How It Works</a>
            <a href="#pricing" className="text-slate-600 hover:text-slate-900">Pricing</a>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative max-w-7xl mx-auto px-6 py-24 grid md:grid-cols-2 gap-16 items-center">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <div className="inline-block bg-green-50 border border-green-200 rounded-full px-4 py-2 mb-6">
            <p className="text-sm font-semibold text-green-700">🎯 24/7 Lead Management</p>
          </div>

          <h1 className="text-5xl md:text-6xl font-bold tracking-tight mb-6">
            Meet <span className="text-green-600">Miss.Lead</span>
          </h1>

          <p className="text-xl text-slate-600 mb-4 max-w-xl leading-relaxed">
            <strong>Bottom line:</strong> Miss Lead answers calls and qualifies leads 24/7—so you never miss an opportunity.
          </p>
          <p className="text-lg text-slate-500 mb-10 max-w-xl leading-relaxed">
            <strong>Briefly:</strong> Real-time qualification, automatic appointment booking, and relentless follow-up—all handled professionally.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 max-w-md mb-6">
            <input
              type="email"
              placeholder="Work email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-full border border-slate-300 px-6 py-4 text-lg focus:outline-none focus:ring-2 focus:ring-green-500 transition"
            />
            <Button
              onClick={handleMagicLogin}
              disabled={loading}
              className="rounded-full px-10 py-4 text-lg bg-green-600 hover:bg-green-700 whitespace-nowrap"
            >
              {loading ? "Sending…" : "Get Started"}
            </Button>
          </div>

          {status && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-sm bg-white/70 border border-slate-200 rounded-full p-4 inline-block max-w-md"
            >
              {status}
            </motion.div>
          )}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6 }}
          className="relative"
        >
          <img
            src="/ChatGPT_Image_Feb_4__2026_at_12_38_34_PM-removebg-preview.png"
            alt="Miss Lead AI Assistant"
            className="w-full max-w-md mx-auto drop-shadow-lg"
          />
        </motion.div>
      </section>

      {/* Key Metrics */}
      <section className="bg-white py-16 border-y border-slate-200">
        <div className="max-w-6xl mx-auto px-6">
          <div className="grid md:grid-cols-4 gap-8">
            {[
              { metric: "24/7", label: "Always Available" },
              { metric: "< 1min", label: "Response Time" },
              { metric: "100%", label: "Lead Capture" },
              { metric: "∞", label: "Follow-up Cycles" },
            ].map((item, i) => (
              <div key={i} className="text-center">
                <p className="text-4xl font-bold text-green-600 mb-2">{item.metric}</p>
                <p className="text-slate-600">{item.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Core Features */}
      <section id="features" className="max-w-6xl mx-auto px-6 py-24">
        <h2 className="text-4xl font-bold text-center mb-16">What Miss.Lead Does For You</h2>
        <div className="grid md:grid-cols-2 gap-12">
          {[
            {
              title: "24/7 Call Handling",
              desc: "Answers incoming calls at all times—no voicemail, no delays. Immediate professional response to every lead.",
              icon: "☎️",
            },
            {
              title: "Real-time Qualification",
              desc: "Asks the right questions to identify serious buyers, sellers, and investors. Saves hours of agent time.",
              icon: "🎯",
            },
            {
              title: "Automatic Appointment Booking",
              desc: "Schedules viewings, valuations, and consultations directly into your calendar. Zero manual scheduling.",
              icon: "📅",
            },
            {
              title: "Relentless Follow-up",
              desc: "Polite, persistent follow-ups ensure no lead falls through cracks. Professional nurturing at scale.",
              icon: "🔄",
            },
            {
              title: "Outbound Lead Generation",
              desc: "Manages large call volumes for new listings, old enquiries, and nurture campaigns automatically.",
              icon: "📞",
            },
            {
              title: "Scalable Cost Reduction",
              desc: "Eliminate staffing overhead for lead handling. Scale your agency without hiring more staff.",
              icon: "💰",
            },
          ].map((feature, idx) => (
            <motion.div
              key={idx}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: idx * 0.1 }}
              viewport={{ once: true }}
              className="bg-white border border-slate-200 rounded-2xl p-8 hover:shadow-lg transition"
            >
              <div className="text-4xl mb-4">{feature.icon}</div>
              <h3 className="text-xl font-semibold mb-3 text-slate-900">{feature.title}</h3>
              <p className="text-slate-600 leading-relaxed">{feature.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Secondary Visual */}
      <section className="relative max-w-6xl mx-auto px-6 py-24 grid md:grid-cols-2 gap-12 items-center">
        <motion.div
          initial={{ opacity: 0, x: -40 }}
          whileInView={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6 }}
          viewport={{ once: true }}
        >
          <img
            src="/ChatGPT_Image_Feb_4__2026_at_12_38_37_PM-removebg-preview.png"
            alt="Miss Lead Professional Quality"
            className="w-full max-w-sm mx-auto drop-shadow-lg"
          />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 40 }}
          whileInView={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6 }}
          viewport={{ once: true }}
        >
          <h2 className="text-4xl font-bold mb-6">Always On. Never Intrusive.</h2>
          <p className="text-lg text-slate-600 mb-6 leading-relaxed">
            <strong>Bottom line:</strong> Conversations continue without pressure. Leads feel attended to, not sold to.
          </p>
          <p className="text-lg text-slate-600 mb-8 leading-relaxed">
            <strong>Briefly:</strong> Miss Lead qualifies intent, respects hesitation, and knows when to pause. Clean handoff with full context for your agents.
          </p>
          <div className="flex flex-col sm:flex-row gap-4">
            <Button className="rounded-full px-8 py-4 bg-green-600 hover:bg-green-700">
              Watch Demo
            </Button>
            <Button
              variant="outline"
              className="rounded-full px-8 py-4 border-green-600 text-green-600 hover:bg-green-50"
            >
              Contact Sales
            </Button>
          </div>
        </motion.div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="bg-slate-900 text-white py-24">
        <div className="max-w-6xl mx-auto px-6">
          <h2 className="text-4xl font-bold mb-16 text-center">The Miss.Lead Workflow</h2>
          <div className="grid md:grid-cols-5 gap-6">
            {[
              { step: 1, title: "Detect", desc: "Lead arrives (call, form, portal)" },
              { step: 2, title: "Answer", desc: "Miss.Lead responds instantly" },
              { step: 3, title: "Qualify", desc: "Real-time intent & budget check" },
              { step: 4, title: "Book", desc: "Auto-schedule & notify agent" },
              { step: 5, title: "Follow-up", desc: "Persistent nurture until close" },
            ].map((item, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                viewport={{ once: true }}
                className="relative"
              >
                <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 h-full">
                  <div className="w-10 h-10 bg-green-600 rounded-full flex items-center justify-center font-bold mb-4">
                    {item.step}
                  </div>
                  <h3 className="font-semibold text-lg mb-2">{item.title}</h3>
                  <p className="text-slate-300 text-sm">{item.desc}</p>
                </div>
                {i < 4 && (
                  <div className="hidden md:block absolute top-1/4 -right-3 transform -translate-y-1/2">
                    <div className="text-green-600 text-2xl">→</div>
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Why Different */}
      <section className="max-w-6xl mx-auto px-6 py-24">
        <h2 className="text-4xl font-bold text-center mb-16">Why Miss.Lead Stands Apart</h2>
        <div className="grid md:grid-cols-3 gap-8">
          {[
            {
              title: "Commission-Aligned Pricing",
              desc: "No subscriptions. No surprises. You succeed, we succeed. Pay only for real results.",
            },
            {
              title: "Ultra-Permission First",
              desc: "Every interaction follows consent rules. Your brand trust stays intact. Clients feel respected.",
            },
            {
              title: "Human Review Ready",
              desc: "When confidence drops, humans take over. Always transparent. Always accountable.",
            },
          ].map((item, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              viewport={{ once: true }}
              className="bg-gradient-to-br from-green-50 to-white border border-green-200 rounded-2xl p-8"
            >
              <h3 className="text-xl font-semibold mb-4 text-slate-900">{item.title}</h3>
              <p className="text-slate-600 leading-relaxed">{item.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="bg-white py-24 border-t border-slate-200">
        <div className="max-w-6xl mx-auto px-6 text-center">
          <h2 className="text-4xl font-bold mb-6">Simple. Performance-Based Pricing.</h2>
          <p className="text-xl text-slate-600 mb-16 max-w-2xl mx-auto">
            No hidden fees. No commitments. Scale up or down with your business.
          </p>
          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {[
              { tier: "Starter", price: "$99", leads: "Up to 50 leads/mo", color: "slate" },
              {
                tier: "Professional",
                price: "$299",
                leads: "Up to 500 leads/mo",
                color: "green",
                featured: true,
              },
              { tier: "Enterprise", price: "Custom", leads: "Unlimited leads", color: "slate" },
            ].map((plan, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, scale: 0.95 }}
                whileInView={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                viewport={{ once: true }}
                className={`rounded-2xl p-8 ${
                  plan.featured
                    ? "bg-green-600 text-white border-2 border-green-600 transform scale-105"
                    : "bg-white border border-slate-200"
                }`}
              >
                <h3 className="text-2xl font-bold mb-2">{plan.tier}</h3>
                <div className="mb-6">
                  <span className="text-4xl font-bold">{plan.price}</span>
                  {plan.price !== "Custom" && <span className="/mo text-slate-500">/mo</span>}
                </div>
                <p className={`mb-8 font-medium ${plan.featured ? "text-green-50" : "text-slate-600"}`}>
                  {plan.leads}
                </p>
                <Button
                  className={`w-full rounded-full py-3 font-semibold ${
                    plan.featured
                      ? "bg-white text-green-600 hover:bg-green-50"
                      : "bg-green-600 text-white hover:bg-green-700"
                  }`}
                >
                  Get Started
                </Button>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Final */}
      <section className="bg-gradient-to-r from-green-600 to-green-700 text-white py-24 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          viewport={{ once: true }}
        >
          <h2 className="text-5xl font-bold mb-6">Stop Leaving Money on the Table</h2>
          <p className="text-xl mb-10 max-w-2xl mx-auto opacity-95">
            Every missed lead is a missed commission. Miss.Lead ensures you capture every opportunity, qualify faster, and close more deals.
          </p>
          <div className="flex flex-col sm:flex-row justify-center gap-4">
            <Button className="rounded-full px-12 py-4 text-lg bg-white text-green-600 hover:bg-slate-50 font-semibold">
              Start Free Trial
            </Button>
            <Button
              variant="outline"
              className="rounded-full px-12 py-4 text-lg text-white border-white hover:bg-green-700 font-semibold"
            >
              Schedule Demo
            </Button>
          </div>
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-900 text-slate-300 py-12">
        <div className="max-w-6xl mx-auto px-6">
          <div className="grid md:grid-cols-4 gap-12 mb-8">
            <div>
              <p className="font-bold text-white mb-4">Miss.Lead</p>
              <p className="text-sm">AI-powered lead management for real estate professionals.</p>
            </div>
            <div>
              <p className="font-semibold text-white mb-4">Product</p>
              <ul className="text-sm space-y-2">
                <li><a href="#features" className="hover:text-white">Features</a></li>
                <li><a href="#how-it-works" className="hover:text-white">How It Works</a></li>
                <li><a href="#pricing" className="hover:text-white">Pricing</a></li>
              </ul>
            </div>
            <div>
              <p className="font-semibold text-white mb-4">Support</p>
              <ul className="text-sm space-y-2">
                <li><a href="#" className="hover:text-white">Documentation</a></li>
                <li><a href="#" className="hover:text-white">Contact</a></li>
                <li><a href="#" className="hover:text-white">FAQ</a></li>
              </ul>
            </div>
            <div>
              <p className="font-semibold text-white mb-4">Legal</p>
              <ul className="text-sm space-y-2">
                <li><a href="#" className="hover:text-white">Privacy</a></li>
                <li><a href="#" className="hover:text-white">Terms</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-slate-700 pt-8 text-center text-sm">
            <p>© 2026 Miss.Lead. All rights reserved. | Licensed domains: misslead.* | assistantlady.*</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

/**
 * Minimal "tests" (no framework needed). These run only in dev/sandbox consoles.
 * They ensure we never reference Node-only globals like `process`.
 */
(function basicTests() {
  try {
    // Should not throw even when window is undefined (SSR-like)
    const key = resolveMagicPublishableKey();
    console.assert(typeof key === "string", "resolveMagicPublishableKey returns a string");
  } catch (e) {
    console.error("Basic tests failed", e);
  }
})();