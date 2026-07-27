import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";

export const metadata = {
  title: "Privacy Policy — Storimac",
};

export default function PrivacyPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-neutral-950 text-neutral-200">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-12">
        <h1 className="text-2xl font-bold text-white">Privacy Policy</h1>
        <p className="mt-2 text-xs text-neutral-500">Last updated: July 26, 2026</p>

        <section className="mt-8 space-y-6 text-sm leading-relaxed text-neutral-300">
          <div>
            <h2 className="mb-2 text-base font-semibold text-white">What we collect</h2>
            <p>
              When you create an account we store your email address and, if you sign in with
              Google, your name and profile photo as provided by Google. As you use Storimac we
              store the content you create: your workspaces, story canvases, interview
              conversations, canon decisions, and generated Story Foundation Documents.
            </p>
          </div>
          <div>
            <h2 className="mb-2 text-base font-semibold text-white">How your story content is used</h2>
            <p>
              Your interview messages are sent to Anthropic&apos;s Claude API to generate the
              editor&apos;s responses. Your story content belongs to you: we do not sell it, share
              it with other users outside your workspace, or use it to train models.
            </p>
          </div>
          <div>
            <h2 className="mb-2 text-base font-semibold text-white">Where data lives</h2>
            <p>
              Data is stored in Google Cloud Firestore (Firebase) in the United States.
              Authentication is handled by Firebase Authentication. We keep your Projects
              indefinitely so you can resume them; deleting a canvas or workspace removes its
              content from our primary datastore.
            </p>
          </div>
          <div>
            <h2 className="mb-2 text-base font-semibold text-white">Cookies</h2>
            <p>
              We use a single HttpOnly session cookie to keep you signed in for up to 14 days. We
              do not use advertising or cross-site tracking cookies.
            </p>
          </div>
          <div>
            <h2 className="mb-2 text-base font-semibold text-white">Your choices</h2>
            <p>
              You can sign out at any time, delete canvases and workspaces from within the app,
              or contact us at hello@storimac.app to request deletion of your account and all
              associated data.
            </p>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
