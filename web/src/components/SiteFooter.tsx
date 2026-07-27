import Link from "next/link";

/** Site footer — issue #90. On marketing/legal pages; not inside the interview frame. */
export default function SiteFooter() {
  return (
    <footer className="border-t border-neutral-800 bg-neutral-950">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-5 py-6 text-xs text-neutral-500 sm:flex-row">
        <p>© Storimac {new Date().getFullYear()}</p>
        <nav className="flex items-center gap-5">
          <Link href="/privacy" className="hover:text-neutral-300">
            Privacy Policy
          </Link>
          <Link href="/terms" className="hover:text-neutral-300">
            Terms &amp; Conditions
          </Link>
          <a href="mailto:hello@storimac.app" className="hover:text-neutral-300">
            Contact
          </a>
        </nav>
      </div>
    </footer>
  );
}
