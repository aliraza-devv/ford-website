import type { Metadata } from "next";
import { Barlow, Barlow_Condensed, Inter, Work_Sans } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["800"],
});

const workSans = Work_Sans({
  variable: "--font-work-sans",
  subsets: ["latin"],
  weight: ["400", "500"],
});

// The plant (Section 4) speaks in the plant's own signage voice: a DIN-style
// grotesk, close in spirit to Ford's own typography. Condensed for figures and
// station names, regular width for sentences.
const barlowCondensed = Barlow_Condensed({
  variable: "--font-barlow-condensed",
  subsets: ["latin"],
  weight: ["500", "600"],
});

const barlow = Barlow({
  variable: "--font-barlow",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Ford | Built Ford Tough",
  description:
    "A century of American engineering. Reimagined for what comes next.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${workSans.variable} ${barlowCondensed.variable} ${barlow.variable} h-full antialiased`}
    >
      {/* Browser extensions (ClickUp's, in this case) append their own
          classes to <body> before React hydrates, which React reports as a
          hydration mismatch it "won't patch up". suppressHydrationWarning is
          React's documented escape hatch for exactly that -- third-party DOM
          mutation outside our control. It applies to this element only, not
          its children, so real mismatches inside the app still surface. */}
      <body suppressHydrationWarning className="min-h-full flex flex-col bg-ford-black">
        {children}
      </body>
    </html>
  );
}
