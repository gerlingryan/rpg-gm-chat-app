"use client";

import Link from "next/link";
import type { ReactNode } from "react";

type CampaignCreateShellProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
};

export default function CampaignCreateShell({
  title,
  subtitle,
  children,
}: CampaignCreateShellProps) {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(155,231,255,0.15),_transparent_35%),linear-gradient(135deg,_#08111f_0%,_#101b31_45%,_#170f22_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-5">
        <section className="rounded-[2rem] border border-white/10 bg-slate-950/65 p-6 shadow-2xl shadow-black/40 backdrop-blur md:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-cyan-100">
                Campaign Setup
              </p>
              <h1 className="mt-2 text-3xl font-semibold text-white">{title}</h1>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300">
                {subtitle}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Link
                href="/"
                className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm font-medium text-slate-200 transition hover:border-white/25 hover:text-white"
              >
                Back to Home
              </Link>
              <Link
                href="/characters"
                className="rounded-xl border border-cyan-300/40 bg-cyan-300/10 px-3 py-2 text-sm font-medium text-cyan-100 transition hover:border-cyan-300/70 hover:text-white"
              >
                Character Library
              </Link>
            </div>
          </div>
        </section>

        {children}
      </div>
    </main>
  );
}
