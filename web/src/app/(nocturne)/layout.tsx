import { Libre_Franklin, Courier_Prime } from "next/font/google";
import "@/styles/nocturne.css";

const libreFranklin = Libre_Franklin({
  variable: "--font-heading-family",
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
});

// Industry-standard screenplay typeface, used only by the .ob-script preview.
const courierPrime = Courier_Prime({
  variable: "--font-script-family",
  weight: ["400", "700"],
  subsets: ["latin"],
});

export default function NocturneLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={`${libreFranklin.variable} ${courierPrime.variable}`}>
      {children}
    </div>
  );
}
