import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function DELETE(_req: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  const character = await prisma.character.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!character) {
    return NextResponse.json({ error: "Character not found" }, { status: 404 });
  }

  await prisma.character.delete({
    where: { id },
  });

  return NextResponse.json({ success: true });
}
