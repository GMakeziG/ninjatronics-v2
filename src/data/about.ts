// About page content (Milestone 3, approved 2026-11-02).
//
// Every fact here was supplied or confirmed by the author, or comes from the
// career content he published on the legacy site. Don't add roles, dates,
// responsibilities, or accomplishments that haven't been confirmed.
//
// Defense-sector role: the employer is generalized and only the approved
// description is published. Never add its customer, compliance frameworks,
// tenancy, products, incidents, or internal projects.
//
// The data is validated when the module loads, so a malformed date, URL, or
// missing field fails the build instead of rendering a broken page.
import { z } from "astro/zod";
import { CATEGORY_SLUGS } from "../config/categories";

const yearMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM");
const httpsUrl = z.url({ protocol: /^https$/ });

const organizationSchema = z.object({
  name: z.string().min(1),
  /** Short qualifier shown after the name, e.g. "Nonprofit". */
  kind: z.string().optional(),
  /** Official website, confirmed against the organization's own site. */
  url: httpsUrl.optional(),
  /** Mission statement, as provided by the author. */
  description: z.string().optional(),
  /** List as an employer in structured data. Off for the generalized employer. */
  inStructuredData: z.boolean(),
});

const currentRoleSchema = z.object({
  title: z.string().min(1),
  organization: organizationSchema,
  start: yearMonth,
  responsibilities: z.string().min(1),
});

const careerEntrySchema = z.object({
  title: z.string().min(1),
  organization: z.string().min(1),
  location: z.string().optional(),
  start: yearMonth,
  /** Omitted for current roles. */
  end: yearMonth.optional(),
  /** One or two short lines. Current roles have none: their card says it. */
  highlights: z.array(z.string().min(1)).max(2),
});

const earlierRoleSchema = z.object({
  organization: z.string().min(1),
  years: z.string().regex(/^\d{4}–\d{4}$/, "Use YYYY–YYYY"),
});

const certificationSchema = z.object({
  /** Official credential name, as shown on the verification page. */
  name: z.string().min(1),
  /** Exam code, where the credential has one. */
  code: z.string().optional(),
  issuer: z.string().min(1),
  verifyUrl: httpsUrl,
  /** Who hosts the verification page, when it isn't the issuer. */
  verifyHost: z.string().optional(),
});

const aboutSchema = z.object({
  headline: z.string().min(1),
  location: z.string().min(1),
  introduction: z.string().min(1),
  currentRolesIntro: z.string().min(1),
  currentRoles: z.array(currentRoleSchema).min(1),
  focusAreas: z.array(
    z.object({
      label: z.string().min(1),
      /** Blog categories to link; only those with published articles are linked. */
      categories: z.array(z.enum(CATEGORY_SLUGS)),
    }),
  ),
  career: z.array(careerEntrySchema).min(1),
  earlierCareer: z.object({
    summary: z.string().min(1),
    roles: z.array(earlierRoleSchema).min(1),
  }),
  certifications: z.array(certificationSchema),
  skills: z.array(z.object({ group: z.string().min(1), items: z.array(z.string().min(1)).min(1) })),
  learning: z.array(z.string().min(1)),
});

export type AboutContent = z.infer<typeof aboutSchema>;
export type CareerEntry = z.infer<typeof careerEntrySchema>;
export type CurrentRole = z.infer<typeof currentRoleSchema>;

const KEELWORKS = {
  name: "KeelWorks",
  kind: "Nonprofit",
  url: "https://keelworks.org",
  description:
    "KeelWorks helps individuals overcome barriers to employment by developing the skills, confidence, and practical experience needed for meaningful, sustainable careers.",
  inStructuredData: true,
};

const MIS_HERMANOS_PEQUENITOS = {
  name: "Mis Hermanos Pequeñitos",
  kind: "Nonprofit",
  url: "https://mishermanospequenitos.org",
  description:
    "Mis Hermanos Pequeñitos brings hope, compassion, and meaningful support to children and families in need, through charitable outreach, access to essential resources, education, and community partnerships.",
  inStructuredData: true,
};

