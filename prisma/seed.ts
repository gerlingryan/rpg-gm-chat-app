import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({
  connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({ adapter });

async function main() {
  await prisma.message.deleteMany();
  await prisma.character.deleteMany();
  await prisma.campaign.deleteMany();

  const campaign = await prisma.campaign.create({
    data: {
      title: "Test Adventure",
      ruleset: "Fantasy d20",
      characters: {
        create: [
          {
            name: "Aric Vale",
            role: "player",
            isMainCharacter: true,
            sheetJson: {
              class: "Fighter",
              level: 1,
              hp: { current: 12, max: 12 },
              ac: 16,
            },
            memorySummary: "A practical adventurer looking for coin and purpose.",
          },
          {
            name: "Mara Quill",
            role: "companion",
            isMainCharacter: false,
            sheetJson: {
              class: "Rogue",
              level: 1,
              hp: { current: 9, max: 9 },
              ac: 14,
            },
            memorySummary: "A sharp-eyed scout who watches everyone carefully.",
          },
        ],
      },
      messages: {
        create: [
          {
            speakerName: "GM",
            role: "gm",
            content:
              "The rain taps softly against the tavern shutters as the fire crackles low. A hooded stranger watches your table from the corner. What do you do?",
          },
        ],
      },
    },
    include: {
      characters: true,
      messages: true,
    },
  });

  console.log("Seed complete.");
  console.log("Campaign ID:", campaign.id);
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
