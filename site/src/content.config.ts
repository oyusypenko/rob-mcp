import { defineCollection } from "astro:content";
import { file } from "astro/loaders";
import { z } from "astro/zod";

const tools = defineCollection({
  loader: file("src/generated/tools.json"),
  schema: z.object({
    name: z.string(),
    title: z.string(),
    description: z.string(),
    tier: z.enum(["free", "paid"]),
    price: z.string().nullable(),
    surfaces: z.array(z.enum(["hosted", "local"])),
    availability: z.enum(["implemented", "implemented-but-live-gated"]),
    gates: z.array(z.string()),
    inputSchema: z.record(z.string(), z.unknown()),
    outputSchema: z.record(z.string(), z.unknown()),
    exampleInput: z.record(z.string(), z.unknown()),
    route: z.string(),
  }),
});

export const collections = { tools };
