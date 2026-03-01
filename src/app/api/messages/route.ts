import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const campaignId = req.nextUrl.searchParams.get("campaignId");

  if (!campaignId) {
    return NextResponse.json({ error: "campaignId is required" }, { status: 400 });
  }

  const messages = await prisma.message.findMany({
    where: { campaignId },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ messages });
}