const DEFENSE_EMPLOYER = {
  name: "Defense-sector technology company",
  inStructuredData: false,
};

export const ABOUT: AboutContent = aboutSchema.parse({
  headline: "Senior Systems Administrator | DevOps & Platform Engineering",
  location: "Southern California",
  introduction:
    "I've worked in IT for more than 20 years, across systems administration, infrastructure, security, and IT leadership. My current focus is DevOps, automation, and platform engineering: building systems that are repeatable, secure, and easier to run, and documenting what I learn along the way.",

  currentRolesIntro: "I hold three concurrent roles: one in a technical career, two in nonprofit IT leadership.",
  currentRoles: [
    {
      title: "Senior Systems Administrator",
      organization: DEFENSE_EMPLOYER,
      start: "2024-03",
      responsibilities:
        "Administer Windows and Linux infrastructure, Microsoft 365, Azure, and identity and access in a regulated, compliance-driven environment, automating routine work with PowerShell, Python, Bash, and Ansible.",
    },
    {
      title: "Director of IT",
      organization: KEELWORKS,
      start: "2026-10",
      responsibilities:
        "Oversee technology strategy, technical operations, infrastructure, systems integration, and security, aligning IT with KeelWorks' mission and goals.",
    },
    {
      title: "Chief Information Officer",
      organization: MIS_HERMANOS_PEQUENITOS,
      start: "2026-07",
      responsibilities:
        "Oversee technology strategy, digital infrastructure, cybersecurity, and technology initiatives that support the nonprofit's mission.",
    },
  ],

  focusAreas: [
    { label: "Infrastructure and systems administration", categories: ["linux"] },
    { label: "IT leadership and technology strategy", categories: [] },
    { label: "Automation and infrastructure as code", categories: ["automation", "infrastructure-as-code"] },
    { label: "DevOps, GitOps, and platform engineering", categories: ["gitops", "platform-engineering"] },
  ],

  // Newest first. Pre-2026 entries are condensed from the author's legacy
  // career content.
  career: [
    { title: "Director of IT", organization: "KeelWorks (nonprofit)", start: "2026-10", highlights: [] },
    { title: "Chief Information Officer", organization: "Mis Hermanos Pequeñitos (nonprofit)", start: "2026-07", highlights: [] },
    { title: "Senior Systems Administrator", organization: DEFENSE_EMPLOYER.name, start: "2024-03", highlights: [] },
    {
      title: "IT Specialist (Contract)",
      organization: "STAAR Surgical",
      location: "Monrovia, CA",
      start: "2023-05",
      end: "2023-11",
      highlights: [
        "Refreshed server infrastructure, including migrating Linux systems from CentOS to Red Hat Enterprise Linux.",
        "Provisioned systems with Ansible and automated workstation tasks with PowerShell.",
      ],
    },
    {
      title: "MSP Senior IT Technician",
      organization: "We Solve Problems",
      location: "Los Angeles, CA",
      start: "2022-02",
      end: "2022-11",
      highlights: [
        "Supported game studios, law firms, and film production clients at a managed service provider.",
        "First production use of Ansible, provisioning servers for game development teams.",
      ],
    },
    {
      title: "Computer User Networking Specialist Intern",
      organization: "ACI Learning",
      location: "San Antonio, TX",
      start: "2021-06",
      end: "2022-01",
      highlights: [
        "Tier 2 and 3 support for Windows Server, Active Directory, Group Policy, and Cisco networking.",
        "Studied enterprise infrastructure and Security+ while applying it in production.",
      ],
    },
    {
      title: "IT Specialist",
      organization: "RAICES",
      location: "San Antonio, TX",
      start: "2019-10",
      end: "2021-06",
      highlights: [
        "Supported a distributed workforce across three Texas offices.",
        "Took part in moving from on-premises Active Directory to Azure AD and JumpCloud, and built tools to simplify data moves between Google Workspace and OneDrive.",
      ],
    },
    {
      title: "Technology Experience Specialist",
      organization: "Made Goods",
      location: "City of Industry, CA",
      start: "2018-10",
      end: "2019-07",
      highlights: ["Integrated macOS into a Windows Active Directory environment, and supported Linux-based warehouse systems and an ERP upgrade."],
    },
    {
      title: "Systems Administrator",
      organization: "AMETEK",
      location: "Rosemead, CA",
      start: "2015-02",
      end: "2018-10",
      highlights: [
        "First enterprise systems administration role. Automated administration with PowerShell, Python, and Bash.",
        "Led the move from Lotus Notes to Microsoft Office, and standardized deployment with MDT.",
      ],
    },
    {
      title: "Technical Support Specialist",
      organization: "iBUYPOWER",
      location: "Baldwin Park, CA",
      start: "2013-05",
      end: "2015-01",
      highlights: ["Hardware diagnostics, warranty repair, and burn-in testing, alongside phone and chat support."],
    },
    {
      title: "Components Sales Associate",
      organization: "Fry's Electronics",
      location: "City of Industry, CA",
      start: "2011-09",
      end: "2013-03",
      highlights: ["Helped customers choose networking equipment and computer components."],
    },
    {
      title: "Helpdesk Intern",
      organization: "St. Baldrick's Foundation",
      location: "Monrovia, CA",
      start: "2011-02",
      end: "2011-03",
      highlights: [
        "Supported users of the organization's website: reproduced and documented issues in Zendesk for the development team, and updated HTML content.",
      ],
    },
  ],

  earlierCareer: {
    summary:
      "Customer service, banking, and technical support roles, plus freelance and temporary IT work, that built the foundation for my IT career.",
    roles: [
      { organization: "Express Employment Professionals", years: "2011–2013" },
      { organization: "Work Market (freelance IT)", years: "2008–2013" },
      { organization: "AlternativeDVD.com", years: "2009–2010" },
      { organization: "Bank of America", years: "2007–2008" },
      { organization: "Wescom Credit Union", years: "2006–2007" },
      { organization: "Charter Communications", years: "2004–2006" },
      { organization: "EarthLink", years: "2001–2004" },
      { organization: "Union Bank", years: "1999–2001" },
    ],
  },

  // Names checked against each verification page (2026-11-02).
  certifications: [
    {
      name: "Microsoft Certified: Azure Administrator Associate",
      code: "AZ-104",
      issuer: "Microsoft",
      verifyUrl:
        "https://learn.microsoft.com/api/credentials/share/en-us/GersoRobayoGuillen-7914/55DA06DAA283FB5C?sharingId=74F03DB3343764B3",
    },
    {
      name: "CompTIA Security+",
      issuer: "CompTIA",
      verifyUrl: "https://cp.certmetrics.com/comptia/en/public/verify/credential/Z18ERHVTFNB4QZSW",
    },
    {
      name: "GitHub Foundations",
      code: "GH-900",
      issuer: "GitHub",
      verifyUrl:
        "https://learn.microsoft.com/api/credentials/share/en-us/GersoMakeziRobayoGuillen-1170/BB7EBDF476A44402?sharingId=FA5879ED0A4F1275",
      verifyHost: "Microsoft Learn",
    },
  ],

  skills: [
    { group: "Identity and access", items: ["Active Directory", "Group Policy", "Microsoft Entra ID", "Conditional Access", "MFA", "SAML"] },
    { group: "Cloud and Microsoft 365", items: ["Azure", "Microsoft 365", "Intune"] },
    { group: "Automation", items: ["PowerShell", "Python", "Bash", "Ansible"] },
    { group: "Systems", items: ["Windows Server", "Linux", "Red Hat Enterprise Linux", "macOS"] },
    { group: "Networking and resilience", items: ["Networking", "Cisco", "Backup and disaster recovery"] },
  ],
  learning: ["Kubernetes", "GitOps with Flux", "Git and GitHub", "Containers", "Astro"],
});

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10" → "Oct 2026". */
export function formatYearMonth(value: string): string {
  const [year, month] = value.split("-");
  return `${MONTHS[Number(month) - 1]} ${year}`;
}
