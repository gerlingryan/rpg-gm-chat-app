"use client";

import CampaignCreatePanel from "@/components/CampaignCreatePanel";
import CampaignCreateShell from "@/components/CampaignCreateShell";

export default function NewCampaignPage() {
  return (
    <CampaignCreateShell
      title="Create Campaign"
      subtitle="Pick a ruleset, choose a reusable main character, and seed your opening scenario."
    >
        <CampaignCreatePanel returnTo="/campaigns/new" />
    </CampaignCreateShell>
  );
}
