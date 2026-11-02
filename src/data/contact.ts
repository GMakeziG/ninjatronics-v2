// Contact page content (Milestone 3D, approved 2026-11-02).
//
// Only publish contact details the author has explicitly approved. No
// phone numbers, locations, employers, or other personal information.
//
// Profile URLs live in src/config/site.ts (shared with About and the
// footer); this file adds the approved email and the page copy.
//
// Validated when the module loads, so a malformed entry fails the build.
import { z } from "astro/zod";
import { SITE } from "../config/site";

const channelSchema = z.object({
  /** Short mono label, e.g. "Email". */
  label: z.string().min(1),
  /** Visible link text: the address or a readable URL. */
  display: z.string().min(1),
  href: z.string().min(1),
  note: z.string().min(1),
  /** Profile that represents the author (adds rel="me"). */
  isProfile: z.boolean(),
});

const contactSchema = z.object({
  /** Approved public address (approved 2026-11-02). */
  email: z.email(),
  intro: z.string().min(1),
  channels: z
    .array(channelSchema)
    .min(1)
    .superRefine((channels, ctx) => {
      for (const channel of channels) {
        const ok = channel.isProfile ? /^https:\/\//.test(channel.href) : /^mailto:[^\s?#]+$/.test(channel.href);
        if (!ok) ctx.addIssue({ code: "custom", message: `${channel.label}: profiles need an https:// URL; email needs a plain mailto: link` });
      }
    }),
  closing: z.object({
    lead: z.string().min(1),
    projects: z.literal("/projects"),
    blog: z.literal("/blog"),
  }),
});

const EMAIL = "gerso@ninjatronics.io";

/** "https://www.linkedin.com/in/gerso-guillen/" → "linkedin.com/in/gerso-guillen" */
const readable = (url: string) => url.replace(/^https:\/\/(www\.)?/, "").replace(/\/$/, "");

export const CONTACT = contactSchema.parse({
  email: EMAIL,
  intro: "I'm happy to talk about DevOps, platform engineering, infrastructure automation, and technical collaboration.",
  channels: [
    { label: "Email", display: EMAIL, href: `mailto:${EMAIL}`, note: "Best for questions and collaboration.", isProfile: false },
    { label: "LinkedIn", display: readable(SITE.linkedin), href: SITE.linkedin, note: "Professional background and networking.", isProfile: true },
    { label: "GitHub", display: readable(SITE.github), href: SITE.github, note: "Code and projects.", isProfile: true },
  ],
  closing: { lead: "Want some context first?", projects: "/projects", blog: "/blog" },
});

// The mailto link must carry exactly the approved address.
const mailto = CONTACT.channels.find((c) => !c.isProfile);
if (mailto && mailto.href !== `mailto:${CONTACT.email}`) {
  throw new Error("src/data/contact.ts: the email channel must link to the approved address");
}
