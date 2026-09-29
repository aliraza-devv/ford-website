import type { Metadata } from "next";
import { Inter, Work_Sans } from "next/font/google";
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

export const metadata: Metadata = {
  title: "Ford | Built Ford Tough",
  description:
    "A century of American engineering. Reimagined for what comes next.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${workSans.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-ford-black">
        {children}
      </body>
    </html>
  );
}
